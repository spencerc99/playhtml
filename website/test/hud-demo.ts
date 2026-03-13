import React from "react";
import { createRoot } from "react-dom/client";
import { BrowsingHud } from "../../extension/src/components/BrowsingHud";

// Mount the HUD overlay directly (no extension needed for demo)
const container = document.getElementById("hud-root")!;
const root = createRoot(container);

root.render(
  React.createElement(BrowsingHud, {
    visible: true,
    onClose: () => {
      root.render(
        React.createElement("div", {
          style: {
            position: "fixed",
            bottom: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483646,
            fontFamily: "'Martian Mono', monospace",
            fontSize: "10px",
            color: "rgba(232,220,200,0.4)",
            letterSpacing: "0.1em",
            padding: "6px 12px",
            border: "1px solid rgba(232,220,200,0.1)",
            borderRadius: "4px",
            cursor: "pointer",
          },
          onClick: () => mountHud(),
        }, "show hud")
      );
    },
  })
);

function mountHud() {
  root.render(
    React.createElement(BrowsingHud, {
      visible: true,
      onClose: () => {
        root.render(
          React.createElement("div", {
            style: {
              position: "fixed",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 2147483646,
              fontFamily: "'Martian Mono', monospace",
              fontSize: "10px",
              color: "rgba(232,220,200,0.4)",
              letterSpacing: "0.1em",
              padding: "6px 12px",
              border: "1px solid rgba(232,220,200,0.1)",
              borderRadius: "4px",
              cursor: "pointer",
            },
            onClick: () => mountHud(),
          }, "show hud")
        );
      },
    })
  );
}
