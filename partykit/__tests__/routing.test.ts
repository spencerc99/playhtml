// ABOUTME: Verifies PartyServer routing helpers keep room identity explicit.
// ABOUTME: Covers request forwarding behavior without a Durable Object runtime.
import { describe, expect, it } from "bun:test";
import { addPartyRoomHeader } from "../routing";

describe("addPartyRoomHeader", () => {
  it("adds the parsed room name to forwarded requests", () => {
    const request = new Request("https://example.com/parties/main/page", {
      headers: {
        "x-partykit-room": "spoofed",
      },
    });

    const forwarded = addPartyRoomHeader(request, { name: "page" });

    expect(forwarded.headers.get("x-partykit-room")).toBe("page");
  });
});
