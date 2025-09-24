// Chat functionality for cursor presence, based on cursor-party

export interface ChatOptions {
  onMessageUpdate?: (message: string | null) => void;
}

export class CursorChat {
  private listening: boolean = false;
  private message: string = "";
  private chatElement: HTMLElement | null = null;
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
    const handleKeyDown = (event: KeyboardEvent) => {
      // Reset any timeouts
      if (this.timeout) {
        clearTimeout(this.timeout);
      }
      this.timeout = setTimeout(() => {
        this.setListening(false);
        this.setMessage("");
      }, 10000);

      if (!this.listening) {
        if (event.key === "/") {
          this.setMessage("");
          this.setListening(true);
          event.preventDefault();
          event.stopPropagation();
        }
      } else {
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
              this.message.length < 42
                ? this.message + event.key
                : this.message;
            this.setMessage(newMessage);
          }

          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
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

    const style = document.createElement("style");
    // TODO: make background color themed based on your cursor color
    // TODO: allow customization from developers/users
    style.textContent = `
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
    document.head.appendChild(style);

    this.chatElement = document.createElement("div");
    this.chatElement.className = "playhtml-chat-container";
    this.chatElement.style.display = "none";
    document.body.appendChild(this.chatElement);
  }

  private updateChatDisplay(): void {
    if (!this.chatElement) return;

    if (this.listening || this.message) {
      this.chatElement.innerHTML = `
        <div class="playhtml-chat-input">${this.message || "..."}</div>
        <div class="playhtml-chat-button">&times;</div>
      `;
      this.chatElement.style.display = "flex";

      // Add click handler to close button
      const closeButton = this.chatElement.querySelector(
        ".playhtml-chat-button"
      );
      closeButton?.addEventListener("click", () => {
        this.setListening(false);
        this.setMessage("");
      });
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

  public getCurrentMessage(): string | null {
    return this.message.length > 0 ? this.message : null;
  }

  public destroy(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    if (this.chatElement) {
      this.chatElement.remove();
      this.chatElement = null;
    }
  }
}
