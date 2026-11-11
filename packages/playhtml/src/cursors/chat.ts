// ABOUTME: Provides the keyboard-driven chat input for cursor presence.
// ABOUTME: Manages the chat's owned document listener and DOM resources.

export interface ChatOptions {
  onMessageUpdate?: (message: string | null) => void;
}

// True when the key event originates in an input, textarea, select, or
// contenteditable region, including inside open shadow roots.
function isEditableTarget(event: KeyboardEvent): boolean {
  const origin = event.composedPath()[0] ?? event.target;
  if (!(origin instanceof Element)) return false;
  if (
    origin instanceof HTMLInputElement ||
    origin instanceof HTMLTextAreaElement ||
    origin instanceof HTMLSelectElement
  ) {
    return true;
  }
  if ((origin as HTMLElement).isContentEditable) return true;
  const editableAncestor = origin.closest("[contenteditable]");
  return (
    editableAncestor !== null &&
    editableAncestor.getAttribute("contenteditable") !== "false"
  );
}

export class CursorChat {
  private listening: boolean = false;
  private message: string = "";
  private chatElement: HTMLElement | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private options: ChatOptions;

  constructor(options: ChatOptions = {}) {
    this.options = options;
    this.initialize();
  }

  private initialize(): void {
    this.setupKeyboardHandlers();
    this.createChatElement();
  }

  private setupKeyboardHandlers(): void {
    this.keydownHandler = (event: KeyboardEvent) => {
      // Typing into the host page's own fields belongs to the page, so chat
      // neither opens nor captures keys there.
      if (isEditableTarget(event)) return;

      if (!this.listening) {
        if (event.key === "/") {
          this.setMessage("");
          this.setListening(true);
          this.armIdleTimeout();
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      this.armIdleTimeout();
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key === "Enter") {
          this.setListening(false);
        } else if (event.key === "Escape") {
          this.setListening(false);
          this.setMessage("");
        } else if (event.key === "Backspace") {
          this.setMessage(this.message.slice(0, -1));
        } else if (event.key.length === 1) {
          const newMessage =
            this.message.length < 42 ? this.message + event.key : this.message;
          this.setMessage(newMessage);
        }

        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    };

    document.addEventListener("keydown", this.keydownHandler);
  }

  // Clears the chat 10s after the last chat keystroke. Only chat keystrokes
  // re-arm it, so ordinary typing on the page does not publish a cursor update.
  private armIdleTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
    }
    this.timeout = setTimeout(() => {
      this.timeout = null;
      this.setListening(false);
      this.setMessage("");
    }, 10000);
  }

  private setListening(listening: boolean): void {
    this.listening = listening;
    this.updateChatDisplay();
  }

  private setMessage(message: string): void {
    this.message = message;
    this.updateChatDisplay();
    this.options.onMessageUpdate?.(message.length > 0 ? message : null);
  }

  private createChatElement(): void {
    if (this.chatElement) return;

    this.styleElement = document.createElement("style");
    // TODO: make background color themed based on your cursor color
    // TODO: allow customization from developers/users
    this.styleElement.textContent = `
      .playhtml-chat-container {
        box-sizing: border-box;
        position: fixed;
        bottom: 24px;
        right: 32px;
        padding: 8px;
        height: 48px;
        border-radius: 24px;
        min-width: 4.4em;
        background-color: rgba(52, 199, 89, 1);
        color: white;
        display: flex;
        justify-content: end;
        align-items: center;
        gap: 8px;
        font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
        font-weight: 320;
        z-index: 1000000;
      }
      
      .playhtml-chat-input {
        box-sizing: border-box;
        padding: 0px 4px 0px 4px;
        margin: 0px;
        font-size: 24px;
        line-height: 1;
        white-space: nowrap;
        background: transparent;
        border: none;
        outline: none;
        color: white;
      }
      
      .playhtml-chat-button {
        box-sizing: border-box;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 24px;
        font-weight: 250;
        padding: 0px;
        margin: 0px;
        border: 0.5px solid rgba(255,255,255,0.75);
        cursor: pointer;
        color: white;
        background-color: transparent;
      }
    `;
    document.head.appendChild(this.styleElement);

    this.chatElement = document.createElement("div");
    this.chatElement.className = "playhtml-chat-container";
    this.chatElement.style.display = "none";
    document.body.appendChild(this.chatElement);
  }

  private updateChatDisplay(): void {
    if (!this.chatElement) return;

    if (this.listening || this.message) {
      // The typed message is set as text so characters like "<" and "&"
      // render literally instead of being parsed as markup.
      const input = document.createElement("div");
      input.className = "playhtml-chat-input";
      input.textContent = this.message || "...";

      const closeButton = document.createElement("div");
      closeButton.className = "playhtml-chat-button";
      closeButton.textContent = "×";
      closeButton.addEventListener("click", () => {
        this.setListening(false);
        this.setMessage("");
      });

      this.chatElement.replaceChildren(input, closeButton);
      this.chatElement.style.display = "flex";
    } else {
      this.chatElement.style.display = "none";
    }
  }

  public showCTA(): void {
    if (!this.chatElement) return;

    if (!this.listening && !this.message) {
      this.chatElement.innerHTML = `<div class="playhtml-chat-input">Type / to reply</div>`;
      this.chatElement.style.display = "flex";
    }
  }

  public hideCTA(): void {
    if (!this.chatElement) return;

    if (!this.listening && !this.message) {
      this.chatElement.style.display = "none";
    }
  }

  public destroy(): void {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }

    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.chatElement) {
      this.chatElement.remove();
      this.chatElement = null;
    }

    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }
  }
}
