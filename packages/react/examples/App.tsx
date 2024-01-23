import React from "react";
import { PlayProvider } from "@playhtml/react";
import { ReactionView } from "./Reaction";

export default function App() {
  return (
    <PlayProvider
      initOptions={
        {
          // room: "my-room", // the namespace for syncing and storage set to `window.location.pathname + window.location.search`` by default
          // host: "mypartykit.user.partykit.dev", // if you want to self-host your own partykit server for extra server-side configuration and security guarantees.
        }
      }
    >
      <ReactionView reaction={{ emoji: "🧡", count: 1 }} />
    </PlayProvider>
  );
}
