// ABOUTME: Smoke tests PartyKit startup when Supabase persistence is unavailable.
// ABOUTME: Verifies realtime document sync and awareness continue in transient mode.
import {
  Y,
  connectRoom,
  getHost,
  sleep,
  waitForSync,
} from "./shared.mjs";

function waitForCondition(label, predicate, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      try {
        if (predicate()) {
          clearInterval(timer);
          resolve();
          return;
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${label} did not happen within ${timeoutMs}ms`));
      }
    }, 50);
  });
}

const host = getHost();
const room = `transient-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const protocol = host.startsWith("localhost:") || host.startsWith("127.0.0.1:")
  ? "http"
  : "https";

const docA = new Y.Doc();
const docB = new Y.Doc();
const providerA = connectRoom(host, room, docA);
const providerB = connectRoom(host, room, docB);

try {
  console.log(`Connecting transient smoke room ${room} on ${host}`);
  await Promise.all([
    waitForSync(providerA, "client A"),
    waitForSync(providerB, "client B"),
  ]);

  providerA.awareness.setLocalStateField("transientSmoke", {
    client: "A",
    online: true,
  });

  await waitForCondition("awareness propagation", () => {
    return Array.from(providerB.awareness.getStates().values()).some((state) => {
      return state?.transientSmoke?.client === "A";
    });
  });
  console.log("awareness propagated while persistence was unavailable");

  docA.getMap("transient-smoke").set("message", "live while transient");

  await waitForCondition("document propagation", () => {
    return (
      docB.getMap("transient-smoke").get("message") === "live while transient"
    );
  });
  console.log("document update propagated while persistence was unavailable");

  const adminResponse = await fetch(
    `${protocol}://${host}/parties/main/${encodeURIComponent(room)}/admin/force-save-live`,
    {
      method: "POST",
      headers: { Authorization: "Bearer dev" },
    }
  );
  const adminBody = await adminResponse.json();
  if (
    adminResponse.status !== 503 ||
    adminBody.error !== "persistence_unavailable"
  ) {
    throw new Error(
      `expected transient admin write to return 503, got ${adminResponse.status}: ${JSON.stringify(adminBody)}`
    );
  }
  console.log("admin writes are blocked while persistence is unavailable");

  await sleep(100);
  console.log("supabase transient smoke passed");
} finally {
  providerA.destroy();
  providerB.destroy();
  docA.destroy();
  docB.destroy();
}
