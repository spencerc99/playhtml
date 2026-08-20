// ABOUTME: Checks the public usePresence channel and payload type contract.
// ABOUTME: Ensures presence reads are nested while writes accept the channel payload.

import { usePresence } from "../index";

type StatusPresence = {
  text: string;
};

export function verifyUsePresenceTypes(): void {
  const { presences, setMyPresence } = usePresence<
    "status",
    StatusPresence
  >("status");
  const peer = presences.get("peer");

  if (peer) {
    const status: StatusPresence | undefined = peer.status;
    void status;

    // @ts-expect-error The payload is stored under the selected channel.
    peer.text;
    // @ts-expect-error Other presence channels do not share the selected payload type.
    peer.activity;
  }

  setMyPresence({ text: "focused" });

  // @ts-expect-error setMyPresence accepts the payload without the channel wrapper.
  setMyPresence({ status: { text: "focused" } });
  // @ts-expect-error The type-level channel must match the subscribed channel.
  usePresence<"status", StatusPresence>("activity");
  // @ts-expect-error The first type argument is the channel name.
  usePresence<StatusPresence>("status");
}
