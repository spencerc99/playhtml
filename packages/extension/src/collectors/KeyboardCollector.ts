import { BaseCollector } from './BaseCollector';
import type { KeyboardEventData, TypingAction } from './types';
import { normalizePosition, getElementSelector } from './types';
import browser from 'webextension-polyfill';
import { VERBOSE } from '../config';

const PRIVACY_LEVEL_KEY = 'collection_keyboard_privacy_level';
const REDACTION_CHAR = '█'; // U+2588, full block
const DEBOUNCE_DELAY = 2000; // 2 seconds

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
  readonly description = 'Captures typing events with privacy levels and PII detection';

  // Privacy level (cached in memory)
  private privacyLevel: 'abstract' | 'full' = 'abstract';

  // Currently focused input tracking
  private focusedInput: HTMLInputElement | HTMLTextAreaElement | null = null;
  private cachedPosition: { x: number; y: number } | null = null;
  private cachedSelector: string | null = null;
  private initialText: string = '';

  // Event handlers
  private focusHandler?: (e: FocusEvent) => void;
  private blurHandler?: (e: FocusEvent) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;
  private inputHandler?: (e: Event) => void;

  // Typing sequence tracking
  private sequence: TypingAction[] = [];
  private textBefore: string = '';
  private lastKeydown: string | null = null;
  private firstActionTime: number = 0;

  // Debouncing
  private debounceTimer: number | null = null;

  start(): void {
    // Load privacy level from storage (once on init) - fire and forget
    this.initPrivacyLevel().catch(() => {
      // Silently fail - default to abstract
    });

    // Listen for storage changes to update cache
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[PRIVACY_LEVEL_KEY]) {
        const newLevel = changes[PRIVACY_LEVEL_KEY].newValue;
        if (newLevel === 'abstract' || newLevel === 'full') {
          this.privacyLevel = newLevel;
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

      // Only track input and textarea elements
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }

      this.handleFocus(target as HTMLInputElement | HTMLTextAreaElement);
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

    // Attach event listeners
    document.addEventListener('focus', this.focusHandler, true);
    document.addEventListener('blur', this.blurHandler, true);
    document.addEventListener('keydown', this.keydownHandler, true);
    document.addEventListener('input', this.inputHandler, true);
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

    // Clear debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Flush any pending typing event
    if (this.sequence.length > 0 && this.focusedInput) {
      this.flushTypingEvent();
    }

    // Reset state
    this.focusedInput = null;
    this.cachedPosition = null;
    this.cachedSelector = null;
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
   * Handle focus event
   */
  private handleFocus(input: HTMLInputElement | HTMLTextAreaElement): void {
    this.focusedInput = input;
    
    // Get initial text
    this.initialText = input.value || '';
    this.textBefore = this.initialText;

    // Calculate and cache position (once on focus)
    const rect = input.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    this.cachedPosition = normalizePosition(
      centerX,
      centerY,
      window.innerWidth,
      window.innerHeight
    );

    // Cache element selector
    this.cachedSelector = getElementSelector(input);

    // Reset sequence
    this.sequence = [];
    this.firstActionTime = 0;
  }

  /**
   * Handle blur event
   */
  private handleBlur(): void {
    // Flush any pending typing event immediately
    if (this.sequence.length > 0 && this.focusedInput) {
      this.flushTypingEvent();
    }

    // Reset state
    this.focusedInput = null;
    this.cachedPosition = null;
    this.cachedSelector = null;
    this.sequence = [];
    this.textBefore = '';
    this.lastKeydown = null;
  }

  /**
   * Handle input event
   */
  private handleInput(): void {
    if (!this.focusedInput) {
      return;
    }

    const textAfter = this.focusedInput.value || '';

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

    const finalText = this.focusedInput.value || '';
    let sequence = null;

    if (this.privacyLevel === 'full') {
      // Redact PII in sequence actions
      sequence = this.sequence.map(action => {
        const redacted: TypingAction = { ...action };
        if (action.text) {
          redacted.text = this.redactPII(action.text);
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
      textLength: finalText.length,
      sequence: sequence,
    };

    this.emit(typeData);

    // Expose event to page for testing
    this.exposeEventToPage(typeData);

    if (VERBOSE) {
      console.log('[KeyboardCollector] Type event emitted:', typeData);
    }

    // Reset sequence
    this.sequence = [];
    this.firstActionTime = 0;
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
