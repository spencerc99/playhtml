import { BaseCollector } from './BaseCollector';
import type { KeyboardEventData, TypingAction } from './types';
import { normalizePosition, getElementSelector } from './types';
import browser from 'webextension-polyfill';
import { VERBOSE } from '../config';

const PRIVACY_LEVEL_KEY = 'collection_keyboard_privacy_level';
const FILTER_SUBSTRINGS_KEY = 'collection_keyboard_filter_substrings';
const REDACTION_CHAR = '█'; // U+2588, full block
const DEBOUNCE_DELAY = 5000; // 5 seconds - longer to handle gaps between typing sessions

// PII detection patterns
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
  phone: /\b(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
};

/**
 * KeyboardCollector captures typing behavior with dual privacy levels:
 * - Abstract: Typing frequency, text length, location (no actual text)
 * - Full: Actual text content + location + typing sequence (PII redacted)
 */
export class KeyboardCollector extends BaseCollector<KeyboardEventData> {
  readonly type = 'keyboard' as const;
  readonly description = 'Captures typing in any editable element (inputs, textareas, contenteditable)';

  // Privacy level (cached in memory)
  private privacyLevel: 'abstract' | 'full' = 'abstract';

  // Filter substrings (cached in memory)
  private filterSubstrings: string[] = [];

  // Currently focused input tracking (supports input, textarea, and contenteditable)
  private focusedInput: HTMLElement | null = null;
  private cachedPosition: { x: number; y: number } | null = null;
  private cachedSelector: string | null = null;
  private cachedStyling: { w: number; h: number; br: number; bg: number; bs: number } | null = null;
  private initialText: string = '';

  // Track last focused element to accumulate sequences across focus/blur cycles
  private lastElementKey: string | null = null; // selector + position identifier

  // Event handlers
  private focusHandler?: (e: FocusEvent) => void;
  private blurHandler?: (e: FocusEvent) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;
  private inputHandler?: (e: Event) => void;
  private beforeUnloadHandler?: (e: Event) => void;

  // Typing sequence tracking
  private sequence: TypingAction[] = [];
  private textBefore: string = '';
  private lastKeydown: string | null = null;
  private firstActionTime: number = 0;

  // Debouncing (longer timeout to handle gaps between typing sessions on same input)
  private debounceTimer: number | null = null;

  start(): void {
    // Load privacy level and filter substrings from storage (once on init) - fire and forget
    this.initPrivacyLevel().catch(() => {
      // Silently fail - default to abstract
    });
    this.initFilterSubstrings().catch(() => {
      // Silently fail - default to empty list
    });

    // Listen for storage changes to update cache
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes[PRIVACY_LEVEL_KEY]) {
          const newLevel = changes[PRIVACY_LEVEL_KEY].newValue;
          if (newLevel === 'abstract' || newLevel === 'full') {
            this.privacyLevel = newLevel;
          }
        }
        if (changes[FILTER_SUBSTRINGS_KEY]) {
          const newList = changes[FILTER_SUBSTRINGS_KEY].newValue;
          if (Array.isArray(newList)) {
            this.filterSubstrings = newList;
          }
        }
      }
    });

    // Set up focus handler
    this.focusHandler = (e: FocusEvent) => {
      const target = e.target as HTMLElement;

      // Skip password inputs
      if (target instanceof HTMLInputElement && target.type === 'password') {
        return;
      }

      // Track input, textarea, and contenteditable elements
      const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const isContentEditable = target.isContentEditable;

      if (!isInput && !isContentEditable) {
        return;
      }

      this.handleFocus(target);
    };

    // Set up blur handler
    this.blurHandler = (e: FocusEvent) => {
      if (this.focusedInput && e.target === this.focusedInput) {
        this.handleBlur();
      }
    };

    // Set up keydown handler
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.focusedInput || e.target !== this.focusedInput) {
        return;
      }

      // Ignore modifier keys alone
      if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Shift') {
        return;
      }

      // Track printable characters, Backspace, Delete, and special keys that produce characters
      // Enter produces \n, Tab produces \t (though Tab also moves focus)
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' || e.key === 'Tab') {
        this.lastKeydown = e.key;
      }
    };

    // Set up input handler
    this.inputHandler = (e: Event) => {
      if (!this.focusedInput || e.target !== this.focusedInput) {
        return;
      }

      this.handleInput();
    };

    // Set up beforeunload handler to flush pending typing on page navigation
    this.beforeUnloadHandler = (e: Event) => {
      if (this.sequence.length > 0) {
        this.flushTypingEvent();
      }
    };

    // Attach event listeners
    document.addEventListener('focus', this.focusHandler, true);
    document.addEventListener('blur', this.blurHandler, true);
    document.addEventListener('keydown', this.keydownHandler, true);
    document.addEventListener('input', this.inputHandler, true);
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  stop(): void {
    // Remove event listeners
    if (this.focusHandler) {
      document.removeEventListener('focus', this.focusHandler, true);
      this.focusHandler = undefined;
    }

    if (this.blurHandler) {
      document.removeEventListener('blur', this.blurHandler, true);
      this.blurHandler = undefined;
    }

    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = undefined;
    }

    if (this.inputHandler) {
      document.removeEventListener('input', this.inputHandler, true);
      this.inputHandler = undefined;
    }

    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = undefined;
    }

    // Clear debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Flush any pending typing event (even if element is not currently focused)
    if (this.sequence.length > 0 && this.cachedPosition && this.cachedSelector) {
      this.flushTypingEvent();
    }

    // Reset state
    this.focusedInput = null;
    this.cachedPosition = null;
    this.cachedSelector = null;
    this.cachedStyling = null;
    this.lastElementKey = null;
    this.sequence = [];
    this.textBefore = '';
    this.lastKeydown = null;
  }

  /**
   * Initialize privacy level from storage (read once, cache in memory)
   */
  private async initPrivacyLevel(): Promise<void> {
    try {
      const result = await browser.storage.local.get([PRIVACY_LEVEL_KEY]);
      const level = result[PRIVACY_LEVEL_KEY];
      if (level === 'abstract' || level === 'full') {
        this.privacyLevel = level;
      } else {
        // Default to abstract
        this.privacyLevel = 'abstract';
        await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: 'abstract' });
      }
    } catch (error) {
      this.privacyLevel = 'abstract'; // Default on error
    }
  }

  /**
   * Initialize filter substrings from storage (read once, cache in memory)
   */
  private async initFilterSubstrings(): Promise<void> {
    try {
      const result = await browser.storage.local.get([FILTER_SUBSTRINGS_KEY]);
      const list = result[FILTER_SUBSTRINGS_KEY];
      if (Array.isArray(list)) {
        this.filterSubstrings = list;
      } else {
        // Default to empty list
        this.filterSubstrings = [];
        await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: [] });
      }
    } catch (error) {
      this.filterSubstrings = []; // Default on error
    }
  }

  /**
   * Get text content from any editable element
   */
  private getElementText(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value || '';
    } else if (element.isContentEditable) {
      return element.textContent || '';
    }
    return '';
  }

  /**
   * Handle focus event
   */
  private handleFocus(input: HTMLElement): void {
    // Calculate position and selector to determine if this is the same element
    const rect = input.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const position = normalizePosition(
      centerX,
      centerY,
      window.innerWidth,
      window.innerHeight
    );
    const selector = getElementSelector(input);

    // Create element key for tracking (selector + rough position)
    const elementKey = `${selector}|${position.x.toFixed(2)}|${position.y.toFixed(2)}`;

    // Check if this is a different element than the last one we were tracking
    if (this.lastElementKey && this.lastElementKey !== elementKey) {
      // Switching to a different element - flush any pending typing from previous element
      if (this.sequence.length > 0) {
        this.flushTypingEvent();
      }
    }

    // Update tracking for this element
    this.focusedInput = input;
    this.lastElementKey = elementKey;
    this.initialText = this.getElementText(input);
    this.textBefore = this.initialText;
    this.cachedPosition = position;
    this.cachedSelector = selector;

    // Cache input styling
    const computedStyle = window.getComputedStyle(input);
    this.cachedStyling = {
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      br: Math.min(20, parseInt(computedStyle.borderTopLeftRadius) || 0),
      bg: this.getBackgroundLuminosity(computedStyle.backgroundColor),
      bs: this.mapBorderStyle(computedStyle.borderStyle),
    };

    // Only reset sequence if switching elements (checked above)
    // If returning to same element, continue accumulating
    if (this.lastElementKey === elementKey && this.sequence.length > 0) {
      // Continuing on same element - keep existing sequence
      // Just cancel debounce timer since we're actively typing again
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
    } else if (this.lastElementKey !== elementKey) {
      // New element - reset sequence (already flushed above)
      this.sequence = [];
      this.firstActionTime = 0;
    }
  }

  /**
   * Handle blur event
   * Don't immediately flush - let debounce timer handle it
   * This allows accumulating sequences across multiple focus/blur cycles on same element
   */
  private handleBlur(): void {
    // Just clear focused input reference
    // Keep sequence, cached data, and lastElementKey so we can resume if same element is focused again
    this.focusedInput = null;
    this.lastKeydown = null;

    // Debounce timer will flush after DEBOUNCE_DELAY if no more typing occurs
  }

  /**
   * Handle input event
   */
  private handleInput(): void {
    if (!this.focusedInput) {
      return;
    }

    const textAfter = this.getElementText(this.focusedInput);

    // Detect paste: large text change without matching keydown
    const textChange = textAfter.length - this.textBefore.length;
    if (textChange > 1 && (!this.lastKeydown || this.lastKeydown.length === 1)) {
      // Likely paste (large change but only single char keydown or no keydown)
      // Skip it - don't add to sequence
      this.textBefore = textAfter;
      this.lastKeydown = null;
      return;
    }

    // Determine action type from last keydown or text change
    if (this.lastKeydown === 'Backspace' || this.lastKeydown === 'Delete') {
      // Deletion action - count how many characters were deleted
      // This correctly handles bulk deletions (select-all + delete, etc.)
      if (textAfter.length < this.textBefore.length) {
        const deletedCount = this.textBefore.length - textAfter.length;
        this.addBackspaceAction(deletedCount);
      }
    } else if (textAfter.length > this.textBefore.length) {
      // Type action - text was added
      // Handle special keys that produce characters
      if (this.lastKeydown === 'Enter') {
        // Enter produces newline character
        this.addTypeAction('\n');
      } else if (this.lastKeydown === 'Tab') {
        // Tab produces tab character (though Tab usually moves focus)
        this.addTypeAction('\t');
      } else if (this.lastKeydown && this.lastKeydown.length === 1) {
        // Regular printable character
        const added = textAfter.slice(this.textBefore.length);
        if (added.length > 0) {
          this.addTypeAction(added);
        }
      } else {
        // Fallback: if we can't determine from keydown, capture the actual text change
        // This handles cases where keydown wasn't captured or special input methods
        const added = textAfter.slice(this.textBefore.length);
        if (added.length > 0) {
          this.addTypeAction(added);
        }
      }
    }

    // Update text before for next action
    this.textBefore = textAfter;
    this.lastKeydown = null;

    // Reset debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      if (this.sequence.length > 0 && this.focusedInput) {
        this.flushTypingEvent();
      }
      this.debounceTimer = null;
    }, DEBOUNCE_DELAY);
  }

  /**
   * Add a type action to the sequence (with grouping)
   */
  private addTypeAction(char: string): void {
    const now = Date.now();
    
    if (this.firstActionTime === 0) {
      this.firstActionTime = now;
    }

    // Check if last action is also type - group them
    const lastAction = this.sequence[this.sequence.length - 1];
    if (lastAction && lastAction.action === 'type') {
      // Append to last action
      lastAction.text = (lastAction.text || '') + char;
    } else {
      // Create new type action
      const action: TypingAction = {
        action: 'type',
        text: char,
        timestamp: now - this.firstActionTime,
      };
      this.sequence.push(action);
    }
  }

  /**
   * Add a backspace action to the sequence (with grouping)
   */
  private addBackspaceAction(deletedCount: number): void {
    const now = Date.now();
    
    if (this.firstActionTime === 0) {
      this.firstActionTime = now;
    }

    // Check if last action is also backspace - group them
    const lastAction = this.sequence[this.sequence.length - 1];
    if (lastAction && lastAction.action === 'backspace') {
      // Add to last action's deleted count
      lastAction.deletedCount = (lastAction.deletedCount || 0) + deletedCount;
    } else {
      // Create new backspace action
      const action: TypingAction = {
        action: 'backspace',
        deletedCount: deletedCount,
        timestamp: now - this.firstActionTime,
      };
      this.sequence.push(action);
    }
  }

  /**
   * Flush pending typing event
   */
  private flushTypingEvent(): void {
    if (!this.focusedInput || !this.cachedPosition || !this.cachedSelector) {
      return;
    }

    // Discard events that only contain backspace actions (no actual typing)
    const hasTyping = this.sequence.some(action => action.action === 'type');
    if (!hasTyping) {
      // Only backspaces, no typing - discard this event
      this.sequence = [];
      this.firstActionTime = 0;
      return;
    }

    // Check if the full typed text contains any filter substrings
    const fullText = this.sequence.reduce((text, action) => {
      if (action.action === 'type' && action.text) {
        return text + action.text;
      } else if (action.action === 'backspace' && action.deletedCount) {
        return text.slice(0, -action.deletedCount);
      }
      return text;
    }, '').toLowerCase(); // Case-insensitive matching

    const containsFilteredSubstring = this.filterSubstrings.some(substring =>
      fullText.includes(substring.toLowerCase())
    );

    let sequence = null;

    if (containsFilteredSubstring) {
      // Redact entire sequence if it contains a filtered substring
      sequence = this.sequence.map(action => {
        const redacted: TypingAction = { ...action };
        if (action.text) {
          redacted.text = REDACTION_CHAR.repeat(action.text.length);
        }
        // deletedCount is just a number, no redaction needed
        return redacted;
      });
    } else if (this.privacyLevel === 'full') {
      // Redact PII in sequence actions
      sequence = this.sequence.map(action => {
        const redacted: TypingAction = { ...action };
        if (action.text) {
          redacted.text = this.redactPII(action.text);
        }
        // deletedCount is just a number, no redaction needed
        return redacted;
      });
    } else {
      // Abstract level: redact all non-whitespace characters but preserve whitespace
      // This preserves cadence (timestamps) while hiding actual content
      sequence = this.sequence.map(action => {
        const redacted: TypingAction = { ...action };
        if (action.text) {
          redacted.text = this.redactNonWhitespace(action.text);
        }
        // deletedCount is just a number, no redaction needed
        return redacted;
      });
    }

    const typeData: KeyboardEventData = {
      x: this.cachedPosition.x,
      y: this.cachedPosition.y,
      t: this.cachedSelector,
      event: 'type',
      sequence: sequence,
      style: this.cachedStyling || undefined,
    };

    this.emit(typeData);

    // Expose event to page for testing
    this.exposeEventToPage(typeData);

    if (VERBOSE) {
      console.log('[KeyboardCollector] Type event emitted:', typeData);
    }

    // Reset sequence and element tracking
    this.sequence = [];
    this.firstActionTime = 0;
    this.lastElementKey = null;
    this.cachedPosition = null;
    this.cachedSelector = null;
    this.cachedStyling = null;
  }

  /**
   * Get background luminosity (0-1) from CSS color string
   * Used to detect light/dark input backgrounds
   */
  private getBackgroundLuminosity(backgroundColor: string): number {
    // Parse rgba/rgb color
    const match = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return 0.5; // Default to mid-range if can't parse

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    // Calculate relative luminance using sRGB coefficients
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return Math.round(luminance * 100) / 100; // Round to 2 decimals
  }

  /**
   * Map CSS border style to numeric code for compact storage
   */
  private mapBorderStyle(borderStyle: string): number {
    switch (borderStyle) {
      case 'solid': return 1;
      case 'dashed': return 2;
      case 'dotted': return 3;
      case 'double': return 4;
      default: return 0; // none, hidden, or other
    }
  }

  /**
   * Redact PII patterns in text
   */
  private redactPII(text: string): string {
    let redacted = text;

    // Apply each PII pattern
    for (const pattern of Object.values(PII_PATTERNS)) {
      redacted = redacted.replace(pattern, (match) => {
        return REDACTION_CHAR.repeat(match.length);
      });
    }

    return redacted;
  }

  /**
   * Redact all non-whitespace characters while preserving whitespace
   * Used for abstract privacy level to preserve cadence while hiding content
   */
  private redactNonWhitespace(text: string): string {
    // Replace each character: keep whitespace, redact everything else
    return text.replace(/./g, (char) => {
      // Check if character is whitespace (space, tab, newline, etc.)
      return /\s/.test(char) ? char : REDACTION_CHAR;
    });
  }

  /**
   * Expose event to page for testing (via window.postMessage)
   */
  private exposeEventToPage(data: KeyboardEventData): void {
    try {
      window.postMessage(
        {
          type: 'KEYBOARD_COLLECTOR_EVENT',
          data: data,
        },
        window.location.origin
      );
    } catch (error) {
      // Ignore errors (might fail in some contexts)
    }
  }
}
