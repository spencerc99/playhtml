// ABOUTME: Exercises authenticated shared-element bridge traffic on a deployed Worker.
// ABOUTME: Verifies both sync directions and rejects forged public bridge requests.
import {
  Y,
  connectRoom,
  createStore,
  deriveRoomId,
  getHost,
  getPartyHttpUrl,
  sleep,
  waitForSync,
} from "./shared.mjs";

const host = getHost();
const domain =
  process.env.PARTYKIT_SMOKE_DOMAIN ?? "codex-bridge-integration.test";
const stamp = Date.now();
const elementId = "shared";
const sourcePath = `/source-${stamp}`;
const consumerPath = `/consumer-${stamp}`;
const sourceRoom = deriveRoomId(domain, sourcePath);
const consumerRoom = deriveRoomId(domain, consumerPath);

function setSharedPosition(store, x) {
  if (!store.play.canMove) {
    store.play.canMove = {};
  }
  store.play.canMove[elementId] = { x, y: 1 };
}

function readSharedPosition(store) {
  return store.play.canMove?.[elementId] ?? null;
}

async function waitForPosition(store, expectedX, label, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const position = readSharedPosition(store);
    if (position?.x === expectedX) {
      console.log(`${label}: observed x=${expectedX}`);
      return;
    }
    await sleep(100);
  }

  throw new Error(
    `${label} did not observe x=${expectedX}; last=${JSON.stringify(
      readSharedPosition(store),
    )}`,
  );
}

async function expectRejectedBridgeRequest(headers, expectedStatus, label) {
  const response = await fetch(getPartyHttpUrl(host, sourceRoom), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      action: "subscribe",
      consumerRoomId: "forged-consumer",
      elementIds: [elementId],
    }),
  });

  if (response.status !== expectedStatus) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expectedStatus}`,
    );
  }
  console.log(`${label}: rejected with ${response.status}`);
}

const sourceDoc = new Y.Doc();
const consumerDoc = new Y.Doc();
const sourceStore = createStore(sourceDoc);
const consumerStore = createStore(consumerDoc);
const sourceProvider = connectRoom(host, sourceRoom, sourceDoc, {
  sharedElements: JSON.stringify([{ elementId, permissions: "read-write" }]),
});
let consumerProvider;

try {
  await waitForSync(sourceProvider, "source");
  setSharedPosition(sourceStore, 1);

  consumerProvider = connectRoom(host, consumerRoom, consumerDoc, {
    sharedReferences: JSON.stringify([{ domain, path: sourcePath, elementId }]),
  });
  await waitForSync(consumerProvider, "consumer");
  await waitForPosition(consumerStore, 1, "source-to-consumer hydration");

  await expectRejectedBridgeRequest({}, 401, "missing bridge credential");
  await expectRejectedBridgeRequest(
    { "x-playhtml-bridge-secret": "invalid-staging-smoke-secret" },
    403,
    "wrong bridge credential",
  );

  setSharedPosition(consumerStore, 2);
  await waitForPosition(sourceStore, 2, "consumer-to-source update");

  setSharedPosition(sourceStore, 3);
  await waitForPosition(consumerStore, 3, "source-to-consumer update");
} finally {
  consumerProvider?.destroy();
  sourceProvider.destroy();
  consumerDoc.destroy();
  sourceDoc.destroy();
}

console.log(`host=${host}`);
console.log(`sourceRoom=${sourceRoom}`);
console.log(`consumerRoom=${consumerRoom}`);
console.log("bridge integration smoke passed");
