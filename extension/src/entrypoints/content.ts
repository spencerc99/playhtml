// ABOUTME: Main content script injected into every web page.
// ABOUTME: Initializes playhtml copresence, data collectors, and domain-specific features.
import browser from "webextension-polyfill";
import {
  MILESTONE_DURATION_MS,
  MILESTONE_TOAST_CSS,
  MILESTONE_TOAST_FONT_URL,
} from "./content/milestone-toast-styles";
import { injectShadow, injectShadowReact, type InjectedReactUI } from "./content/inject-ui";
import { CollectorManager } from "../collectors/CollectorManager";
import { CursorCollector } from "../collectors/CursorCollector";
import { NavigationCollector } from "../collectors/NavigationCollector";
import { ViewportCollector } from "../collectors/ViewportCollector";
import { KeyboardCollector } from "../collectors/KeyboardCollector";
import { VERBOSE } from "../config";
import { getFaviconUrl, getPageTitle } from "../utils/pageMetadata";
import { FLAGS } from "../flags";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  cssInjectionMode: "manifest",
  main() {
    // Don't run collectors or extension features on extension-internal pages
    // (portrait, popup, options, etc.) — they generate noise and can trigger
    // the 64MiB sendMessage limit when the portrait page requests all events.
    const proto = window.location.protocol;
    if (proto === "chrome-extension:" || proto === "moz-extension:") {
      return;
    }

    let currentPresenceCount = 0;

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
          "[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]",
        );

        if (existingElements.length > 0) {
          // TODO: Coordinate with existing PlayHTML instance
        }

        return existingElements.length;
      }

      public checkPlayHTMLStatus() {
        const existingElements = document.querySelectorAll(
          "[can-move], [can-spin], [can-toggle], [can-grow], [can-duplicate], [can-mirror], [can-play]",
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
        elementHasPlayHTML: boolean,
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
          }),
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
              item.sourceUrl.includes(currentDomain),
          );

          if (!existingSiteSignature) {
            // This is a new site discovery - collect site signature
            const siteTitle = getPageTitle(currentDomain);
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
        return getFaviconUrl();
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
        element: HTMLElement,
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
        const { host, shadow } = injectShadow({
          hostStyle: "position:fixed;top:20px;right:20px;z-index:1000001;",
          css: `
            .notification {
              background: #10b981;
              color: white;
              padding: 12px 16px;
              border-radius: 8px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
              opacity: 1;
              transition: opacity 0.3s ease;
            }
            .notification.hiding { opacity: 0; }
          `,
        });
        const notification = document.createElement("div");
        notification.className = "notification";
        notification.textContent = message;
        shadow.appendChild(notification);

        setTimeout(() => {
          notification.classList.add("hiding");
          setTimeout(() => host.remove(), 300);
        }, 3000);
      }

      private hasNativePlayhtml(): boolean {
        // Check DOM signals — these work from the isolated world because the
        // DOM is shared between the page's main world and the extension's
        // isolated world. We can't check window.playhtml since each world
        // has its own window object.
        return (
          !!document.getElementById("playhtml-cursor-styles") ||
          !!document.querySelector("script[src*='/playhtml']") ||
          document.documentElement.dataset.playhtml === "true"
        );
      }

      private waitForNativePlayhtml(timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (this.hasNativePlayhtml()) {
              observer.disconnect();
              resolve(true);
            }
          });
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-playhtml"],
            childList: true,
            subtree: true,
          });
          // Also poll for the style element (added as a child, not an attribute)
          const interval = setInterval(() => {
            if (this.hasNativePlayhtml()) {
              clearInterval(interval);
              observer.disconnect();
              resolve(true);
            }
          }, 100);
          setTimeout(() => {
            clearInterval(interval);
            observer.disconnect();
            resolve(false);
          }, timeoutMs);
        });
      }

      // Send the extension's identity to the page's playhtml instance via a
      // CustomEvent on the shared DOM. The content script can't access
      // window.playhtml (isolated world), and inline <script> injection is
      // blocked by CSP. CustomEvents cross the world boundary via the DOM.
      //
      // Actions taken under the old anonymous identity are intentionally
      // orphaned — anonymous interactions have no continuity expectation.
      private injectIdentityIntoMainWorld() {
        if (!this.playerIdentity) return;

        const dispatch = () => {
          document.dispatchEvent(
            new CustomEvent("playhtml:configure-identity", {
              detail: { playerIdentity: this.playerIdentity },
            }),
          );
        };

        // Dispatch immediately in case playhtml is already listening
        dispatch();

        // Also listen for playhtml signaling it's ready (handles the case
        // where our event fires before playhtml's init sets up the listener)
        document.addEventListener(
          "playhtml:ready",
          () => {
            dispatch();
            console.log(
              "[we-were-online] Re-dispatched identity after playhtml ready signal",
            );
          },
          { once: true },
        );

        console.log("[we-were-online] Dispatched identity injection event");
      }

      private async setupPresenceDetection() {
        // Check immediately — catches pages where playhtml init ran before us
        if (this.hasNativePlayhtml()) {
          console.log("[we-were-online] Native playhtml detected at startup");
          this.injectIdentityIntoMainWorld();
          this.listenForPresenceCount();
          return;
        }

        // Race condition: on dev servers (Vite), page scripts may load after
        // our content script. Wait briefly for the data-playhtml marker or
        // cursor styles to appear before initializing our own instance.
        const nativeAppeared = await this.waitForNativePlayhtml(1500);
        if (nativeAppeared) {
          console.log(
            "[we-were-online] Native playhtml detected after waiting",
          );
          this.injectIdentityIntoMainWorld();
          this.listenForPresenceCount();
          return;
        }

        // Initialize PlayHTML — cursors only enabled on supported sites (e.g. Wikipedia)
        const { initCustomSite, shouldEnableCursors } = await import(
          "../custom-sites"
        );
        const enableCursors = shouldEnableCursors();

        const { playhtml } = await import("playhtml");
        await playhtml.init({
          cursors: {
            enabled: enableCursors,
            playerIdentity: this.playerIdentity,
            coordinateMode: "absolute",
          },
        });
        this.listenForPresenceCount();

        // Initialize domain-specific features (link glow, follow, nav broadcast)
        if (enableCursors) {
          const color =
            this.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#4a9a8a";
          await initCustomSite({
            createPageData: playhtml.createPageData,
            createPresenceRoom: playhtml.createPresenceRoom,
            presence: playhtml.presence,
            cursorClient: playhtml.cursorClient,
            playerColor: color,
          });
        }
      }

      private listenForPresenceCount() {
        if (!("cursors" in window)) return;

        const emit = () => {
          currentPresenceCount = (window as any).cursors.allColors.length;
        };

        (window as any).cursors.on("allColors", emit);
        emit(); // read initial value
      }
    }

    // Initialize extension when DOM is ready
    let extensionInstance: PlayHTMLExtension | null = null;
    let collectorManager: CollectorManager | null = null;
    let overlayUI: InjectedReactUI | null = null;
    let overlayVisible = false;

    const toggleHistoricalOverlay = async () => {
      try {
        overlayVisible = !overlayVisible;

        if (overlayVisible) {
          if (VERBOSE) console.log("[HistoricalOverlay] Activating overlay...");

          // Pause collection while overlay is open — cursor/scroll events from
          // interacting with the overlay UI shouldn't pollute the data.
          collectorManager?.pauseAll();

          const { HistoricalOverlay } = await import("../components/HistoricalOverlay");

          overlayUI = injectShadowReact(
            HistoricalOverlay,
            {
              visible: true,
              currentUrl: window.location.href,
              onClose: () => toggleHistoricalOverlay(),
            },
            {
              hostId: "playhtml-historical-overlay-root",
              fontUrl:
                "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@300;400&family=Lora:ital,wght@1,600&display=swap",
            },
          );

          if (VERBOSE) console.log("[HistoricalOverlay] Overlay activated");
        } else {
          overlayUI?.destroy();
          overlayUI = null;

          // Resume collection now that the overlay is closed.
          collectorManager?.resumeAll();

          if (VERBOSE) console.log("[HistoricalOverlay] Overlay deactivated");
        }
      } catch (error) {
        console.error("[HistoricalOverlay] Failed to toggle overlay:", error);
        overlayVisible = false;
      }
    };

    // Re-render overlay with updated URL on SPA navigation
    const handleNavigation = () => {
      if (overlayVisible && overlayUI) {
        overlayUI.render({
          visible: true,
          currentUrl: window.location.href,
          onClose: () => toggleHistoricalOverlay(),
        });
      }
    };

    window.addEventListener("popstate", handleNavigation);

    // Intercept pushState/replaceState for SPA frameworks
    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      origPushState(...args);
      handleNavigation();
    };
    history.replaceState = (...args) => {
      origReplaceState(...args);
      handleNavigation();
    };

    const initializeCollectors = async () => {
      try {
        if (VERBOSE) {
          console.log("[Collections] Initializing collector manager...");
        }
        collectorManager = new CollectorManager();

        // Register collectors
        const cursorCollector = new CursorCollector();
        collectorManager.registerCollector(cursorCollector);

        const navigationCollector = new NavigationCollector();
        collectorManager.registerCollector(navigationCollector);

        const viewportCollector = new ViewportCollector();
        collectorManager.registerCollector(viewportCollector);

        const keyboardCollector = new KeyboardCollector();
        collectorManager.registerCollector(keyboardCollector);

        // Initialize manager (loads saved enabled state)
        await collectorManager.init();
        if (VERBOSE) {
          console.log(
            "[Collections] Collector manager initialized successfully",
          );
        }

        // One-time migration of page-origin IndexedDB events to extension-origin
        const migrationKey = `migration_v1_done_${window.location.hostname}`;
        try {
          const migrationResult = await browser.storage.local.get([
            migrationKey,
          ]);
          if (!migrationResult[migrationKey]) {
            const { LocalEventStore } = await import(
              "../storage/LocalEventStore"
            );
            const pageStore = new LocalEventStore();
            const events = await pageStore.getAllEvents();
            if (events.length > 0) {
              await browser.runtime.sendMessage({
                type: "STORE_EVENTS",
                events,
              });
            }
            await browser.storage.local.set({ [migrationKey]: true });
          }
        } catch (e) {
          // Migration is best-effort; don't break collection if it fails
          console.warn("[Content] Migration failed:", e);
        }
      } catch (error) {
        console.error(
          "[Collections] Failed to initialize collector manager:",
          error,
        );
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        if (FLAGS.COPRESENCE) {
          extensionInstance = new PlayHTMLExtension();
          extensionInstance.init();
        }
        initializeCollectors().catch(console.error);
        setupModeChangeListener();
      });
    } else {
      if (FLAGS.COPRESENCE) {
        extensionInstance = new PlayHTMLExtension();
        extensionInstance.init();
      }
      initializeCollectors().catch(console.error);
      setupModeChangeListener();
    }

    // Keyboard shortcut for overlay (Cmd/Ctrl+Shift+H)
    document.addEventListener("keydown", (e) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "H" || e.key === "h")
      ) {
        e.preventDefault();
        toggleHistoricalOverlay();
      }
    });

    const showMilestoneToast = (milestone: {
      type: "cursorDistance" | "screenTime" | "sitesExplored" | "domainVisits";
      displayValue: string;
      copy: string;
      ctaLabel: string;
      ctaAction: "TOGGLE_HISTORICAL_OVERLAY" | "OPEN_PORTRAIT";
      period: "today" | "alltime";
      domain?: string;
      faviconUrl?: string;
      sparkline?: number[];
    }): void => {
      let accentHtml = "";

      if (milestone.type === "cursorDistance") {
        const cursorPath1 =
          "m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z";
        const cursorPath2 =
          "m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z";
        const svgGhost = (cls: string) =>
          `<svg class="wwo-cursor-svg ${cls}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <path d="${cursorPath1}" fill="#4a9a8a"/>
            <path d="${cursorPath2}" fill="#4a9a8a"/>
          </svg>`;
        accentHtml = `
          <div class="wwo-cursor-trail">
            ${svgGhost("wwo-c3")}${svgGhost("wwo-c2")}${svgGhost(
          "wwo-c1",
        )}${svgGhost("wwo-c0")}
          </div>
          <div class="wwo-toast-stat">${milestone.displayValue.replace(
            " mi",
            "",
          )}</div>
          <div class="wwo-toast-unit">miles</div>
        `;
      } else if (milestone.type === "screenTime") {
        const parts = milestone.displayValue.split(" ");
        const statHtml =
          parts.length === 2
            ? `${parts[0]}<br>${parts[1]}`
            : milestone.displayValue;
        const bars = (milestone.sparkline ?? Array(7).fill(0.5))
          .map((v, i) => {
            const height = Math.max(Math.round(v * 100), 5);
            const isCurrent = i === 6;
            return `<div class="wwo-spark-bar${
              isCurrent ? " wwo-current" : ""
            }" style="height:${height}%"></div>`;
          })
          .join("");
        accentHtml = `
          <div class="wwo-toast-stat wwo-toast-stat-sm">${statHtml}</div>
          <div class="wwo-sparkline">${bars}</div>
        `;
      } else if (milestone.type === "sitesExplored") {
        const dots = [
          { top: 1, left: 5, size: 3, opacity: 0.35 },
          { top: 6, left: 22, size: 4, opacity: 0.65 },
          { top: 14, left: 8, size: 3, opacity: 0.45 },
          { top: 2, left: 33, size: 5, opacity: 0.85 },
          { top: 18, left: 30, size: 3, opacity: 0.4 },
          { top: 9, left: 16, size: 3, opacity: 0.55 },
        ]
          .map(
            (d) =>
              `<div style="position:absolute;top:${d.top}px;left:${d.left}px;width:${d.size}px;height:${d.size}px;border-radius:50%;background:#4a9a8a;opacity:${d.opacity}"></div>`,
          )
          .join("");
        accentHtml = `
          <div class="wwo-toast-stat">${milestone.displayValue}</div>
          <div class="wwo-toast-unit">domains</div>
          <div class="wwo-scatter">${dots}</div>
        `;
      } else {
        const faviconHtml = milestone.faviconUrl
          ? `<img class="wwo-favicon-img" src="${milestone.faviconUrl}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` +
            `<span class="wwo-favicon-fallback" style="display:none">${(milestone.domain ??
              "?")[0].toUpperCase()}</span>`
          : `<span class="wwo-favicon-fallback">${(milestone.domain ??
              "?")[0].toUpperCase()}</span>`;
        accentHtml = `
          <div class="wwo-favicon-wrap">${faviconHtml}</div>
          <div class="wwo-toast-stat" style="margin-top:5px">${milestone.displayValue}</div>
        `;
      }

      const badgeClass =
        milestone.period === "today" ? "wwo-today" : "wwo-alltime";
      const badgeLabel = milestone.period === "today" ? "today" : "all time";

      // Shadow DOM host — position: fixed on the host, toast styles isolated inside.
      const { host, shadow } = injectShadow({
        hostStyle: "position:fixed;bottom:20px;left:20px;z-index:2147483647;",
        css: MILESTONE_TOAST_CSS,
        fontUrl: MILESTONE_TOAST_FONT_URL,
      });

      const toast = document.createElement("div");
      toast.className = "wwo-milestone-toast";
      toast.innerHTML = `
        <div class="wwo-toast-wordmark">wwo</div>
        <div class="wwo-toast-body">
          <div class="wwo-toast-accent">${accentHtml}</div>
          <div class="wwo-toast-text">
            <div class="wwo-toast-badge ${badgeClass}">${badgeLabel}</div>
            <p class="wwo-toast-headline">${milestone.copy}</p>
            <button class="wwo-toast-cta" data-action="${milestone.ctaAction}">${milestone.ctaLabel}</button>
          </div>
        </div>
      `;
      shadow.appendChild(toast);

      const dismiss = () => {
        toast.classList.remove("wwo-visible");
        toast.classList.add("wwo-hiding");
        setTimeout(() => host.remove(), 400);
      };

      const cta = toast.querySelector<HTMLButtonElement>(".wwo-toast-cta");
      cta?.addEventListener("click", () => {
        if (milestone.ctaAction === "TOGGLE_HISTORICAL_OVERLAY") {
          toggleHistoricalOverlay();
        } else {
          browser.runtime.sendMessage({
            type: "OPEN_TAB",
            url: browser.runtime.getURL("popup.html"),
          });
        }
        dismiss();
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add("wwo-visible"));
      });

      setTimeout(dismiss, MILESTONE_DURATION_MS);
    };

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

        if (message.type === "TOGGLE_HISTORICAL_OVERLAY") {
          toggleHistoricalOverlay();
          sendResponse({ success: true, visible: overlayVisible });
          return true;
        }

        if (message.type === "SHOW_MILESTONE") {
          showMilestoneToast(message.milestone);
          sendResponse({ success: true });
          return true;
        }

        // Collector management messages
        if (message.type === "GET_COLLECTOR_STATUSES") {
          if (!collectorManager) {
            sendResponse({
              statuses: [],
              error: "Collector manager not initialized",
            });
            return true;
          }
          const statuses = collectorManager.getCollectorStatuses();
          sendResponse({ statuses });
          return true;
        }

        if (message.type === "ENABLE_COLLECTOR") {
          if (!collectorManager) {
            sendResponse({
              success: false,
              error: "Collector manager not initialized",
            });
            return true;
          }
          if (!message.collectorType) {
            sendResponse({ success: false, error: "Missing collectorType" });
            return true;
          }
          collectorManager
            .enableCollector(message.collectorType)
            .then(() => {
              sendResponse({ success: true });
            })
            .catch((error) => {
              console.error("Failed to enable collector:", error);
              sendResponse({
                success: false,
                error: error.message || String(error),
              });
            });
          return true;
        }

        if (message.type === "DISABLE_COLLECTOR") {
          if (!collectorManager) {
            sendResponse({
              success: false,
              error: "Collector manager not initialized",
            });
            return true;
          }
          if (!message.collectorType) {
            sendResponse({ success: false, error: "Missing collectorType" });
            return true;
          }
          collectorManager
            .disableCollector(message.collectorType)
            .then(() => {
              sendResponse({ success: true });
            })
            .catch((error) => {
              console.error("Failed to disable collector:", error);
              sendResponse({
                success: false,
                error: error.message || String(error),
              });
            });
          return true;
        }

        if (message.type === "FLUSH_EVENTS") {
          if (!collectorManager) {
            sendResponse({
              success: false,
              error: "Collector manager not initialized",
            });
            return true;
          }
          collectorManager
            .flushEvents()
            .then(() => {
              browser.runtime
                .sendMessage({ type: "GET_PENDING_COUNT" })
                .then((res: any) => {
                  sendResponse({
                    success: true,
                    pendingCount: res?.count ?? 0,
                  });
                })
                .catch(() => {
                  sendResponse({ success: true, pendingCount: 0 });
                });
            })
            .catch((error) => {
              console.error("Failed to flush events:", error);
              sendResponse({
                success: false,
                error: error.message || String(error),
              });
            });
          return true;
        }

        if (message.type === "GET_PRESENCE_COUNT") {
          sendResponse({ count: currentPresenceCount });
          return true;
        }

        return; // Don't keep the channel open for other message types
      },
    );

    function setupModeChangeListener() {
      try {
        browser.storage.onChanged.addListener((changes, area) => {
          if (area !== "local" || !collectorManager) return;
          for (const key of Object.keys(changes)) {
            if (key.startsWith("collection_mode_")) {
              const type = key.replace("collection_mode_", "");
              const next = changes[key]?.newValue;
              const normalized =
                next === "off" || next === "local" || next === "shared"
                  ? next
                  : "local";
              if (normalized === "off") {
                collectorManager
                  .disableCollector(type as any)
                  .catch(console.error);
              } else {
                collectorManager
                  .enableCollector(type as any)
                  .catch(console.error);
              }
            }
          }
        });
      } catch (e) {
        console.warn("[Content] Failed to set up mode change listener", e);
      }
    }
  },
});
