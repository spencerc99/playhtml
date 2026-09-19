// ABOUTME: Smoke tests PartyKit startup when Supabase persistence is unavailable.
// ABOUTME: Verifies clients close with a retryable code until hydration recovers.
import {
  WebSocket,
  getHost,
  getPartyWebSocketUrl,
} from "./shared.mjs";

function waitForRecoveryClose(socket, label, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    // Local Wrangler can leave a received close frame in CLOSING until the
    // client terminates the socket. ws retains the server code and reason.
    const closingPoll = setInterval(() => {
      if (socket.readyState === WebSocket.CLOSING) {
        socket.terminate();
      }
    }, 25);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} did not close within ${timeoutMs}ms`));
    }, timeoutMs);

    const onClose = (code, reason) => {
      cleanup();
      const reasonText = reason.toString();
      if (code !== 1013 || reasonText !== "Room Loading") {
        reject(
          new Error(
            `${label} closed with ${code} ${JSON.stringify(reasonText)}, expected 1013 Room Loading`,
          ),
        );
        return;
      }
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearInterval(closingPoll);
      clearTimeout(timer);
      socket.off("close", onClose);
      socket.off("error", onError);
    }

    socket.on("close", onClose);
    socket.on("error", onError);
  });
}

const host = getHost();
const room = `transient-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const protocol =
  host.startsWith("localhost:") || host.startsWith("127.0.0.1:")
    ? "http"
    : "https";

const clients = [
  new WebSocket(getPartyWebSocketUrl(host, room)),
  new WebSocket(getPartyWebSocketUrl(host, room)),
];

try {
  console.log(`Connecting transient smoke room ${room} on ${host}`);
  await Promise.all([
    waitForRecoveryClose(clients[0], "client A"),
    waitForRecoveryClose(clients[1], "client B"),
  ]);
  console.log("clients closed with 1013 while persistence was unavailable");

  const adminResponse = await fetch(
    `${protocol}://${host}/parties/main/${encodeURIComponent(room)}/admin/force-save-live`,
    {
      method: "POST",
      headers: { Authorization: "Bearer dev" },
    },
  );
  const adminBody = await adminResponse.json();
  if (
    adminResponse.status !== 503 ||
    adminBody.error !== "room_load_deferred"
  ) {
    throw new Error(
      `expected deferred admin write to return 503, got ${adminResponse.status}: ${JSON.stringify(adminBody)}`,
    );
  }
  console.log("admin writes are deferred while persistence is unavailable");

  console.log("supabase transient smoke passed");
} finally {
  for (const client of clients) {
    client.close();
  }
}
