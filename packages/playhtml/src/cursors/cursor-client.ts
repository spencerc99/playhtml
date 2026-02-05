import type YPartyKitProvider from "y-partykit/provider";
import {
  CursorPresence,
  CursorPresenceView,
  PlayerIdentity,
  Cursor,
  generatePersistentPlayerIdentity,
  PROXIMITY_THRESHOLD,
  PLAYER_IDENTITY_STORAGE_KEY,
  CursorEvents,
} from "@playhtml/common";
import { SpatialGrid } from "./spatial-grid";
import type { CursorOptions } from "..";
import { CursorChat } from "./chat";
import randomColor from "randomcolor";

// Reserved awareness field for cursors - won't conflict with user awareness
const CURSOR_AWARENESS_FIELD = "__playhtml_cursors__";

// Global cursor API interface (like cursor-party)

export function calculateDistance(cursor1: Cursor, cursor2: Cursor): number {
  return Math.sqrt(
    Math.pow(cursor1.x - cursor2.x, 2) + Math.pow(cursor1.y - cursor2.y, 2)
  );
}

interface CursorEventEmitter {
  on<K extends keyof CursorEvents>(
    event: K,
    callback: (value: CursorEvents[K]) => void
  ): void;
  off<K extends keyof CursorEvents>(
    event: K,
    callback: (value: CursorEvents[K]) => void
  ): void;
}

declare global {
  interface Window {
    cursors?: CursorEvents & {
      on: CursorEventEmitter["on"];
      off: CursorEventEmitter["off"];
    };
  }
}

// SVG cursor creation utilities (from cursor-party)
function encodeSVG(svgData: string): string {
  svgData = svgData.replace(/"/g, `'`);
  svgData = svgData.replace(/>\s{1,}</g, `><`);
  svgData = svgData.replace(/\s{2,}/g, ` `);
  const symbols = /[\r\n%#()<>?[\\\]^`{|}]/g;
  return svgData.replace(symbols, encodeURIComponent);
}

function getSvgForCursor(color: string): string {
  return `<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="10 9 18 18"
    width="18"
    height="18"
    fill="none"
    fillRule="evenodd"
  >
    <g fill="rgba(0,0,0,.2)" transform="translate(1,1)">
      <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" />
      <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" />
    </g>
    <g fill="white">
      <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" />
      <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" />
    </g>
    <g fill="${color}">
      <path d="m19.751 24.4155-1.844.774-3.1-7.374 1.841-.775z" />
      <path d="m13 10.814v11.188l2.969-2.866.428-.139h4.768z" />
    </g>
  </svg>`;
}

function getCursorStyleForUser(color: string): string {
  const userCursorSvgEncoded = encodeSVG(getSvgForCursor(color));
  return `url("data:image/svg+xml,${userCursorSvgEncoded}"), auto`;
}

function extractUrlFromCursorStyle(cursorStyle: string): string | undefined {
  if (!cursorStyle.startsWith('url("')) {
    return;
  }
  cursorStyle = cursorStyle.slice(5);

  if (!cursorStyle.endsWith('"), auto') && !cursorStyle.endsWith('")')) {
    return;
  }
  if (cursorStyle.endsWith('"), auto')) {
    cursorStyle = cursorStyle.slice(0, cursorStyle.length - 8);
  } else {
    cursorStyle = cursorStyle.slice(0, cursorStyle.length - 2);
  }

  return cursorStyle;
}

export class CursorClientAwareness {
  private cursors: Map<string, HTMLElement> = new Map();
  private spatialGrid: SpatialGrid<CursorPresence> = new SpatialGrid(300); // 300px cell size
  private proximityUsers: Set<string> = new Set();
  private currentCursor: Cursor | null = null;
  private playerIdentity: PlayerIdentity;
  private updateThrottled: boolean = false;
  private lastUpdate: number = 0;
  private visibilityThreshold: number | undefined;
  private isStylesAdded: boolean = false;
  private globalApiListeners = new Map<keyof CursorEvents, Set<Function>>();
  private allPlayerColors: Set<string> = new Set();
  private chat: CursorChat | null = null;
  private currentMessage: string | null = null;
  private otherUsersWithMessages: Set<string> = new Set();
  private cursorPresenceChangeCallbacks = new Map<
    string,
    (presences: Map<string, CursorPresenceView>) => void
  >();

  constructor(
    private provider: YPartyKitProvider,
    private options: CursorOptions = {}
  ) {
    this.playerIdentity =
      options.playerIdentity || generatePersistentPlayerIdentity();
    this.visibilityThreshold = options.visibilityThreshold || undefined;

    if (this.options.enableChat === true) {
      this.chat = new CursorChat({
        onMessageUpdate: (message) => {
          this.currentMessage = message;
          this.updateCursorAwareness();
        },
      });
    }

    this.initialize();
    this.setupGlobalAPI();
  }

  private initialize(): void {
    this.addCursorStyles();
    this.setupCursorTracking();
    this.setupAwarenessHandling();

    // Set initial cursor style
    const primaryColor =
      this.playerIdentity.playerStyle.colorPalette[0] ||
      randomColor({ luminosity: "bright" });
    document.documentElement.style.cursor = getCursorStyleForUser(primaryColor);
  }

  private setupAwarenessHandling(): void {
    // Listen to awareness changes for cursor updates
    this.provider.awareness.on("change", ({ added, updated, removed }: any) => {
      this.handleAwarenessChange(added, updated, removed);
    });

    // Initial sync of existing awareness states
    // First, publish our own player identity so others (and us) see it immediately
    this.updateCursorAwareness();
    // Then, sync existing states (including ours) into local structures
    this.syncExistingAwareness();
  }

  private syncExistingAwareness(): void {
    const states = this.provider.awareness.getStates();
    const added = Array.from(states.keys());
    this.handleAwarenessChange(added, [], []);
  }

  private handleAwarenessChange(
    added: number[],
    updated: number[],
    removed: number[]
  ): void {
    const states = this.provider.awareness.getStates();

    // Handle added and updated cursors
    [...added, ...updated].forEach((clientId) => {
      const clientState = states.get(clientId);
      const cursorData = clientState?.[CURSOR_AWARENESS_FIELD];

      if (cursorData && clientId !== this.provider.awareness.clientID) {
        this.updateCursor(clientId.toString(), cursorData);
      }

      // Track messages for chat CTA
      if (cursorData?.message) {
        this.otherUsersWithMessages.add(clientId.toString());
      } else {
        this.otherUsersWithMessages.delete(clientId.toString());
      }
    });

    // Handle removed cursors
    removed.forEach((clientId) => {
      this.removeCursor(clientId.toString());
      this.otherUsersWithMessages.delete(clientId.toString());
    });

    // Rebuild spatial grid with updated cursor data
    this.rebuildSpatialGrid();

    // Recompute all player colors from current awareness states
    this.allPlayerColors.clear();
    states.forEach((clientState) => {
      const cursorData = clientState?.[CURSOR_AWARENESS_FIELD];
      const color = cursorData?.playerIdentity?.playerStyle?.colorPalette?.[0];
      if (color) this.allPlayerColors.add(color);
    });

    this.updateGlobalColors();
    this.updateChatCTA();
    this.checkProximityOptimized();

    // Notify cursor presence listeners of changes
    this.notifyCursorPresenceListeners();
  }

  private rebuildSpatialGrid(): void {
    this.spatialGrid.clear();

    const states = this.provider.awareness.getStates();
    const myClientId = this.provider.awareness.clientID;

    states.forEach((clientState, clientId) => {
      if (clientId === myClientId) return;

      const cursorData = clientState?.[CURSOR_AWARENESS_FIELD];
      if (cursorData?.cursor) {
        this.spatialGrid.insert({
          id: clientId.toString(),
          x: cursorData.cursor.x,
          y: cursorData.cursor.y,
          data: cursorData,
        });
      }
    });
  }

  private checkProximityOptimized(): void {
    if (!this.currentCursor) return;

    const currentProximity = new Set<string>();
    const proximityThreshold =
      this.options.proximityThreshold || PROXIMITY_THRESHOLD;

    // Use spatial grid to efficiently find nearby cursors
    const nearbyItems = this.spatialGrid.findNearby(
      this.currentCursor.x,
      this.currentCursor.y,
      proximityThreshold
    );

    // Check precise distance for nearby candidates
    for (const item of nearbyItems) {
      const presence = item.data;
      if (!presence.cursor) continue;

      const distance = calculateDistance(this.currentCursor, presence.cursor);
      const isNear = distance < proximityThreshold;

      if (isNear) {
        currentProximity.add(item.id);

        // Trigger proximity entered if this is new
        if (!this.proximityUsers.has(item.id)) {
          const positions = {
            ours: { x: this.currentCursor.x, y: this.currentCursor.y },
            theirs: { x: presence.cursor.x, y: presence.cursor.y },
          };
          const dx = presence.cursor.x - this.currentCursor.x;
          const dy = presence.cursor.y - this.currentCursor.y;
          const angle = Math.atan2(dy, dx);

          this.options.onProximityEntered?.(
            presence.playerIdentity,
            positions,
            angle
          );
        }
      }
    }

    // Check for users who left proximity
    for (const connectionId of this.proximityUsers) {
      if (!currentProximity.has(connectionId)) {
        this.options.onProximityLeft?.(connectionId);
      }
    }

    this.proximityUsers = currentProximity;
  }

  private addCursorStyles(): void {
    if (this.isStylesAdded || document.getElementById("playhtml-cursor-styles"))
      return;

    const style = document.createElement("style");
    style.id = "playhtml-cursor-styles";
    style.textContent = `
      .playhtml-cursor-other {
        position: fixed;
        width: 32px;
        height: 32px;
        pointer-events: none;
        z-index: 999999;
        transition: all 0.1s ease;
        transform-origin: center;
      }
      
      .playhtml-cursor-fade-in {
        animation: cursorFadeIn 0.3s ease-out;
      }
      
      .playhtml-cursor-fade-out {
        animation: cursorFadeOut 0.3s ease-out;
        opacity: 0;
      }
      
      @keyframes cursorFadeIn {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }
      
      @keyframes cursorFadeOut {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.8); }
      }
    `;
    document.head.appendChild(style);
    this.isStylesAdded = true;
  }

  private setupCursorTracking(): void {
    const updateCursor = (e: MouseEvent) => {
      let pointer = "mouse";
      const element = document.elementFromPoint(e.clientX, e.clientY);

      if (element) {
        const style = window.getComputedStyle(element);
        const maybeCustomCursor = extractUrlFromCursorStyle(style.cursor);

        if (maybeCustomCursor) {
          const ourColor =
            this.playerIdentity.playerStyle.colorPalette[0] || "#3b82f6";
          const ourCursorSvg = encodeSVG(getSvgForCursor(ourColor));

          if (!maybeCustomCursor.includes(ourCursorSvg)) {
            pointer = maybeCustomCursor;
          }
        }
      }

      // Show/hide our own cursor based on pointer type (like cursor-party)
      if (pointer === "mouse") {
        const cursorStyle = getCursorStyleForUser(
          this.playerIdentity.playerStyle.colorPalette[0] || "#3b82f6"
        );
        document.documentElement.style.cursor = cursorStyle;
      } else {
        document.documentElement.style.cursor = "auto";
      }

      this.currentCursor = {
        x: e.clientX,
        y: e.clientY,
        pointer,
      };
      this.throttledUpdateCursorAwareness();

      // Update visibility of all other cursors when our cursor moves
      this.updateAllCursorVisibility();
    };

    const updateTouchCursor = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        this.currentCursor = {
          x: touch.clientX,
          y: touch.clientY,
          pointer: "touch",
        };
        this.throttledUpdateCursorAwareness();

        // Update visibility of all other cursors when our cursor moves
        this.updateAllCursorVisibility();
      }
    };

    const handleTouchEnd = () => {
      this.currentCursor = null;
      this.updateCursorAwareness();
    };

    document.addEventListener("mousemove", updateCursor);
    document.addEventListener("touchmove", updateTouchCursor);
    document.addEventListener("touchend", handleTouchEnd);

    // Handle leaving the page/window
    document.addEventListener("mouseleave", (e) => {
      this.currentCursor = null;
      this.updateCursorAwareness();
      // When cursor leaves, show all cursors (no visibility restriction)
      this.showAllCursors();
    });
  }

  private throttledUpdateCursorAwareness(): void {
    if (this.updateThrottled) return;

    this.updateThrottled = true;
    const now = performance.now();
    const elapsed = now - this.lastUpdate;
    const targetInterval = 1000 / 60; // 60fps

    if (elapsed >= targetInterval) {
      this.updateCursorAwareness();
      this.lastUpdate = now;
      this.updateThrottled = false;
    } else {
      setTimeout(() => {
        this.updateCursorAwareness();
        this.lastUpdate = performance.now();
        this.updateThrottled = false;
      }, targetInterval - elapsed);
    }
  }

  private updateCursorAwareness(): void {
    const cursorPresence: CursorPresence = {
      cursor: this.currentCursor,
      playerIdentity: this.playerIdentity,
      lastSeen: Date.now(),
      message: this.currentMessage,
      page: window.location.pathname,
    };

    // Set cursor data in awareness using reserved field
    this.provider.awareness.setLocalStateField(
      CURSOR_AWARENESS_FIELD,
      cursorPresence
    );
  }

  private updateCursor(clientId: string, cursorData: CursorPresence): void {
    if (!cursorData.cursor) {
      this.removeCursor(clientId);
      return;
    }

    // Check if this cursor should be rendered
    if (this.options.shouldRenderCursor && !this.options.shouldRenderCursor(cursorData)) {
      this.removeCursor(clientId);
      return;
    }

    let cursorElement = this.cursors.get(clientId);
    const cursor = cursorData.cursor;

    // Check if cursor element needs to be recreated due to pointer type change
    const needsRecreation =
      cursorElement && cursorElement.dataset.pointerType !== cursor.pointer;

    if (!cursorElement || needsRecreation) {
      if (cursorElement) {
        cursorElement.remove();
      }
      cursorElement = this.createCursorElement(
        cursorData.playerIdentity,
        cursor.pointer,
        cursorData.message,
        clientId,
        cursorData
      );
      cursorElement.dataset.pointerType = cursor.pointer;
      this.cursors.set(clientId, cursorElement);
      document.body.appendChild(cursorElement);
    } else if (cursorElement) {
      // Update existing cursor with new message and name
      this.updateCursorMessage(
        cursorElement,
        cursorData.playerIdentity,
        cursorData.message
      );
      this.updateCursorName(cursorElement, cursorData.playerIdentity);
    }

    // Update position with boundary checks
    const cursorSize = 20;
    const margin = 2;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const clampedX = Math.max(
      -cursorSize + margin,
      Math.min(viewportWidth - margin, cursor.x)
    );
    const clampedY = Math.max(
      -cursorSize + margin,
      Math.min(viewportHeight - margin, cursor.y)
    );

    cursorElement.style.position = "fixed";
    cursorElement.style.left = `${clampedX}px`;
    cursorElement.style.top = `${clampedY}px`;
    cursorElement.style.zIndex = "999999";
    cursorElement.style.pointerEvents = "none";

    // Handle visibility based on distance from our cursor
    if (this.currentCursor) {
      const distance = calculateDistance(cursor, this.currentCursor);
      const isVisible = this.visibilityThreshold
        ? distance < this.visibilityThreshold
        : true;

      cursorElement.style.display = isVisible ? "block" : "none";
      cursorElement.style.opacity = isVisible ? "1" : "0";
      cursorElement.style.transform = isVisible ? "scale(1)" : "scale(0.8)";
    } else {
      cursorElement.style.display = "block";
      cursorElement.style.opacity = "1";
      cursorElement.style.transform = "scale(1)";
    }
  }

  private createCursorElement(
    playerIdentity?: PlayerIdentity,
    pointer: string = "mouse",
    message?: string | null,
    connectionId?: string,
    cursorData?: CursorPresence
  ): HTMLElement {
    const element = document.createElement("div");
    element.className = "playhtml-cursor-other playhtml-cursor-fade-in";

    // Check for custom cursor renderer first
    if (connectionId && this.options.onCustomCursorRender) {
      const customElement = this.options.onCustomCursorRender(
        connectionId,
        element
      );
      if (customElement) {
        return customElement;
      }
    }

    const color = playerIdentity?.playerStyle?.colorPalette?.[0] || "#3b82f6";

    // Render different cursor based on pointer type
    switch (pointer) {
      case "mouse":
        element.innerHTML = this.getMouseCursorSVG(color);
        break;
      case "touch":
        element.innerHTML = this.getTouchCursorSVG(color);
        break;
      default:
        element.innerHTML = this.getCustomCursorSVG(color, pointer);
        break;
    }

    if (this.options.cursorStyle) {
      element.style.cssText += this.options.cursorStyle;
    }

    // Add message and name if present
    this.updateCursorMessage(element, playerIdentity, message);
    this.updateCursorName(element, playerIdentity);

    // Apply custom cursor styles if provided
    if (this.options.getCursorStyle && cursorData) {
      const customStyles = this.options.getCursorStyle(cursorData);
      Object.assign(element.style, customStyles);
    }

    return element;
  }

  private getMouseCursorSVG(fill: string): string {
    return `
      <svg
        height="32"
        viewBox="0 0 32 32"
        width="32"
        xmlns="http://www.w3.org/2000/svg"
        style="pointer-events: none;"
      >
        <g fill="none" fillRule="evenodd" transform="translate(10 7)">
          <path
            d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z"
            fill="#fff"
          />
          <path
            d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z"
            fill="${fill}"
          />
        </g>
      </svg>
    `;
  }

  private getTouchCursorSVG(fill: string): string {
    return `
      <svg
        height="32"
        viewBox="0 0 32 32"
        width="32"
        xmlns="http://www.w3.org/2000/svg"
        style="pointer-events: none;"
      >
        <g fill="none" fillRule="evenodd" transform="translate(9 8)">
          <path
            d="m3.8852309 13.5522788c.15029277.1354048.25406355.2326609.57471053.5372549.31406586.2983172.46594413.439273.60482646.5572091.05791893.0487853.10729946.1792495.12686364.3731628.01609788.1595565.01049553.3375341-.0090192.5090254-.00674888.0593077-.01325791.1020883-.01698742.1224696-.04186639.2287942.13249226.4401222.36507344.4424801.20929712.0021219.37056581.00472.79741331.0123273.10679864.0019014.10679864.0019014.21395196.0037648 1.16029156.0199598 1.75290683.01448 2.1782236-.039003.45462139-.05716.92282087-.6061887 1.32754658-1.2951218.3429437.6096032.818651 1.2048784 1.2990136 1.282277.1525992.0243739.3372104.0319365.5511764.0270146.1595258-.0036697.328349-.0141847.4987188-.0294071.1284742-.0114791.2308379-.0230173.2919821-.0309462.2259121-.0292954.3737346-.2515956.31337-.4712558-.0130388-.0474468-.0339905-.1345046-.0551176-.2441066-.0244927-.1270617-.0421932-.2511642-.0502379-.3642189-.0051002-.0716765-.0061057-.1365707-.0028638-.1926702.0056365-.097781.007395-.1525378.0101327-.2790463.0010457-.0470941.0010457-.0470941.0024433-.0883088.0052898-.134881.0234093-.2629524.0820463-.5422232.0251901-.1212103.1472903-.3531692.3395862-.6402332.0572734-.0854992.1198813-.1747825.1869659-.2669588.127207-.1747861.2641214-.3514011.4010853-.5204043.0820457-.1012383.1454717-.1769623.1807968-.2180763.2962199-.424403.6120842-1.1191696.7281396-1.5253635.111416-.3904017.2005405-1.10937558.2553074-1.81604479.0300143-.40088807.0411211-.72405394.0411211-1.23097561.0000507-.08891816.0000507-.08891816.0002032-.16234685.0002858-.12025251.0003032-.16573976-.0000887-.22195195-.0010706-.15358041-.0055478-.30580145-.0203882-.6940256-.0319191-.81365149-.4778003-1.3396911-1.1348711-1.44115781-.5589865-.08632026-1.2393839.37795756-1.2393839.37795756s-.1514404-.5228127-.2537197-.6842075c-.1661957-.25934741-.5941748-.58982828-.9213451-.65421118-.3365014-.0653413-.7354024-.05811592-1.1017193.00667481-.3207944.05740454-.64034865.34382687-.82518751.65277182-.13223727.22039488-.00786932-.01169164-.14013104-.2396787-.1830552-.31402315-.60932935-.59522407-1.01524567-.67822294-.34396352-.07112559-.73801897-.04403625-1.09795562.06293793-.46304125.13836397-.53675291.49073282-.55516748.38984626-.06158674-.3382385-.06727482-.3160095-.105656-.55729603-.14258072-.89527436-.30213161-1.51473549-.54406219-2.05528331.01391678.0310773-.08860981-.20214701-.12592279-.28256779-.06461002-.13925416-.12910532-.2652956-.19999629-.38652204-.21850342-.37364978-.46891278-.65340904-.7830908-.81233894-.54561037-.27629378-1.3634177-.14183064-1.75105565.31064856-.38495968.44966797-.4491432 1.20149287-.3521966 2.13184003.03702376.36121263.16678627 1.02066144.28444961 1.50812387.04160602.1691894.07805979.32348903.14491578.60851331.01149723.04848415.01149723.04848415.02309483.09698036.05172236.21571896.09707607.39320067.15122332.5879629-.00568154-.02030261.09701461.344086.11888835.42472961.00727686.02691587.00727686.02691587.01448296.05395339.04082856.15377935.08074083.31959314.14309954.5963099.03412572.1521447.06742545.31468601.09999775.48699018.08883553.46993091.089274.37207374.00375852.27186198-.05907319-.06922522-.11463055-.13209255-.16830659-.19003644-.09976937-.10770214-.19148509-.19677225-.2785569-.2678141-.6343975-.51905295-1.02312991-.74839425-1.55681885-.79878106-.87541567-.08410158-1.70619803.53426712-1.83111632 1.36882761-.07682697.51169638-.05207639.74723271.18463583 1.19942735.13026223.24432805.35060714.53942202.76172732 1.04735429.02515953.031068.02515953.031068.05030428.06206416.50464537.62186746.55962098.69095396.67961467.86473786.32435479.4706845 1.1139501 1.8221455 1.25748612 2.0035872z"
            fill="${fill}"
          />
          <path
            d="m1.68266944 9.2716401c-.02488625-.03067752-.02488625-.03067752-.04970567-.06132555-.37729166-.46613768-.58418002-.74321015-.68156241-.9258495-.15281729-.29195235-.1611316-.37107459-.10605794-.73788601.06473349-.43247455.53181583-.78013371 1.01829549-.73339767.33660502.03178017.63068475.20527903 1.15339692.63295262.0565942.04617564.12482853.1124417.20288232.19670163.04616569.04983637.09513192.10524534.14800114.16720042.0794093.0930562.34702847.42052231.30761424.37286894.05814283.06991619.09971852.12407704.14721655.19045018.0941062.13434104.14705111.20894642.21874992.30454484-.0336171-.04487143.21473082.29843305.26732159.34863333.27859812.26593456.68203289.04195871.65675979-.31244785-.00421914-.05916537-.01812774-.12308431-.04717934-.23466885-.11487425-.81923739-.15505751-1.08218312-.24678252-1.56739907-.03407352-.18024544-.06905328-.35098727-.10521102-.5121905-.06435409-.28557213-.10635725-.46007245-.14994794-.62425526-.00774801-.02907063-.00774801-.02907063-.01552357-.05783095-.02300644-.08481964-.12725123-.45470311-.12030828-.42989063-.05134381-.18468043-.0945453-.35373996-.14431997-.56133562-.01130896-.04728909-.01130896-.04728909-.02259904-.09489949-.06649254-.28350912-.10387999-.44176072-.14606063-.6132721-.10998732-.45567652-.23425389-1.08719519-.2671036-1.40768017-.07546665-.72422018-.02339381-1.33418457.17582284-1.56688778.15554834-.1815673.59641015-.25405339.84271752-.12932486.16107512.0814814.32204278.26131571.47435101.521769.05764302.09857191.11172763.20426801.16708381.32357735.0335256.07225783.13292567.29837003.12172905.27336705.21032209.46992469.354801 1.03086841.48791736 1.86671535.03939531.24766201.08813662.52823537.15063928.87150416.01857903.10178746.01857903.10178746.03722922.20314381.30139226 1.63533599.27933797 1.51139381.28367122 1.64182468.01580667.47578071.71810567.4869267.74900255.01188722.00979855-.15065269.00630989-.2851661-.01107827-.67146517-.00245496-.05465243-.00245496-.05465243-.00481877-.10910149-.01521525-.35590459-.01433687-.56066672.00670546-.67705709.03834708-.21223125.22887-.4499778.40434754-.50241339.24641865-.07323589.51640341-.09179599.73269877-.04707051.20703808.0423346.44864736.20171736.51796318.32062499.08353628.14399789.15516008.36337367.21006107.63530456.04431149.21947986.07480439.45493493.0962536.70624261.00667352.0781897.01103024.13859819.01772256.23854675.00285005.04183594.00285005.04183594.00568968.07635213.00160285.01731471.00160285.01731471.00551199.04467336.00303535.01917374.00303535.01917374.01734216.06773608.00727602.13782339.00727602.13782339.56081544.18893151.16530264-.19982737.16530264-.19982737.16077268-.23486454.02708074-.1183491.04365279-.250265.06727822-.49813693.01508098-.16112409.02268576-.24033521.03157416-.32249887.036794-.34012028.0835164-.55621578.140511-.65120691.0707148-.11819408.3197845-.28280909.4314962-.30279961.2805348-.04961763.5886064-.0551978.8264635-.00901194.1077347.021202.3705429.22413969.4327499.32121002.1277282.20156171.2519621.8513817.3219188 1.49611734-.0110122.04228902-.0110122.04228902.1607163.28760404.5903408-.06730286.5903408-.06730286.5737568-.17389206.0155734-.03799147.0279666-.08191522.0455068-.15013809.0421947-.1597068.0701719-.25243998.1118273-.35635899.0288165-.07188915.0591935-.13335501.0903398-.18227881.120675-.18992919.4330876-.31896311.7070596-.2766556.2942545.0454396.4817569.26665023.4998934.72896761.0145423.38042999.0188438.52667972.0198445.67022961.0003693.0529684.0003531.09548963.0000723.21509672-.0001536.07391241-.0001536.07391241-.000205.16397385 0 .48892448-.010469.79353263-.0389535 1.17400348-.0506294.653266-.1361064 1.34281542-.228649 1.66708482-.094456.330596-.3764591.9508823-.5997469 1.2734975-.0158389.0153017-.0838055.0964468-.1706932.2036597-.1445918.1784155-.2892331.364998-.4248114.5512865-.0725632.099704-.140705.1968792-.2036767.2908847-.2436695.3637558-.4000227.6607868-.4506249.9042828-.0664376.3164194-.0901813.4842425-.0973169.666189-.0017426.0515155-.0017426.0515155-.0028439.1014735-.0025547.1180556-.0040857.165727-.0090621.2520573-.0052398.0906702-.0037444.1871795.0035093.2891187.0103883.145992.0000001.3454812.0000001.3454812s-.1266332-.0118299-.2678551-.0085813c-.1725177.0039685-.3159859-.0019087-.4151297-.0177442-.143046-.0230487-.5293508-.5064503-.7271506-.8830611-.3022704-.5764228-1.03604858-.5484427-1.33684295-.0394061-.27130191.4618137-.65965243.9172085-.77493336.9317029-.37460536.047106-.95471158.0524702-2.07175566.0332544-.10679478-.0018572-.10679478-.0018572-.21348729-.0037567-.42889761-.0076439-.41241496.0647655-.40363307-.0124079.02506967-.2203068.02222332-.1790312.00000011-.3992999-.03726222-.36933-.15125405-.6704984-.38877094-.8705429-.12286946-.1043424-.26983033-.2407345-.56500741-.5211097-.33722428-.3203411-.44283686-.4193233-.57299128-.5337266l-.80130455-.8907189c-.08795856-.1124788-.86002339-1.4339349-1.21248613-1.9454077-.13710846-.19857111-.18839645-.26302343-.71461353-.9114734zm9.50873056.0037599v3.459c0 .5.75.5.75 0v-3.459c0-.5-.75-.5-.75 0zm-2.03159602-.00057241.016 3.47300001c.00230346.4999947.7522955.4965395.74999204-.0034552l-.016-3.47299999c-.00230346-.4999947-.7522955-.49653951-.74999204.00345518zm-1.20911102 3.45357381-.021-3.42599996c-.00306475-.4999906-.75305066-.49539349-.74998592.00459712l.021 3.42600004c.00306475.4999906.75305066.4953935.74998592-.0045972z"
            fill="#fff"
          />
        </g>
      </svg>
    `;
  }

  private getCustomCursorSVG(fill: string, pointer: string): string {
    return `
      <svg
        height="32"
        viewBox="0 0 32 32"
        width="32"
        xmlns="http://www.w3.org/2000/svg"
        style="filter: drop-shadow(0 0 0.25rem ${fill}); pointer-events: none;"
      >
        <g fill="none" fillRule="evenodd" transform="translate(9 8)">
          <image href="${pointer}" width="32" height="32"></image>
        </g>
      </svg>
    `;
  }

  private removeCursor(clientId: string): void {
    const element = this.cursors.get(clientId);
    if (element) {
      element.classList.remove("playhtml-cursor-fade-in");
      element.classList.add("playhtml-cursor-fade-out");

      setTimeout(() => {
        element.remove();
        this.cursors.delete(clientId);
      }, 300);
    }
  }

  private savePlayerIdentityToStorage(): void {
    try {
      localStorage.setItem(
        PLAYER_IDENTITY_STORAGE_KEY,
        JSON.stringify(this.playerIdentity)
      );
    } catch (e) {
      console.warn("Failed to save player identity to localStorage:", e);
    }
  }

  private setupGlobalAPI(): void {
    // Capture 'this' context for use in getters/setters
    const self = this;

    // Set the global API with direct getter/setter syntax
    window.cursors = {
      get allColors() {
        return Array.from(self.allPlayerColors);
      },
      set allColors(newColors: string[]) {
        self.allPlayerColors = new Set(newColors);
        self.emitGlobalEvent("allColors", newColors);
      },
      get color() {
        return self.playerIdentity.playerStyle.colorPalette[0] || "#3b82f6";
      },
      set color(newColor: string) {
        const oldColor = self.playerIdentity.playerStyle.colorPalette[0];
        self.playerIdentity.playerStyle.colorPalette[0] = newColor;
        self.savePlayerIdentityToStorage();
        document.documentElement.style.cursor = getCursorStyleForUser(newColor);
        if (oldColor !== newColor) {
          self.emitGlobalEvent("color", newColor);
        }
      },
      get name() {
        return self.playerIdentity.name;
      },
      set name(newName: string | undefined) {
        const oldName = self.playerIdentity.name;
        self.playerIdentity.name = newName;
        self.savePlayerIdentityToStorage();
        if (oldName !== newName) {
          self.emitGlobalEvent("name", newName);
        }
      },
      on: (event: keyof CursorEvents, callback: Function) => {
        if (!self.globalApiListeners.has(event)) {
          self.globalApiListeners.set(event, new Set());
        }
        self.globalApiListeners.get(event)!.add(callback);
      },
      off: (event: keyof CursorEvents, callback: Function) => {
        const listeners = self.globalApiListeners.get(event);
        if (listeners) {
          listeners.delete(callback);
        }
      },
    };
  }

  private emitGlobalEvent<K extends keyof CursorEvents>(
    event: K,
    value: CursorEvents[K]
  ): void {
    const listeners = this.globalApiListeners.get(event);
    if (listeners) {
      listeners.forEach((callback) => callback(value));
    }
  }

  private updateGlobalColors(): void {
    if (window.cursors) {
      const colors = Array.from(this.allPlayerColors);
      window.cursors.allColors = colors;
    }
  }

  private updateChatCTA(): void {
    if (!this.chat) return;

    if (this.otherUsersWithMessages.size > 0) {
      this.chat.showCTA();
    } else {
      this.chat.hideCTA();
    }
  }

  private updateCursorMessage(
    element: HTMLElement,
    playerIdentity?: PlayerIdentity,
    message?: string | null
  ): void {
    // Remove existing message element
    const existingMessage = element.querySelector(".playhtml-cursor-message");
    if (existingMessage) {
      existingMessage.remove();
    }

    // Add new message if present
    if (message) {
      const messageElement = document.createElement("div");
      messageElement.className = "playhtml-cursor-message";
      messageElement.style.cssText = `
        position: absolute;
        font-size: 16px;
        font-style: normal;
        font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
        color: white;
        padding: 4px 9px 4px 9px;
        border-radius: 16px 16px 16px 16px;
        white-space: nowrap;
        background-color: rgba(52,199,89,1);
        top: 17px;
        left: 22px;
      `;
      messageElement.textContent = message;
      element.appendChild(messageElement);
    }
  }

  private updateCursorName(
    element: HTMLElement,
    playerIdentity?: PlayerIdentity
  ): void {
    // Remove existing name element
    const existingName = element.querySelector(".playhtml-cursor-name");
    if (existingName) {
      existingName.remove();
    }

    // Add name if present
    const name = playerIdentity?.name;
    if (name) {
      const color = playerIdentity?.playerStyle?.colorPalette?.[0] || "#3b82f6";
      const truncatedName = name.length > 10 ? name.slice(0, 10) + ".." : name;

      const borderColor = this.opacifyColor(color, 0.6);
      const boxShadowColor = this.opacifyColor(color, 0.3);
      const contrastColor = this.getContrastColor(color);

      const nameElement = document.createElement("div");
      nameElement.className = "playhtml-cursor-name";
      nameElement.style.cssText = `
        position: absolute;
        white-space: nowrap;
        padding: 4px 6px;
        font-size: 12px;
        background: ${color};
        border-radius: 14px;
        top: 14px;
        left: 18px;
        opacity: 0.75;
        border: 1px solid ${borderColor};
        box-shadow: 1px 1px 4px 2px ${boxShadowColor};
        color: ${contrastColor};
      `;
      nameElement.textContent = truncatedName;
      element.appendChild(nameElement);
    }
  }

  private opacifyColor(color: string, opacity: number): string {
    if (color.startsWith("#")) {
      const hex = color.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    } else if (color.startsWith("rgba")) {
      return color.replace(/[\d\.]+\)$/, `${opacity})`);
    } else if (color.startsWith("rgb")) {
      return color.replace("rgb", "rgba").replace(")", `, ${opacity})`);
    } else if (color.startsWith("hsl")) {
      const matches = color.match(
        /hsl\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%\)/
      );
      if (matches) {
        const [, h, s, l] = matches.map(Number);
        const [r, g, b] = this.hslToRgb(h, s, l);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
    }
    return color;
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    h /= 360;
    s /= 100;
    l /= 100;

    let r: number, g: number, b: number;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  private getLuminance(color: string): number {
    let r: number, g: number, b: number;

    if (color.startsWith("#")) {
      const hex = color.replace("#", "");
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else if (color.startsWith("rgb")) {
      const matches = color.match(/\d+/g);
      if (!matches || matches.length < 3) return 0;
      [r, g, b] = matches.map(Number);
    } else if (color.startsWith("hsl")) {
      const matches = color.match(/\d+(\.\d+)?/g);
      if (!matches || matches.length < 3) return 0;
      const [h, s, l] = matches.map(Number);
      [r, g, b] = this.hslToRgb(h, s, l);
    } else {
      return 0;
    }

    const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((val) =>
      val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  private getContrastColor(backgroundColor: string): string {
    const luminance = this.getLuminance(backgroundColor);
    return luminance > 0.5 ? "#000000" : "#ffffff";
  }

  private updateAllCursorVisibility(): void {
    if (!this.currentCursor || !this.visibilityThreshold) return;

    this.cursors.forEach((cursorElement, clientId) => {
      // Get cursor data from spatial grid
      const gridItems = this.spatialGrid.getAll();
      const cursorData = gridItems.find((item) => item.id === clientId)?.data;

      if (cursorData && cursorData.cursor) {
        const distance = calculateDistance(
          this.currentCursor!,
          cursorData.cursor
        );
        const isVisible = distance < this.visibilityThreshold!;

        cursorElement.style.display = isVisible ? "block" : "none";
        cursorElement.style.opacity = isVisible ? "1" : "0";
        cursorElement.style.transform = isVisible ? "scale(1)" : "scale(0.8)";
      }
    });
  }

  private showAllCursors(): void {
    this.cursors.forEach((cursorElement) => {
      cursorElement.style.display = "block";
      cursorElement.style.opacity = "1";
      cursorElement.style.transform = "scale(1)";
    });
  }

  configure(options: Partial<CursorOptions>): void {
    // Update options object
    Object.assign(this.options, options);

    // Update visibility threshold if changed
    if (options.visibilityThreshold !== undefined) {
      this.visibilityThreshold = options.visibilityThreshold;
      // Immediately update cursor visibility with new threshold
      this.updateAllCursorVisibility();
    }

    // Update player identity if provided
    if (options.playerIdentity !== undefined) {
      this.playerIdentity = options.playerIdentity;
    }
  }

  hideCursor(connectionId: string): void {
    const cursorElement = this.cursors.get(connectionId);
    if (cursorElement) {
      cursorElement.style.display = "none";
    }
  }

  showCursor(connectionId: string): void {
    const cursorElement = this.cursors.get(connectionId);
    if (cursorElement) {
      cursorElement.style.display = "block";
    }
  }

  destroy(): void {
    // Clean up cursors
    this.cursors.forEach((element) => element.remove());
    this.cursors.clear();

    // Clean up spatial grid
    this.spatialGrid.clear();

    // Clean up chat
    if (this.chat) {
      this.chat.destroy();
    }

    // Remove awareness data
    this.provider.awareness.setLocalStateField(CURSOR_AWARENESS_FIELD, null);
  }

  // Debug method to inspect spatial partitioning efficiency
  getDebugInfo(): {
    totalCursors: number;
    gridCells: number;
    avgCursorsPerCell: number;
  } {
    const totalCursors = this.spatialGrid.getItemCount();
    const gridCells = this.spatialGrid.getCellCount();
    return {
      totalCursors,
      gridCells,
      avgCursorsPerCell: gridCells > 0 ? totalCursors / gridCells : 0,
    };
  }

  // Instance-level subscription API (mirrors window.cursors.on/off)
  on<K extends keyof CursorEvents>(
    event: K,
    callback: (value: CursorEvents[K]) => void
  ): void {
    if (!this.globalApiListeners.has(event)) {
      this.globalApiListeners.set(event, new Set());
    }
    this.globalApiListeners.get(event)!.add(callback as any);
  }

  off<K extends keyof CursorEvents>(
    event: K,
    callback: (value: CursorEvents[K]) => void
  ): void {
    const listeners = this.globalApiListeners.get(event);
    if (listeners) {
      listeners.delete(callback as any);
    }
  }

  // Snapshot of current cursor-related values for consumers
  getSnapshot(): CursorEvents {
    return {
      allColors: Array.from(this.allPlayerColors),
      color: this.playerIdentity.playerStyle.colorPalette[0] || "#3b82f6",
      name: this.playerIdentity.name || "",
    };
  }

  // Get my player identity (including stable publicKey)
  getMyPlayerIdentity(): PlayerIdentity {
    return this.playerIdentity;
  }

  // Get the provider (needed for awareness access)
  getProvider(): YPartyKitProvider {
    return this.provider;
  }

  // Get all cursor presences keyed by stable ID (slim shape for rendering)
  getCursorPresences(): Map<string, CursorPresenceView> {
    const presences = new Map<string, CursorPresenceView>();
    const states = this.provider.awareness.getStates();

    states.forEach((state, clientId) => {
      const cursorData = state[CURSOR_AWARENESS_FIELD] as
        | CursorPresence
        | undefined;
      if (!cursorData?.cursor) return;

      // Stable ID from playerIdentity - skip if missing (matches onChangeAwareness behavior)
      const stableId = cursorData.playerIdentity?.publicKey;
      if (!stableId) {
        console.warn(
          `[playhtml] Client ${clientId} has no playerIdentity.publicKey - skipping cursor presence`
        );
        return;
      }

      // Slim shape: only cursor + playerIdentity
      presences.set(stableId, {
        cursor: cursorData.cursor,
        playerIdentity: cursorData.playerIdentity,
      });
    });

    return presences;
  }

  // Subscribe to cursor presence changes
  onCursorPresencesChange(
    callback: (presences: Map<string, CursorPresenceView>) => void
  ): () => void {
    const id = Math.random().toString(36);
    this.cursorPresenceChangeCallbacks.set(id, callback);

    // Return unsubscribe function
    return () => {
      this.cursorPresenceChangeCallbacks.delete(id);
    };
  }

  // Notify listeners of cursor presence changes
  private notifyCursorPresenceListeners(): void {
    const presences = this.getCursorPresences();
    this.cursorPresenceChangeCallbacks.forEach((cb) => cb(presences));
  }
}
