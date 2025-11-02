import "../home.scss";
import "./playground.scss";
import { playhtml } from "../../packages/playhtml/src";

playhtml.init({
  cursors: {
    enabled: true,
    room: "domain",
    shouldRenderCursor: (presence) => {
      return presence.page === window.location.pathname;
    },
  },
  events: {
    confetti: {
      type: "confetti",
      onEvent: (data) => {
        window.confetti({
          ...(data || {}),
          shapes:
            // NOTE: this serialization is needed because `slide` doesn't serialize to JSON properly.
            "shapes" in data
              ? data.shapes.map((shape) => (shape === "slide" ? slide : shape))
              : undefined,
        });
      },
    },
  },
});
