// ABOUTME: Exercises shared-element sync across a Durable Object hibernation window.
// ABOUTME: Verifies live and reconnecting consumers receive bridge updates after wake.
import {
  Y,
  connectRoom,
  createStore,
  deriveRoomId,
  getHost,
  getNumberEnv,
  sleep,
  waitForSync,
} from "./shared.mjs";

const host = getHost();
const domain =
  process.env.PARTYKIT_SMOKE_DOMAIN ?? "codex-bridge-hibernation.test";
const stamp = Date.now();
const elementId = "shared";
const idleWaitMs = getNumberEnv("PARTYKIT_HIBERNATION_WAIT_MS", 90_000);

function setSharedPosition(store, x, y) {
  if (!store.play.canMove) {
    store.play.canMove = {};
  }
  store.play.canMove[elementId] = { x, y };
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
      return position;
    }
    await sleep(100);
  }

  throw new Error(
    `${label} did not observe x=${expectedX}; last=${JSON.stringify(
      readSharedPosition(store)
    )}`
  );
}

async function runLiveConsumerCase() {
  const sourcePath = `/source-live-${stamp}`;
  const consumerPath = `/consumer-live-${stamp}`;
  const sourceRoom = deriveRoomId(domain, sourcePath);
  const consumerRoom = deriveRoomId(domain, consumerPath);

  const sourceDoc = new Y.Doc();
  const consumerDoc = new Y.Doc();
  const sourceStore = createStore(sourceDoc);
  const consumerStore = createStore(consumerDoc);

  const sourceProvider = connectRoom(host, sourceRoom, sourceDoc, {
    sharedElements: JSON.stringify([{ elementId, permissions: "read-write" }]),
  });
  const consumerProvider = connectRoom(host, consumerRoom, consumerDoc, {
    sharedReferences: JSON.stringify([{ domain, path: sourcePath, elementId }]),
  });

  try {
    await Promise.all([
      waitForSync(sourceProvider, "live source"),
      waitForSync(consumerProvider, "live consumer"),
    ]);

    setSharedPosition(sourceStore, 1, 1);
    await waitForPosition(consumerStore, 1, "live consumer initial");

    console.log(
      `live consumer: waiting ${idleWaitMs / 1000}s for hibernation window`
    );
    await sleep(idleWaitMs);

    setSharedPosition(sourceStore, 2, 1);
    await waitForPosition(consumerStore, 2, "live consumer post-idle");
  } finally {
    sourceProvider.destroy();
    consumerProvider.destroy();
  }
}

async function runObserverOnlyCase() {
  const sourcePath = `/source-observer-${stamp}`;
  const consumerPath = `/consumer-observer-${stamp}`;
  const sourceRoom = deriveRoomId(domain, sourcePath);
  const consumerRoom = deriveRoomId(domain, consumerPath);

  const sourceDoc = new Y.Doc();
  const firstConsumerDoc = new Y.Doc();
  const sourceStore = createStore(sourceDoc);
  const firstConsumerStore = createStore(firstConsumerDoc);

  const sourceProvider = connectRoom(host, sourceRoom, sourceDoc, {
    sharedElements: JSON.stringify([{ elementId, permissions: "read-write" }]),
  });
  const firstConsumerProvider = connectRoom(
    host,
    consumerRoom,
    firstConsumerDoc,
    {
      sharedReferences: JSON.stringify([
        { domain, path: sourcePath, elementId },
      ]),
    }
  );

  try {
    await Promise.all([
      waitForSync(sourceProvider, "observer source"),
      waitForSync(firstConsumerProvider, "observer consumer"),
    ]);

    setSharedPosition(sourceStore, 1, 1);
    await waitForPosition(
      firstConsumerStore,
      1,
      "observer initial consumer"
    );
    firstConsumerProvider.destroy();

    console.log(
      `observer source: waiting ${idleWaitMs / 1000}s for hibernation window`
    );
    await sleep(idleWaitMs);

    setSharedPosition(sourceStore, 2, 1);
    await sleep(3_000);

    const secondConsumerDoc = new Y.Doc();
    const secondConsumerStore = createStore(secondConsumerDoc);
    const secondConsumerProvider = connectRoom(
      host,
      consumerRoom,
      secondConsumerDoc,
      {
        sharedReferences: JSON.stringify([
          { domain, path: sourcePath, elementId },
        ]),
      }
    );

    try {
      await waitForSync(secondConsumerProvider, "observer reconnect consumer");
      await waitForPosition(
        secondConsumerStore,
        2,
        "observer reconnect consumer post-idle"
      );
    } finally {
      secondConsumerProvider.destroy();
    }
  } finally {
    sourceProvider.destroy();
  }
}

console.log(`host=${host}`);
console.log(`stamp=${stamp}`);
await runLiveConsumerCase();
await runObserverOnlyCase();
console.log("hibernation bridge smoke passed");
