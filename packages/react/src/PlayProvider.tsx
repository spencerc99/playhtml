import { PropsWithChildren, createContext, useEffect, useState } from "react";
import playhtml from "./playhtml-singleton";
import { InitOptions, CursorOptions } from "playhtml";
import { useLocation } from "./hooks/useLocation";
import { CursorEvents } from "@playhtml/common";

export interface PlayContextInfo
  extends Pick<
    typeof playhtml,
    | "setupPlayElements"
    | "dispatchPlayEvent"
    | "registerPlayEventListener"
    | "removePlayEventListener"
    | "deleteElementData"
  > {
  hasSynced: boolean;
  isProviderMissing: boolean;
  configureCursors: (options: Partial<CursorOptions>) => void;
  getMyPlayerIdentity: () => { color: string; name: string };
  cursors: CursorEvents;
}

export const PlayContext = createContext<PlayContextInfo>({
  setupPlayElements: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  dispatchPlayEvent: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  registerPlayEventListener: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  removePlayEventListener: () => {},
  hasSynced: false,
  isProviderMissing: true,
  configureCursors: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  getMyPlayerIdentity: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  deleteElementData: () => {
    throw new Error(
      "[@playhtml/react]: PlayProvider element missing. please render it at the top-level or use the `standalone` prop"
    );
  },
  cursors: {
    allColors: [],
    color: "",
    name: undefined,
  },
});

interface Props {
  initOptions?: InitOptions;
}

export function PlayProvider({
  children,
  initOptions,
}: PropsWithChildren<Props>) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    // in future migrate this to a more "reactful" way by having all the elements rely state on this context
    playhtml.setupPlayElements();
  }, [pathname, search]);

  const [hasSynced, setHasSynced] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  useEffect(() => {
    // Check for preview mode
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.get("__playhtml_preview__") === "true";

    if (isPreview) {
      // Preview mode: load data from localStorage
      const previewJson = localStorage.getItem("playhtml-preview-data");
      if (previewJson) {
        try {
          const { data } = JSON.parse(previewJson);
          setIsPreviewMode(true);
          playhtml.initPreviewMode(data).then(
            () => {
              setHasSynced(true);
            },
            (err) => {
              console.error("[PlayProvider] Preview mode init failed:", err);
              setHasSynced(true);
            }
          );
          return;
        } catch (e) {
          console.error("[PlayProvider] Failed to parse preview data:", e);
          // Fall through to normal initialization
        }
      } else {
        console.warn(
          "[PlayProvider] Preview mode requested but no preview data found in localStorage"
        );
        // Fall through to normal initialization
      }
    }

    // Normal initialization
    playhtml.init(initOptions).then(
      () => {
        setHasSynced(true);
      },
      (err) => {
        console.error(err);
        setHasSynced(true);
      }
    );
  }, []);

  const configureCursors = (options: Partial<CursorOptions>) => {
    if (playhtml.cursorClient) {
      // Use the new configure method
      playhtml.cursorClient.configure(options);
    } else {
      console.warn(
        "[@playhtml/react]: Cursor client not initialized. Make sure cursors are enabled in initOptions."
      );
    }
  };

  const getMyPlayerIdentity = () => {
    // Access the global cursors API that exposes the current player's information
    const cursors = (window as any).cursors;
    return {
      color: cursors.color,
      name: cursors.name,
    };
  };

  const [cursorsState, setCursorsState] = useState<CursorEvents>({
    allColors: [] as string[],
    color: "",
    name: undefined,
  });

  useEffect(() => {
    const client = playhtml.cursorClient;
    if (!client || !initOptions?.cursors?.enabled) return;

    // Initialize from current values
    const snap = client.getSnapshot();
    setCursorsState({
      allColors: snap.allColors || [],
      color: snap.color || "",
      name: snap.name || "",
    });

    const handleAllColors = (allColors: string[]) => {
      setCursorsState((prev) => ({ ...prev, allColors }));
    };
    const handleColor = (myColor: string) => {
      setCursorsState((prev) => ({ ...prev, color: myColor }));
    };
    const handleName = (myName?: string) => {
      setCursorsState((prev) => ({ ...prev, name: myName }));
    };
    client.on("allColors", handleAllColors);
    client.on("color", handleColor);
    client.on("name", handleName);

    return () => {
      client.off("allColors", handleAllColors);
      client.off("color", handleColor);
      client.off("name", handleName);
    };
  }, [hasSynced]);

  return (
    <PlayContext.Provider
      value={{
        setupPlayElements: playhtml.setupPlayElements,
        dispatchPlayEvent: playhtml.dispatchPlayEvent,
        registerPlayEventListener: playhtml.registerPlayEventListener,
        removePlayEventListener: playhtml.removePlayEventListener,
        deleteElementData: playhtml.deleteElementData,
        hasSynced,
        isProviderMissing: false,
        configureCursors,
        getMyPlayerIdentity,
        cursors: cursorsState,
      }}
    >
      {isPreviewMode && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            backgroundColor: "#ff6b35",
            color: "white",
            padding: "12px 20px",
            textAlign: "center",
            fontWeight: "bold",
            fontSize: "14px",
            zIndex: 999999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          👁️ PREVIEW MODE - Read-only, not connected to server
        </div>
      )}
      {children}
    </PlayContext.Provider>
  );
}
