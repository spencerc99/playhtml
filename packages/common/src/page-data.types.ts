// ABOUTME: Type-checks nullable page-data channels through the public setter type.
// ABOUTME: Ensures functional updaters receive the channel's complete value union.

import type { PageDataChannel } from "./index";

interface Item {
  id: string;
}

declare const channel: PageDataChannel<Item | null>;

channel.setData((value) => value ?? { id: "first" });
