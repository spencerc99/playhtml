import { BaseCollector } from './BaseCollector';
import type { NavigationEventData } from './types';
import { VERBOSE } from '../config';

/**
 * NavigationCollector captures navigation and tab lifecycle events:
 * 
 * - Window focus/blur (when user switches tabs/windows)
 * - Browser navigation (back/forward via popstate)
 * - Page unload (beforeunload)
 */
export class NavigationCollector extends BaseCollector<NavigationEventData> {
  readonly type = 'navigation' as const;
  readonly description = 'Captures navigation events: focus, blur, popstate, beforeunload';
  
  private focusHandler?: () => void;
  private blurHandler?: () => void;
  private popstateHandler?: (e: PopStateEvent) => void;
  private beforeunloadHandler?: (e: BeforeUnloadEvent) => void;
  
  start(): void {
    if (VERBOSE) {
      console.log('[NavigationCollector] Starting navigation collection...');
    }
    
    // Focus handler
    this.focusHandler = () => {
      this.emitDiscreteEvent({
        event: 'focus',
      });
    };
    
    // Blur handler
    this.blurHandler = () => {
      this.emitDiscreteEvent({
        event: 'blur',
      });
    };
    
    // Popstate handler (back/forward navigation)
    this.popstateHandler = (e: PopStateEvent) => {
      this.emitDiscreteEvent({
        event: 'popstate',
        url: window.location.href,
        state: e.state,
      });
    };
    
    // Beforeunload handler (page leaving)
    this.beforeunloadHandler = (e: BeforeUnloadEvent) => {
      this.emitDiscreteEvent({
        event: 'beforeunload',
        from_url: window.location.href,
      });
    };
    
    // Attach event listeners
    window.addEventListener('focus', this.focusHandler);
    window.addEventListener('blur', this.blurHandler);
    window.addEventListener('popstate', this.popstateHandler);
    window.addEventListener('beforeunload', this.beforeunloadHandler);
    
    if (VERBOSE) {
      console.log('[NavigationCollector] Started successfully');
    }
  }
  
  stop(): void {
    if (!this.enabled) return;
    
    this.enabled = false;
    
    if (this.focusHandler) {
      window.removeEventListener('focus', this.focusHandler);
      this.focusHandler = undefined;
    }
    
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler);
      this.blurHandler = undefined;
    }
    
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = undefined;
    }
    
    if (this.beforeunloadHandler) {
      window.removeEventListener('beforeunload', this.beforeunloadHandler);
      this.beforeunloadHandler = undefined;
    }
  }

  /**
   * Emit a discrete navigation event immediately
   */
  private emitDiscreteEvent(data: NavigationEventData): void {
    if (!this.enabled) return;
    
    if (VERBOSE) {
      console.log('[NavigationCollector] Emitting navigation event:', data);
    }
    
    // Emit to buffer for archival
    this.emit(data);
  }
}
