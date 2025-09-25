interface RoomData {
  subscribers?: Array<{
    consumerRoomId: string;
    elementIds?: string[];
  }>;
  sharedReferences?: Array<{
    sourceRoomId: string;
    elementIds: string[];
  }>;
  sharedPermissions?: Record<string, "read-only" | "read-write">;
  ydoc?: any;
  connections?: number;
  timestamp?: string;
  roomId?: string;
}

interface DebugLog {
  timestamp: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
}

type EnvName = "production" | "staging" | "development";
const HOSTS: Record<EnvName, string> = {
  production: "https://playhtml.spencerc99.partykit.dev",
  staging: "https://staging.playhtml.spencerc99.partykit.dev",
  development: "http://localhost:1999",
};

// TODO: convert to react
// TODO: back / forward not working for reloading data.
class AdminConsole {
  private logs: DebugLog[] = [];
  private currentRoomId: string | null = null;
  private currentRoomData: RoomData | null = null;
  private adminToken: string | null = null;
  private hostEnv: EnvName =
    (localStorage.getItem("playhtml-admin-host-env") as EnvName) ||
    "production";
  private envIndicatorBtn: HTMLButtonElement | null = null;
  private envDropdown: HTMLDivElement | null = null;

  constructor() {
    this.initializeUI();
    this.setupLogging();
    this.loadStoredAuth();
    this.loadRoomFromURL();
    this.log("info", "Admin console initialized");
  }

  private initializeUI(): void {
    const loadRoomBtn = document.getElementById(
      "loadRoom"
    ) as HTMLButtonElement;
    const roomIdInput = document.getElementById("roomId") as HTMLInputElement;
    const exportBtn = document.getElementById(
      "exportData"
    ) as HTMLButtonElement;
    const clearLogsBtn = document.getElementById(
      "clearLogs"
    ) as HTMLButtonElement;
    const authBtn = document.getElementById("authBtn") as HTMLButtonElement;
    const loadRawBtn = document.getElementById(
      "loadRawData"
    ) as HTMLButtonElement;
    const debugYDocBtn = document.getElementById(
      "debugYDoc"
    ) as HTMLButtonElement;
    const compareDataBtn = document.getElementById(
      "compareDataMethods"
    ) as HTMLButtonElement;
    // Environment selector UI
    const header = document.querySelector(".admin-header");
    if (header) {
      const envControls = document.createElement("div");
      envControls.style.display = "flex";
      envControls.style.alignItems = "center";
      envControls.style.gap = "8px";

      const indicator = document.createElement("button");
      indicator.id = "envIndicator";
      indicator.style.padding = "6px 12px";
      indicator.style.borderRadius = "16px";
      indicator.style.fontWeight = "700";
      indicator.style.border = "1px solid #e2e8f0";
      indicator.style.cursor = "pointer";
      indicator.style.fontSize = "0.9rem";
      this.envIndicatorBtn = indicator;
      this.updateEnvIndicator();

      const dropdown = document.createElement("div");
      dropdown.id = "envDropdown";
      dropdown.style.position = "absolute";
      dropdown.style.marginTop = "36px";
      dropdown.style.background = "white";
      dropdown.style.border = "1px solid #e2e8f0";
      dropdown.style.borderRadius = "8px";
      dropdown.style.boxShadow = "0 4px 10px rgba(0,0,0,0.08)";
      dropdown.style.display = "none";
      dropdown.style.zIndex = "1000";
      dropdown.style.minWidth = "240px";
      this.envDropdown = dropdown;

      const mkItem = (name: EnvName, label: string, color: string) => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.gap = "8px";
        item.style.padding = "10px 12px";
        item.style.cursor = "pointer";
        item.addEventListener("click", () => {
          this.setHostEnv(name);
          this.hideEnvDropdown();
          if (this.currentRoomId && this.adminToken) {
            this.loadRoom();
          }
        });
        const dot = document.createElement("span");
        dot.style.display = "inline-block";
        dot.style.width = "10px";
        dot.style.height = "10px";
        dot.style.borderRadius = "50%";
        dot.style.background = color;
        const text = document.createElement("span");
        text.textContent = label + " (" + HOSTS[name] + ")";
        text.style.fontFamily = '"Monaco", "Menlo", monospace';
        text.style.fontSize = "12px";
        item.appendChild(dot);
        item.appendChild(text);
        item.addEventListener(
          "mouseover",
          () => (item.style.background = "#f7fafc")
        );
        item.addEventListener(
          "mouseout",
          () => (item.style.background = "white")
        );
        return item;
      };

      dropdown.appendChild(mkItem("production", "Production", "#e53e3e"));
      dropdown.appendChild(mkItem("staging", "Staging", "#d69e2e"));
      dropdown.appendChild(mkItem("development", "Development", "#3182ce"));

      indicator.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.envDropdown) return;
        const isOpen = this.envDropdown.style.display === "block";
        if (isOpen) this.hideEnvDropdown();
        else this.showEnvDropdown(indicator);
      });
      document.addEventListener("click", () => this.hideEnvDropdown());

      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";
      wrapper.appendChild(indicator);
      wrapper.appendChild(dropdown);
      envControls.appendChild(wrapper);
      header.appendChild(envControls);
    }

    // Room loading
    loadRoomBtn.addEventListener("click", () => this.loadRoom());
    roomIdInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.loadRoom();
    });

    // Debug tools
    exportBtn.addEventListener("click", () => this.exportRoomData());
    loadRawBtn.addEventListener("click", () => this.loadRawDatabaseData());
    debugYDocBtn.addEventListener("click", () => this.debugYDocLoading());
    compareDataBtn.addEventListener("click", () => this.compareDataMethods());

    // Authentication
    authBtn.addEventListener("click", () => this.handleAuth());

    // Log controls
    clearLogsBtn.addEventListener("click", () => this.clearLogs());
  }
  private getPartykitHost(): string {
    return HOSTS[this.hostEnv];
  }

  private setHostEnv(env: EnvName): void {
    this.hostEnv = env;
    localStorage.setItem("playhtml-admin-host-env", env);
    this.updateEnvIndicator();
  }

  private showEnvDropdown(anchor: HTMLElement): void {
    if (!this.envDropdown) return;
    this.envDropdown.style.display = "block";
    // positioning can be enhanced later; keep left aligned for now
    this.envDropdown.style.left = "0px";
  }

  private hideEnvDropdown(): void {
    if (!this.envDropdown) return;
    this.envDropdown.style.display = "none";
  }

  private updateEnvIndicator(): void {
    if (!this.envIndicatorBtn) return;
    const label = this.hostEnv.toUpperCase();
    this.envIndicatorBtn.textContent = `ENV: ${label}`;
    const colors: Record<
      EnvName,
      { bg: string; color: string; border: string }
    > = {
      production: { bg: "#FED7D7", color: "#9B2C2C", border: "#FEB2B2" },
      staging: { bg: "#FEFCBF", color: "#744210", border: "#F6E05E" },
      development: { bg: "#BEE3F8", color: "#2C5282", border: "#90CDF4" },
    };
    const c = colors[this.hostEnv];
    this.envIndicatorBtn.style.background = c.bg;
    this.envIndicatorBtn.style.color = c.color;
    this.envIndicatorBtn.style.borderColor = c.border;
  }

  private setupLogging(): void {
    // Override console methods to capture logs
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      this.log("info", args.join(" "));
      originalLog.apply(console, args);
    };

    console.warn = (...args) => {
      this.log("warn", args.join(" "));
      originalWarn.apply(console, args);
    };

    console.error = (...args) => {
      this.log("error", args.join(" "));
      originalError.apply(console, args);
    };
  }

  private async loadRoom(): Promise<void> {
    const roomIdInput = document.getElementById("roomId") as HTMLInputElement;
    const roomId = roomIdInput.value.trim();

    if (!roomId) {
      this.showStatus("Please enter a room ID", "error");
      return;
    }

    this.showStatus("Loading room data...", "loading");
    this.currentRoomId = roomId;
    this.updateURLWithRoom(roomId);

    try {
      const roomData = await this.fetchRoomData(roomId);
      this.currentRoomData = roomData;

      const createdDate = roomData.timestamp
        ? new Date(roomData.timestamp).toLocaleDateString()
        : "unknown";
      this.showStatus(
        `✅ Successfully loaded room: ${roomId} (created ${createdDate})`,
        "success"
      );
      this.log("info", `Loaded room data for ${roomId}`, roomData);

      this.displayRoomData(roomData);
      this.enableDebugTools();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.showStatus(`Failed to load room: ${msg}`, "error");
      this.log("error", `Failed to load room ${roomId}`, error);
    }
  }

  private async fetchRoomData(roomId: string): Promise<RoomData> {
    if (!this.adminToken) {
      throw new Error(
        'Not authenticated. Please click "Authenticate" and enter your admin token.'
      );
    }

    const baseUrl = `${this.getPartykitHost()}/parties/main/${roomId}`;

    // Use the admin inspect endpoint with token
    const url = `${baseUrl}/admin/inspect?token=${encodeURIComponent(
      this.adminToken
    )}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.adminToken = null;
        localStorage.removeItem("playhtml-admin-token");
        this.updateAuthUI(false);
        throw new Error(
          "Authentication failed. Please re-authenticate with a valid token."
        );
      }
      if (response.status === 404) {
        // Handle room with no PlayHTML data
        const errorData = await response.json();
        throw new Error(errorData.message || "Room has no PlayHTML data");
      }
      throw new Error(
        `Failed to fetch room data: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    return data;
  }

  private displayRoomData(data: RoomData): void {
    this.displaySharedData(data);
    this.displayYDocData(data.ydoc);
    this.displayMetadata(data);
  }

  private displaySharedData(data: RoomData): void {
    // Display subscribers
    const subscribersViewer = document.getElementById("subscribersViewer");
    if (subscribersViewer) {
      if (!data.subscribers || data.subscribers.length === 0) {
        subscribersViewer.innerHTML = '<div class="empty">No subscribers</div>';
      } else {
        subscribersViewer.innerHTML = this.formatSharedDataList(
          data.subscribers,
          "subscriber"
        );
        this.attachSubscriberListListeners(subscribersViewer);
      }
    }

    // Display shared references
    const referencesViewer = document.getElementById("referencesViewer");
    if (referencesViewer) {
      if (!data.sharedReferences || data.sharedReferences.length === 0) {
        referencesViewer.innerHTML =
          '<div class="empty">No shared references</div>';
      } else {
        referencesViewer.innerHTML = this.formatSharedDataList(
          data.sharedReferences,
          "reference"
        );
      }
    }

    // Display permissions
    const permissionsViewer = document.getElementById("permissionsViewer");
    if (permissionsViewer) {
      if (
        !data.sharedPermissions ||
        Object.keys(data.sharedPermissions).length === 0
      ) {
        permissionsViewer.innerHTML =
          '<div class="empty">No permissions set</div>';
      } else {
        permissionsViewer.innerHTML = this.formatPermissionsList(
          data.sharedPermissions
        );
      }
    }
  }

  private displayYDocData(ydoc: any): void {
    const ydocViewer = document.getElementById("ydocViewer");
    if (!ydocViewer) return;

    if (!ydoc || !ydoc.play) {
      ydocViewer.innerHTML =
        '<div class="empty">No Y.Doc play data available</div>';
      return;
    }

    // Show basic stats
    const capabilityCount = Object.keys(ydoc.play).length;
    const totalElements = Object.values(ydoc.play).reduce(
      (sum: number, tagData: any) => sum + Object.keys(tagData).length,
      0
    );

    const debugInfoHtml = `
      <div class="ydoc-debug-info">
        <div class="debug-stats">
          <span class="stat-item">📊 ${capabilityCount} capability types</span>
          <span class="stat-item">🎯 ${totalElements} total elements</span>
        </div>
      </div>
    `;

    // Show the play data with clean stats
    ydocViewer.innerHTML =
      debugInfoHtml + this.createInteractiveJSONViewer(ydoc.play);
    this.attachJSONViewerListeners(ydocViewer);
  }

  private displayMetadata(data: RoomData): void {
    const metaViewer = document.getElementById("metaViewer");
    if (!metaViewer) return;

    const roomId = data.roomId || this.currentRoomId;
    const connections = data.connections || 0;
    const timestamp = data.timestamp
      ? new Date(data.timestamp).toLocaleString()
      : "Unknown";

    metaViewer.innerHTML = `
      <div class="metadata-list">
        <div class="metadata-item">
          <strong>Room ID:</strong> 
          <code>${roomId}</code>
        </div>
        <div class="metadata-item">
          <strong>Active Connections:</strong> 
          <span class="connection-count">${connections}</span>
        </div>
        <div class="metadata-item">
          <strong>Created At:</strong> 
          <time>${timestamp}</time>
        </div>
      </div>
    `;
  }

  private formatSharedDataList(
    items: any[],
    type: "subscriber" | "reference"
  ): string {
    return items
      .map((item) => {
        if (type === "subscriber") {
          const encodedRoomId = item.consumerRoomId || "";
          const roomId = this.decodeRoomId(encodedRoomId);
          const elements = item.elementIds?.join(", ") || "none";
          return `
          <div class="shared-item">
            <div class="shared-item-header">
              <span class="badge subscriber-badge">CONSUMER</span>
              <a class="room-link" href="admin.html?room=${encodedRoomId}"><strong>${roomId}</strong></a>
              <button class="remove-subscriber-btn" title="Remove" data-consumer-id="${encodedRoomId}">×</button>
            </div>
            <div class="shared-item-detail">Elements: ${elements}</div>
          </div>
        `;
        } else {
          const encodedSourceId = item.sourceRoomId || "";
          const roomId = this.decodeRoomId(encodedSourceId);
          const elements = item.elementIds?.join(", ") || "none";
          return `
          <div class="shared-item">
            <div class="shared-item-header">
              <span class="badge reference-badge">SOURCE</span>
              <a class="room-link" href="admin.html?room=${encodedSourceId}"><strong>${roomId}</strong></a>
            </div>
            <div class="shared-item-detail">Elements: ${elements}</div>
          </div>
        `;
        }
      })
      .join("");
  }

  private attachSubscriberListListeners(container: HTMLElement): void {
    // Use event delegation so re-renders keep working
    container.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      const removeBtn = target.closest(
        ".remove-subscriber-btn"
      ) as HTMLElement | null;
      if (removeBtn) {
        e.preventDefault();
        e.stopPropagation();
        const consumerRoomId = removeBtn.getAttribute("data-consumer-id") || "";
        const decoded = this.decodeRoomId(consumerRoomId);
        const ok = confirm(`Remove subscriber for room: ${decoded}?`);
        if (!ok) return;
        await this.removeSubscriberById(consumerRoomId);
      }
    });
  }

  private async removeSubscriberById(consumerRoomId: string): Promise<void> {
    if (!this.currentRoomId) {
      this.showStatus("Load a room first", "error");
      return;
    }
    if (!this.adminToken) {
      this.showStatus("Authenticate first", "error");
      return;
    }

    try {
      const baseUrl = `${this.getPartykitHost()}/parties/main/${
        this.currentRoomId
      }`;
      const url = `${baseUrl}/admin/remove-subscriber?token=${encodeURIComponent(
        this.adminToken
      )}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consumerRoomId }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const out = await res.json();
      this.log("info", `Removed subscriber: ${consumerRoomId}`, out);
      this.showStatus(
        `Removed subscriber: ${this.decodeRoomId(consumerRoomId)}`,
        "success"
      );
      await this.loadRoom();
    } catch (error: any) {
      this.showStatus(`Failed removing subscriber: ${error.message}`, "error");
      this.log("error", "Failed removing subscriber", error);
    }
  }

  private formatPermissionsList(permissions: Record<string, string>): string {
    return Object.entries(permissions)
      .map(
        ([elementId, permission]) => `
      <div class="shared-item">
        <div class="shared-item-header">
          <span class="badge ${
            permission === "read-only" ? "readonly-badge" : "readwrite-badge"
          }">${permission.toUpperCase()}</span>
          <strong>${elementId}</strong>
        </div>
      </div>
    `
      )
      .join("");
  }

  private decodeRoomId(encodedId: string): string {
    try {
      return decodeURIComponent(encodedId);
    } catch {
      return encodedId;
    }
  }

  private createInteractiveJSONViewer(obj: any, depth: number = 0): string {
    if (obj === null) {
      return '<span class="json-null">null</span>';
    }

    if (typeof obj === "string") {
      // Check if this looks like base64 document data (long base64 string)
      const isBase64Document =
        obj.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(obj);
      const className = isBase64Document
        ? "json-string base64-data"
        : "json-string";
      const displayText = isBase64Document ? obj.substring(0, 50) + "..." : obj;
      return `<span class="${className}" title="${
        isBase64Document
          ? `Base64 document (${obj.length} chars) - hover to expand`
          : obj
      }">"${displayText}"</span>`;
    }

    if (typeof obj === "number") {
      return `<span class="json-number">${obj}</span>`;
    }

    if (typeof obj === "boolean") {
      return `<span class="json-boolean">${obj}</span>`;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return '<span class="json-bracket">[]</span>';
      }

      const id = `array-${Math.random().toString(36).substr(2, 9)}`;
      const shouldAutoExpand = obj.length <= 7 && depth <= 4;
      const collapsedClass = shouldAutoExpand ? "" : "collapsed";

      const items = obj
        .map(
          (item, index) =>
            `<div style="margin-left: 20px;"><span class="json-index">${index}:</span> ${this.createInteractiveJSONViewer(
              item,
              depth + 1
            )}</div>`
        )
        .join("");

      return `<span class="json-expandable ${collapsedClass}" data-target="${id}"><span class="json-bracket">[</span><span class="json-count">${obj.length}</span><span class="json-bracket">]</span></span><div class="json-content ${collapsedClass}" id="${id}" style="margin-left: 12px;">${items}</div>`;
    }

    if (typeof obj === "object") {
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return '<span class="json-bracket">{}</span>';
      }

      const id = `object-${Math.random().toString(36).substr(2, 9)}`;
      const shouldAutoExpand = keys.length <= 7 && depth <= 4;
      const collapsedClass = shouldAutoExpand ? "" : "collapsed";

      const entries = keys
        .map((key) => {
          const value = this.createInteractiveJSONViewer(obj[key], depth + 1);
          return `<div style="margin-left: 20px;"><span class="json-key">"${key}"</span><span class="json-colon">:</span> ${value}</div>`;
        })
        .join("");

      return `<span class="json-expandable ${collapsedClass}" data-target="${id}"><span class="json-bracket">{</span><span class="json-count">${keys.length}</span><span class="json-bracket">}</span></span><div class="json-content ${collapsedClass}" id="${id}" style="margin-left: 12px;">${entries}</div>`;
    }

    return String(obj);
  }

  private attachJSONViewerListeners(container: HTMLElement): void {
    // Remove any existing listeners to prevent duplicates
    const newContainer = container.cloneNode(true) as HTMLElement;
    container.parentNode?.replaceChild(newContainer, container);

    newContainer.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const expandable = target.closest(".json-expandable") as HTMLElement;

      if (expandable) {
        e.preventDefault();
        e.stopPropagation();

        const targetId = expandable.dataset.target;
        const content = document.getElementById(targetId!);

        if (content) {
          const isCollapsed = expandable.classList.contains("collapsed");

          if (isCollapsed) {
            expandable.classList.remove("collapsed");
            content.classList.remove("collapsed");
          } else {
            expandable.classList.add("collapsed");
            content.classList.add("collapsed");
          }
        }
      }
    });
  }

  private enableDebugTools(): void {
    const tools = [
      "exportData",
      "loadRawData",
      "debugYDoc",
      "compareDataMethods",
      "removeSubscriber",
    ];
    tools.forEach((id) => {
      const btn = document.getElementById(id) as HTMLButtonElement;
      if (btn) btn.disabled = false;
    });
  }

  private async exportRoomData(): Promise<void> {
    if (!this.currentRoomData || !this.currentRoomId) return;

    const dataStr = JSON.stringify(this.currentRoomData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `room-${this.currentRoomId}-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();

    URL.revokeObjectURL(url);
    this.log("info", `Exported data for room ${this.currentRoomId}`);
  }

  private async loadRawDatabaseData(): Promise<void> {
    if (!this.currentRoomId || !this.adminToken) return;

    try {
      const baseUrl = `${this.getPartykitHost()}/parties/main/${
        this.currentRoomId
      }`;
      const url = `${baseUrl}/admin/raw-data?token=${encodeURIComponent(
        this.adminToken
      )}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch raw data: ${response.status} ${response.statusText}`
        );
      }

      const rawData = await response.json();
      this.displayRawData(rawData);
      this.log("info", "Loaded raw database data", rawData);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log("error", `Failed to load raw data: ${msg}`, error);
    }
  }

  private displayRawData(rawData: any): void {
    const rawDbSection = document.getElementById("rawDbData");
    if (!rawDbSection) return;

    rawDbSection.style.display = "block";

    // Update metadata
    const docSize = document.getElementById("docSize");
    const base64Length = document.getElementById("base64Length");
    const dbTimestamp = document.getElementById("dbTimestamp");

    if (rawData.document) {
      const sizeKB =
        Math.round((rawData.document.base64Length / 1024) * 100) / 100;
      docSize!.textContent = `${sizeKB} KB`;
      base64Length!.textContent =
        rawData.document.base64Length.toLocaleString();
      dbTimestamp!.textContent = new Date(
        rawData.document.created_at
      ).toLocaleString();
    } else {
      docSize!.textContent = "No data";
      base64Length!.textContent = "0";
      dbTimestamp!.textContent = "Never";
    }

    // Display raw data structure
    const rawDataViewer = document.getElementById("rawDataViewer");
    if (rawDataViewer) {
      rawDataViewer.innerHTML = this.createInteractiveJSONViewer(rawData);
      this.attachJSONViewerListeners(rawDataViewer);
    }
  }

  private async debugYDocLoading(): Promise<void> {
    if (!this.currentRoomId || !this.adminToken) return;

    const debugSection = document.getElementById("ydocDebug");
    const debugSteps = document.getElementById("debugSteps");
    const reconstructedDoc = document.getElementById("reconstructedDoc");

    if (!debugSection || !debugSteps || !reconstructedDoc) return;

    debugSection.style.display = "block";
    debugSteps.innerHTML = "";

    const addStep = (
      message: string,
      type: "info" | "success" | "warning" | "error" = "info"
    ) => {
      const step = document.createElement("div");
      step.className = `debug-step ${type}`;
      step.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      debugSteps.appendChild(step);
      // Map success->info, warning->warn for log levels
      const level: DebugLog["level"] =
        type === "success" ? "info" : type === "warning" ? "warn" : type;
      this.log(level, message);
    };

    try {
      addStep("🔍 Starting Y.Doc reconstruction debug...", "info");

      // Step 1: Get raw database data
      addStep("📁 Fetching raw database document...", "info");
      const baseUrl = `${this.getPartykitHost()}/parties/main/${
        this.currentRoomId
      }`;
      const rawUrl = `${baseUrl}/admin/raw-data?token=${encodeURIComponent(
        this.adminToken
      )}`;

      const rawResponse = await fetch(rawUrl);
      const rawData = await rawResponse.json();

      if (!rawData.document) {
        addStep("❌ No document found in database", "error");
        return;
      }

      addStep(
        `✅ Found document: ${rawData.document.base64Length} bytes`,
        "success"
      );

      // Step 2: Try to reconstruct Y.Doc manually
      addStep("🔧 Attempting to reconstruct Y.Doc from base64...", "info");

      try {
        // Import Y.js to reconstruct the document
        const Y = await import("yjs");
        const doc = new Y.Doc();

        // Decode and apply the update
        const base64 = rawData.document.document;
        const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

        addStep(`📦 Decoded ${buffer.length} bytes from base64`, "success");

        Y.applyUpdate(doc, buffer);
        addStep("✅ Successfully applied update to new Y.Doc", "success");

        // Extract data using SyncedStore like PlayHTML does
        addStep("🔧 Using SyncedStore to extract data...", "info");
        const { syncedStore } = await import("@syncedstore/core");
        const store = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          doc
        );

        // Clone the store.play data to get a plain object (same as PlayHTML clonePlain)
        const reconstructedData = this.clonePlain(store.play);
        const hasAnyData = Object.keys(reconstructedData).some(
          (tag) => Object.keys(reconstructedData[tag] || {}).length > 0
        );

        if (hasAnyData) {
          addStep(
            `🎯 Extracted ${
              Object.keys(reconstructedData).length
            } capability types`,
            "success"
          );

          // Count total elements
          const totalElements = Object.values(reconstructedData).reduce(
            (sum, tagData: any) => sum + Object.keys(tagData).length,
            0
          );
          addStep(`📊 Found ${totalElements} total elements`, "success");
        }

        if (!hasAnyData) {
          addStep("⚠️  Y.Doc loaded but contains no PlayHTML data", "warning");
        }

        // Display reconstructed data
        reconstructedDoc.innerHTML =
          this.createInteractiveJSONViewer(reconstructedData);
        this.attachJSONViewerListeners(reconstructedDoc);

        addStep("✅ Debug reconstruction complete!", "success");
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        addStep(`❌ Y.Doc reconstruction failed: ${msg}`, "error");
        this.log("error", "Y.Doc reconstruction error", error);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addStep(`❌ Debug process failed: ${msg}`, "error");
      this.log("error", "Debug Y.Doc loading error", error);
    }
  }

  private async compareDataMethods(): Promise<void> {
    if (!this.currentRoomId || !this.adminToken) return;

    try {
      this.log("info", "Comparing data extraction methods...");

      const baseUrl = `${this.getPartykitHost()}/parties/main/${
        this.currentRoomId
      }`;
      const url = `${baseUrl}/admin/live-compare?token=${encodeURIComponent(
        this.adminToken
      )}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch comparison: ${response.status} ${response.statusText}`
        );
      }

      const comparison = await response.json();
      this.log("info", "Data method comparison results:", comparison);

      // Display visual comparison
      this.displayDataComparison(comparison);

      // Show summary
      const directHasData = comparison.methods?.direct?.hasData;
      const liveHasData = comparison.methods?.live?.hasData;
      const dataMatch = comparison.differences?.dataMatch;

      const directData = comparison.methods?.direct?.data || {};
      const liveData = comparison.methods?.live?.data || {};
      const directKeyCount = Object.keys(directData).reduce(
        (sum, tag) => sum + Object.keys(directData[tag] || {}).length,
        0
      );
      const liveKeyCount = Object.keys(liveData).reduce(
        (sum, tag) => sum + Object.keys(liveData[tag] || {}).length,
        0
      );

      let summary = "🔍 Data Comparison Results:\n\n";
      summary += `Direct method: ${
        directHasData ? `✅ ${directKeyCount} elements` : "❌ No data"
      }\n`;
      summary += `Live method: ${
        liveHasData ? `✅ ${liveKeyCount} elements` : "❌ No data"
      }\n`;
      summary += `Data match: ${
        dataMatch ? "✅ Identical" : "❌ Different"
      }\n\n`;

      if (!dataMatch && directHasData && liveHasData) {
        const keyDiffs = comparison.differences?.sameKeys;
        if (keyDiffs) {
          summary += `Capability differences:\n`;
          summary += `- Direct only: ${
            keyDiffs.directOnly.join(", ") || "none"
          }\n`;
          summary += `- Live only: ${keyDiffs.liveOnly.join(", ") || "none"}\n`;
          summary += `- Common: ${keyDiffs.common.join(", ") || "none"}\n`;
        }
      }

      summary += "\nSee comparison section below for detailed view.";
      alert(summary);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log("error", `Failed to compare data methods: ${msg}`, error);
    }
  }

  private displayDataComparison(comparison: any): void {
    const comparisonSection = document.getElementById("dataComparison");
    if (!comparisonSection) return;

    comparisonSection.style.display = "block";

    // Update stats
    const directData = comparison.methods?.direct?.data || {};
    const liveData = comparison.methods?.live?.data || {};

    const directKeyCount = Object.keys(directData).reduce(
      (sum, tag) => sum + Object.keys(directData[tag] || {}).length,
      0
    );
    const liveKeyCount = Object.keys(liveData).reduce(
      (sum, tag) => sum + Object.keys(liveData[tag] || {}).length,
      0
    );

    const directCountEl = document.getElementById("directKeyCount");
    const liveCountEl = document.getElementById("liveKeyCount");
    const dataMatchEl = document.getElementById("dataMatch");

    if (directCountEl) directCountEl.textContent = directKeyCount.toString();
    if (liveCountEl) liveCountEl.textContent = liveKeyCount.toString();
    if (dataMatchEl) {
      const match = comparison.differences?.dataMatch;
      dataMatchEl.textContent = match ? "✅ Yes" : "❌ No";
      dataMatchEl.style.color = match ? "#38a169" : "#e53e3e";
    }

    // Display data viewers
    const directViewer = document.getElementById("directDataViewer");
    const liveViewer = document.getElementById("liveDataViewer");

    if (directViewer) {
      if (Object.keys(directData).length > 0) {
        directViewer.innerHTML = this.createInteractiveJSONViewer(directData);
        this.attachJSONViewerListeners(directViewer);
      } else {
        directViewer.innerHTML =
          '<div class="empty">No data from direct method</div>';
      }
    }

    if (liveViewer) {
      if (liveData.error) {
        liveViewer.innerHTML = `<div class="empty">Error: ${liveData.error}</div>`;
      } else if (Object.keys(liveData).length > 0) {
        liveViewer.innerHTML = this.createInteractiveJSONViewer(liveData);
        this.attachJSONViewerListeners(liveViewer);
      } else {
        liveViewer.innerHTML =
          '<div class="empty">No data from live method</div>';
      }
    }
  }

  private showStatus(
    message: string,
    type: "loading" | "success" | "error" | "empty"
  ): void {
    const statusEl = document.getElementById("roomStatus");
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = `status-display ${type}`;
  }

  private log(level: DebugLog["level"], message: string, data?: any): void {
    // Filter out large data objects to prevent log overflow
    let filteredData = data;
    if (data && typeof data === "object") {
      filteredData = this.filterLargeDataForLogging(data);
    }

    const logEntry: DebugLog = {
      timestamp: new Date(),
      level,
      message,
      data: filteredData,
    };

    this.logs.push(logEntry);
    this.displayLog(logEntry);
    this.scrollLogs();

    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  private clonePlain<T>(value: T): T {
    // Same cloning logic as PlayHTML
    try {
      // @ts-ignore
      if (typeof structuredClone === "function") {
        // @ts-ignore
        return structuredClone(value);
      }
    } catch {}
    if (value === null || value === undefined) return value;
    if (typeof value === "object") {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }

  private filterLargeDataForLogging(obj: any): any {
    if (!obj || typeof obj !== "object") return obj;

    const filtered: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      // Filter out base64 document data
      if (
        key === "document" &&
        typeof value === "string" &&
        value.length > 100
      ) {
        filtered[key] = `[Base64 data - ${value.length} chars]`;
      }
      // Filter out other large strings
      else if (typeof value === "string" && value.length > 500) {
        filtered[key] = `[Large string - ${
          value.length
        } chars]: ${value.substring(0, 100)}...`;
      }
      // Recursively filter nested objects
      else if (value && typeof value === "object") {
        filtered[key] = this.filterLargeDataForLogging(value);
      } else {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  private displayLog(log: DebugLog): void {
    const logOutput = document.getElementById("logOutput");
    if (!logOutput) return;

    const logEl = document.createElement("div");
    logEl.className = `log-entry ${log.level}`;

    const timestamp = log.timestamp.toLocaleTimeString();
    const dataStr = log.data ? ` ${JSON.stringify(log.data)}` : "";

    logEl.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${log.message}${dataStr}`;
    logOutput.appendChild(logEl);
  }

  private scrollLogs(): void {
    const autoScroll = document.getElementById(
      "autoScroll"
    ) as HTMLInputElement;
    if (autoScroll?.checked) {
      const logOutput = document.getElementById("logOutput");
      if (logOutput) {
        logOutput.scrollTop = logOutput.scrollHeight;
      }
    }
  }

  private clearLogs(): void {
    this.logs = [];
    const logOutput = document.getElementById("logOutput");
    if (logOutput) {
      logOutput.innerHTML = "";
    }
    this.log("info", "Logs cleared");
  }

  private loadStoredAuth(): void {
    const stored = localStorage.getItem("playhtml-admin-token");
    if (stored) {
      this.adminToken = stored;
      this.updateAuthUI(true);
    }
  }

  private handleAuth(): void {
    if (this.adminToken) {
      // Logout
      this.adminToken = null;
      localStorage.removeItem("playhtml-admin-token");
      this.updateAuthUI(false);
      this.log("info", "Logged out");
    } else {
      // Login - prompt for token
      const token = prompt("Enter admin token:");
      if (token) {
        this.adminToken = token.trim();
        localStorage.setItem("playhtml-admin-token", this.adminToken);
        this.updateAuthUI(true);
        this.log("info", "Admin token saved");
      }
    }
  }

  private updateAuthUI(authenticated: boolean): void {
    const authBtn = document.getElementById("authBtn") as HTMLButtonElement;
    const authStatus = document.getElementById("authStatus") as HTMLSpanElement;
    const adminContent = document.getElementById(
      "adminContent"
    ) as HTMLElement | null;

    if (authenticated) {
      authBtn.textContent = "🔓 Logout";
      authBtn.classList.add("authenticated");
      authStatus.textContent = "Authenticated";
      authStatus.classList.add("authenticated");
      if (adminContent) adminContent.style.display = "grid";
    } else {
      authBtn.textContent = "🔐 Authenticate";
      authBtn.classList.remove("authenticated");
      authStatus.textContent = "Not authenticated";
      authStatus.classList.remove("authenticated");
      if (adminContent) adminContent.style.display = "none";
    }
  }

  private loadRoomFromURL(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get("room");

    if (roomId) {
      const roomIdInput = document.getElementById("roomId") as HTMLInputElement;
      if (roomIdInput) {
        roomIdInput.value = roomId;
        this.log("info", `Loaded room ID from URL: ${roomId}`);

        // Auto-load if we have authentication
        if (this.adminToken) {
          this.loadRoom();
        }
      }
    }
  }

  private updateURLWithRoom(roomId: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);

    // Update URL without reloading the page
    window.history.pushState({ roomId }, "", url.toString());
  }
}

// Handle browser back/forward buttons
window.addEventListener("popstate", (event) => {
  if (event.state && event.state.roomId) {
    const roomIdInput = document.getElementById("roomId") as HTMLInputElement;
    if (roomIdInput) {
      roomIdInput.value = event.state.roomId;
    }
  }
});

// Initialize admin console
new AdminConsole();
