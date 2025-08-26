import browser from "webextension-polyfill";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  main() {

    // Initialize PlayHTML extension on page
    class PlayHTMLExtension {
      private playerIdentity: any = null;
      private isInitialized = false;

      async init() {
        if (this.isInitialized) return;

        try {
          // Get player identity from background script
          this.playerIdentity = await browser.runtime.sendMessage({
            type: "GET_PLAYER_IDENTITY",
          });

          // Notify background about site discovery
          await browser.runtime.sendMessage({
            type: "UPDATE_SITE_DISCOVERY",
            domain: window.location.hostname,
          });

          // Check if page already has PlayHTML
          this.detectExistingPlayHTML();

          // Initialize extension features
          this.setupElementPicker();
          this.setupPresenceDetection();

          // Check if this is a new site discovery
          await this.checkSiteDiscovery();

          // Set up collection detection for can-collect elements
          this.setupCollectionDetection();

          this.isInitialized = true;
        } catch (error) {
          console.error("Failed to initialize PlayHTML Extension:", error);
        }
      }

      private detectExistingPlayHTML() {
        // Look for existing PlayHTML elements
        const existingElements = document.querySelectorAll(
          "[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]"
        );

        if (existingElements.length > 0) {
          // TODO: Coordinate with existing PlayHTML instance
        }

        return existingElements.length;
      }

      public checkPlayHTMLStatus() {
        const existingElements = document.querySelectorAll(
          "[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]"
        );
        return {
          elementCount: existingElements.length,
          detected: existingElements.length > 0,
        };
      }

      private setupElementPicker() {
        // Element picker will be activated on demand
      }

      private findBestTarget(startElement: HTMLElement): HTMLElement | null {
        // Strategy: Find the smallest reasonable element at the click point
        const rect = startElement.getBoundingClientRect();
        const viewportArea = window.innerWidth * window.innerHeight;
        const elementArea = rect.width * rect.height;

        // Define what makes a good target
        const isGoodSize = (el: HTMLElement): boolean => {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          return (
            area < viewportArea * 0.5 && // Less than 50% of viewport
            r.width >= 20 &&
            r.height >= 15 // Not too small
          );
        };

        const isInteractive = (el: HTMLElement): boolean => {
          const interactiveTags = [
            "A",
            "BUTTON",
            "INPUT",
            "SELECT",
            "TEXTAREA",
            "IMG",
            "VIDEO",
          ];
          return (
            interactiveTags.includes(el.tagName) ||
            el.onclick !== null ||
            el.style.cursor === "pointer" ||
            el.getAttribute("role") === "button"
          );
        };

        const isContentElement = (el: HTMLElement): boolean => {
          const contentTags = [
            "P",
            "H1",
            "H2",
            "H3",
            "H4",
            "H5",
            "H6",
            "SPAN",
            "EM",
            "STRONG",
            "LABEL",
            "LI",
          ];
          return (
            contentTags.includes(el.tagName) &&
            el.textContent !== null &&
            el.textContent.trim().length > 0
          );
        };

        // If the starting element is already good, use it
        if (isGoodSize(startElement)) {
          return startElement;
        }

        // Otherwise, look for the best child element
        const findBestChild = (parent: HTMLElement): HTMLElement | null => {
          const children = Array.from(parent.children) as HTMLElement[];

          // First priority: interactive elements of good size
          for (const child of children) {
            if (isGoodSize(child) && isInteractive(child)) {
              return child;
            }
          }

          // Second priority: content elements of good size
          for (const child of children) {
            if (isGoodSize(child) && isContentElement(child)) {
              return child;
            }
          }

          // Third priority: any good-sized element
          for (const child of children) {
            if (isGoodSize(child)) {
              return child;
            }
          }

          // Recursively search children
          for (const child of children) {
            const grandChild = findBestChild(child);
            if (grandChild) return grandChild;
          }

          return null;
        };

        const bestChild = findBestChild(startElement);
        if (bestChild) {
          return bestChild;
        }

        // If no good child found, try going up the parent chain
        let current = startElement.parentElement;
        while (
          current &&
          current !== document.body &&
          current !== document.documentElement
        ) {
          if (isGoodSize(current)) {
            return current;
          }
          current = current.parentElement;
        }

        return null;
      }

      public activateElementPicker() {
        // Create overlay for element selection
        const overlay = document.createElement("div");
        overlay.id = "playhtml-picker-overlay";
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(99, 102, 241, 0.05);
          z-index: 999999;
          cursor: crosshair;
          pointer-events: none;
        `;

        const highlight = document.createElement("div");
        highlight.id = "playhtml-picker-highlight";
        highlight.style.cssText = `
          position: absolute;
          border: 2px solid #6366f1;
          background: rgba(99, 102, 241, 0.2);
          pointer-events: none;
          z-index: 1000000;
          border-radius: 4px;
          transition: all 0.1s ease;
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(highlight);

        // Track mouse movement and highlight elements
        let isActive = true;

        const handleMouseMove = (e: MouseEvent) => {
          if (!isActive) return;

          // Temporarily disable pointer events on overlay and highlight to get element underneath
          overlay.style.pointerEvents = "none";
          highlight.style.pointerEvents = "none";

          const target = document.elementFromPoint(e.clientX, e.clientY);

          // Re-enable pointer events
          overlay.style.pointerEvents = "auto";
          highlight.style.pointerEvents = "none"; // highlight should never block

          if (!target || target === overlay || target === highlight) {
            return;
          }

          // Find the best target element using new approach
          const bestTarget = this.findBestTarget(target as HTMLElement);

          if (!bestTarget) {
            // Hide highlight when no good target found
            highlight.style.display = "none";
            return;
          }

          // Show green highlight for valid targets
          const rect = bestTarget.getBoundingClientRect();
          highlight.style.display = "block";
          highlight.style.left = `${rect.left}px`;
          highlight.style.top = `${rect.top}px`;
          highlight.style.width = `${rect.width}px`;
          highlight.style.height = `${rect.height}px`;
          highlight.style.borderColor = "#10b981";
          highlight.style.backgroundColor = "rgba(16, 185, 129, 0.2)";
        };

        const handleClick = (e: MouseEvent) => {
          if (!isActive) return;

          e.preventDefault();
          e.stopPropagation();

          // Temporarily disable pointer events to get element underneath
          overlay.style.pointerEvents = "none";
          highlight.style.pointerEvents = "none";

          const target = document.elementFromPoint(e.clientX, e.clientY);

          if (!target || target === overlay || target === highlight) {
            return;
          }

          // Find the best target element
          const bestTarget = this.findBestTarget(target as HTMLElement);
          if (!bestTarget) {
            return;
          }

          // Show capability selection modal
          this.showCapabilityModal(bestTarget);

          // Clean up
          isActive = false;
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("click", handleClick);
          document.removeEventListener("keydown", handleEscape);
          overlay.remove();
          highlight.remove();
        };

        const handleEscape = (e: KeyboardEvent) => {
          if (e.key === "Escape") {
            isActive = false;
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("click", handleClick);
            document.removeEventListener("keydown", handleEscape);
            overlay.remove();
            highlight.remove();
          }
        };

        // Start with pointer events enabled for clicking
        overlay.style.pointerEvents = "auto";

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("click", handleClick, true);
        document.addEventListener("keydown", handleEscape);
      }

      private showCapabilityModal(element: HTMLElement) {
        // Check if element already has PlayHTML capabilities
        const hasPlayHTMLAttr = (el: HTMLElement): boolean => {
          const playhtmlAttrs = [
            "can-move",
            "can-spin",
            "can-toggle",
            "can-grow",
            "can-duplicate",
            "can-mirror",
            "can-play",
          ];
          return playhtmlAttrs.some((attr) => el.hasAttribute(attr));
        };

        const elementHasPlayHTML = hasPlayHTMLAttr(element);

        // Import React components dynamically
        this.renderReactModal(element, elementHasPlayHTML);
      }

      private async renderReactModal(
        element: HTMLElement,
        elementHasPlayHTML: boolean
      ) {
        // Dynamically import React and the modal component
        const [{ default: React }, { createRoot }, { CapabilityModal }] =
          await Promise.all([
            import("react"),
            import("react-dom/client"),
            import("../components/CapabilityModal"),
          ]);

        // Create container for React component
        const container = document.createElement("div");
        container.id = "playhtml-capability-modal";
        document.body.appendChild(container);

        // Create React root
        const root = createRoot(container);

        // Handler functions
        const handleCollect = async () => {
          await this.collectElement(element);
          cleanup();
        };

        const handleApplyCapability = (capability: string) => {
          this.applyCapability(element, capability);
          cleanup();
        };

        const handleCancel = () => {
          cleanup();
        };

        const cleanup = () => {
          root.unmount();
          container.remove();
        };

        // Render the React component
        // @ts-ignore - Dynamic import type issue
        root.render(
          // @ts-ignore - React createElement with dynamic component
          React.createElement(CapabilityModal, {
            element,
            elementHasPlayHTML,
            onCollect: handleCollect,
            onApplyCapability: handleApplyCapability,
            onCancel: handleCancel,
          })
        );
      }

      private async applyCapability(element: HTMLElement, capability: string) {
        // Generate unique ID if element doesn't have one
        if (!element.id) {
          element.id = `playhtml-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        }

        // Add the capability attribute
        element.setAttribute(capability, "");

        // TODO: Initialize PlayHTML on this element
        // TODO: Sync with backend if available

        // Show success notification
        this.showNotification(`Added ${capability} to element!`);
      }

      private async addToInventory(item: any) {
        try {
          // Get current inventory
          const result = await browser.storage.local.get(["gameInventory"]);
          const inventory = result.gameInventory || {
            items: [],
            totalItems: 0,
            lastUpdated: Date.now(),
          };

          // Create new item
          const newItem = {
            ...item,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            collectedAt: Date.now(),
          };

          // Add to inventory
          const updatedInventory = {
            items: [...inventory.items, newItem],
            totalItems: inventory.totalItems + 1,
            lastUpdated: Date.now(),
          };

          // Save to storage
          await browser.storage.local.set({ gameInventory: updatedInventory });

        } catch (error) {
          console.error("Failed to add item to inventory:", error);
        }
      }

      private async checkSiteDiscovery() {
        try {
          const currentDomain = window.location.hostname;

          // Get current inventory to check if we've been to this site before
          const result = await browser.storage.local.get(["gameInventory"]);
          const inventory = result.gameInventory || {
            items: [],
            totalItems: 0,
            lastUpdated: Date.now(),
          };

          // Check if we already have a site signature for this domain
          const existingSiteSignature = inventory.items.find(
            (item: any) =>
              item.type === "site_signature" &&
              item.sourceUrl.includes(currentDomain)
          );

          if (!existingSiteSignature) {
            // This is a new site discovery - collect site signature
            const siteTitle = document.title || currentDomain;
            const description =
              document
                .querySelector('meta[name="description"]')
                ?.getAttribute("content") || `Discovered ${currentDomain}`;

            await this.addToInventory({
              type: "site_signature",
              name: `Site: ${siteTitle}`,
              description: description,
              sourceUrl: window.location.href,
              data: {
                domain: currentDomain,
                title: siteTitle,
                favicon: this.getFaviconUrl(),
                discoveredAt: Date.now(),
              },
            });

          }
        } catch (error) {
          console.error("Failed to check site discovery:", error);
        }
      }

      private getFaviconUrl(): string {
        const faviconLink = document.querySelector(
          'link[rel="icon"], link[rel="shortcut icon"]'
        ) as HTMLLinkElement;
        if (faviconLink) {
          return faviconLink.href;
        }
        return `${window.location.protocol}//${window.location.hostname}/favicon.ico`;
      }

      private setupCollectionDetection() {
        // Look for elements with can-collect attribute
        const collectableElements = document.querySelectorAll("[can-collect]");

        collectableElements.forEach((element) => {
          this.makeElementCollectable(element as HTMLElement);
        });

        // Also watch for dynamically added can-collect elements
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node instanceof HTMLElement) {
                if (node.hasAttribute("can-collect")) {
                  this.makeElementCollectable(node);
                }
                // Check children too
                const collectableChildren =
                  node.querySelectorAll("[can-collect]");
                collectableChildren.forEach((child) => {
                  this.makeElementCollectable(child as HTMLElement);
                });
              }
            });
          });
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }

      private makeElementCollectable(element: HTMLElement) {
        // Store original styles to restore later
        const originalBoxShadow = element.style.boxShadow;
        const originalCursor = element.style.cursor;
        const originalTitle = element.title;

        // Add visual indicator that element is collectable (only during picker mode)
        element.style.boxShadow = "0 0 0 2px rgba(16, 185, 129, 0.3)";
        element.style.cursor = "grab";
        element.title = element.title || "Click to collect this item";

        // Add click handler for collection
        const collectHandler = async (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();

          await this.collectElement(element);

          // Remove collection ability after collecting
          element.removeEventListener("click", collectHandler);

          // Restore original styles instead of applying "collected" styles
          element.style.boxShadow = originalBoxShadow;
          element.style.cursor = originalCursor;
          element.title = originalTitle || "Collected!";
          element.removeAttribute("can-collect");
          element.setAttribute("collected", "true");
        };

        element.addEventListener("click", collectHandler);
      }

      private async collectElement(element: HTMLElement) {
        try {
          // Generate element snapshot
          const snapshot = await this.captureElementSnapshot(element);

          // Get element name from data attribute or generate one
          const itemName =
            element.dataset.collectName ||
            element.getAttribute("aria-label") ||
            element.textContent?.trim().slice(0, 30) ||
            `${element.tagName.toLowerCase()} element`;

          const itemDescription =
            element.dataset.collectDescription ||
            element.title ||
            `Collected from ${window.location.hostname}`;

          await this.addToInventory({
            type: "element",
            name: itemName,
            description: itemDescription,
            sourceUrl: window.location.href,
            data: {
              elementId: element.id || `collected-${Date.now()}`,
              tagName: element.tagName,
              className: element.className || null,
              snapshot: snapshot,
              originalText: element.textContent?.slice(0, 100) || null,
              // Use new comprehensive snapshot structure
              html: snapshot.html,
              styles: snapshot.styles,
              metadata: snapshot.metadata,
              // Keep legacy rect for backward compatibility
              rect: {
                width: snapshot.metadata.dimensions.width,
                height: snapshot.metadata.dimensions.height,
              },
            },
          });

          // Visual feedback that element was collected
          element.style.opacity = "0.5";
          element.style.transform = "scale(0.8)";
          element.style.transition = "all 0.3s ease";

          setTimeout(() => {
            element.style.border = "2px dashed #6366f1";
            element.style.opacity = "0.3";
          }, 300);

          this.showNotification(`Collected: ${itemName}`);
        } catch (error) {
          console.error("Failed to collect element:", error);
          this.showNotification("Failed to collect item");
        }
      }

      private getComputedStyles(element: HTMLElement): Record<string, string> {
        const computed = window.getComputedStyle(element);
        const importantStyles = [
          "color",
          "backgroundColor",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "border",
          "borderRadius",
          "padding",
          "margin",
          "display",
          "position",
          "width",
          "height",
          "textAlign",
        ];

        const styles: Record<string, string> = {};
        importantStyles.forEach((prop) => {
          styles[prop] = computed.getPropertyValue(prop);
        });

        return styles;
      }

      private getComprehensiveStyles(
        element: HTMLElement
      ): Record<string, string> {
        const computed = window.getComputedStyle(element);
        const importantStyles = [
          // Layout
          "display",
          "position",
          "top",
          "right",
          "bottom",
          "left",
          "width",
          "height",
          "minWidth",
          "minHeight",
          "maxWidth",
          "maxHeight",
          "margin",
          "marginTop",
          "marginRight",
          "marginBottom",
          "marginLeft",
          "padding",
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",

          // Typography
          "color",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "fontStyle",
          "lineHeight",
          "textAlign",
          "textDecoration",
          "textTransform",
          "letterSpacing",
          "wordSpacing",

          // Background & Border
          "backgroundColor",
          "backgroundImage",
          "backgroundSize",
          "backgroundRepeat",
          "backgroundPosition",
          "border",
          "borderTop",
          "borderRight",
          "borderBottom",
          "borderLeft",
          "borderRadius",
          "borderWidth",
          "borderStyle",
          "borderColor",

          // Visual Effects
          "opacity",
          "boxShadow",
          "transform",
          "overflow",
          "visibility",
          "cursor",
          "pointerEvents",

          // Flexbox & Grid
          "flexDirection",
          "flexWrap",
          "justifyContent",
          "alignItems",
          "alignSelf",
          "flex",
          "flexGrow",
          "flexShrink",
          "flexBasis",
        ];

        const styles: Record<string, string> = {};
        importantStyles.forEach((prop) => {
          const value = computed.getPropertyValue(prop);
          if (
            value &&
            value !== "auto" &&
            value !== "normal" &&
            value !== "initial"
          ) {
            styles[prop] = value;
          }
        });

        return styles;
      }

      private async captureElementSnapshot(element: HTMLElement): Promise<{
        html: string;
        styles: Record<string, string>;
        metadata: {
          tagName: string;
          textContent: string | null;
          dimensions: { width: number; height: number };
          hasImage: boolean;
          imageUrl?: string;
        };
      }> {
        try {
          const rect = element.getBoundingClientRect();

          // Get the element's HTML (sanitized)
          const clonedElement = element.cloneNode(true) as HTMLElement;

          // Remove any script tags for security
          const scripts = clonedElement.querySelectorAll("script");
          scripts.forEach((script) => script.remove());

          // For images, ensure we capture the src
          let hasImage = false;
          let imageUrl: string | undefined;

          if (element.tagName.toLowerCase() === "img") {
            const imgElement = element as HTMLImageElement;
            imageUrl = imgElement.src || imgElement.currentSrc;
            hasImage = true;
          } else {
            // Check for images within the element
            const images = clonedElement.querySelectorAll("img");
            if (images.length > 0) {
              hasImage = true;
              imageUrl = (images[0] as HTMLImageElement).src;
            }
          }

          // Get comprehensive computed styles
          const computedStyles = this.getComprehensiveStyles(element);

          return {
            html: clonedElement.outerHTML,
            styles: computedStyles,
            metadata: {
              tagName: element.tagName.toLowerCase(),
              textContent: element.textContent,
              dimensions: {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
              hasImage,
              imageUrl,
            },
          };
        } catch (error) {
          console.error("Failed to capture element snapshot:", error);
          // Return a minimal fallback
          return this.createFallbackSnapshot(element);
        }
      }

      private createFallbackSnapshot(element: HTMLElement): {
        html: string;
        styles: Record<string, string>;
        metadata: {
          tagName: string;
          textContent: string | null;
          dimensions: { width: number; height: number };
          hasImage: boolean;
          imageUrl?: string;
        };
      } {
        const rect = element.getBoundingClientRect();
        const tagName = element.tagName.toLowerCase();

        return {
          html: element.outerHTML,
          styles: this.getComputedStyles(element),
          metadata: {
            tagName,
            textContent: element.textContent,
            dimensions: {
              width: Math.round(rect.width) || 100,
              height: Math.round(rect.height) || 60,
            },
            hasImage: tagName === "img",
            imageUrl:
              tagName === "img" ? (element as HTMLImageElement).src : undefined,
          },
        };
      }

      private showNotification(message: string) {
        const notification = document.createElement("div");
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #10b981;
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          z-index: 1000001;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
          notification.style.opacity = "0";
          notification.style.transition = "opacity 0.3s ease";
          setTimeout(() => notification.remove(), 300);
        }, 3000);
      }

      private setupPresenceDetection() {
        // TODO: Implement real-time presence with other players

        // Simple cursor tracking for now
        document.addEventListener("mousemove", (e) => {
          // Throttled cursor position updates will go here
        });
      }
    }

    // Initialize extension when DOM is ready
    let extensionInstance: PlayHTMLExtension | null = null;

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        extensionInstance = new PlayHTMLExtension();
        extensionInstance.init();
      });
    } else {
      extensionInstance = new PlayHTMLExtension();
      extensionInstance.init();
    }

    // Listen for messages from popup/devtools
    browser.runtime.onMessage.addListener(
      (message: any, sender: any, sendResponse: any) => {

        if (message.type === "PING") {
          sendResponse({ status: "pong", url: window.location.href });
          return true; // Keep message channel open for async response
        }

        if (message.type === "CHECK_PLAYHTML_STATUS") {
          const status = extensionInstance?.checkPlayHTMLStatus() || {
            elementCount: 0,
            detected: false,
          };
          sendResponse(status);
          return true; // Keep message channel open for async response
        }

        if (message.type === "ACTIVATE_ELEMENT_PICKER") {
          extensionInstance?.activateElementPicker();
          sendResponse({ success: true });
          return true; // Keep message channel open for async response
        }

        return; // Don't keep the channel open for other message types
      }
    );
  },
});
