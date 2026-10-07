// ABOUTME: Provides request helpers for PartyServer route forwarding.
// ABOUTME: Keeps room identity explicit when routing requests into Durable Objects.

type PartyLobby = {
  name: string;
};

export function addPartyRoomHeader(
  request: Request,
  lobby: PartyLobby,
): Request {
  const forwarded = new Request(request);
  forwarded.headers.set("x-partykit-room", lobby.name);
  return forwarded;
}
