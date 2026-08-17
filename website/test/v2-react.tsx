// ABOUTME: Exercises React shared state and built-in capabilities over protocol v2.
// ABOUTME: Connects the manual test page to the local v2 PartyKit host.

import React from "react";
import ReactDOM from "react-dom/client";
import {
  CanToggleElement,
  PlayProvider,
  withSharedState,
} from "@playhtml/react";

const Counter = withSharedState(
  { defaultData: { count: 0 } },
  ({ data, setData }) => (
    <button
      id="react-v2-counter"
      onClick={() => {
        setData((draft) => {
          draft.count += 1;
        });
      }}
    >
      Shared count: {data.count}
    </button>
  ),
);

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <PlayProvider initOptions={{ v2: true, host: "localhost:2000" }}>
    <section>
      <h2>withSharedState</h2>
      <p>Open this page in two tabs and click the counter in either tab.</p>
      <Counter />
    </section>
    <section>
      <h2>CanToggleElement</h2>
      <p>Click the button to sync its toggled state.</p>
      <CanToggleElement>
        <button id="react-v2-toggle">Toggle me</button>
      </CanToggleElement>
    </section>
  </PlayProvider>,
);
