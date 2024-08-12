import "./home.scss";
import "./playground.scss";
import { playhtml } from "../packages/playhtml/src/main";

playhtml.init({
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
