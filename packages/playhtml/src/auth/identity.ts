// ABOUTME: Local keypair identity for anonymous users and the signing bridge to the
// ABOUTME: "we were online" extension. Backs playhtml.me and the auth handshake.

import {
  exportPublicKeyHex,
  signAuthPayload,
  generatePersistentPlayerIdentity,
  upgradePersistentPlayerIdentityKey,
  isVerifiablePublicKey,
} from "@playhtml/common";

const IDB_NAME = "playhtml-identity";
const IDB_STORE = "auth";
const IDB_KEY = "keypair";

const SIGN_REQUEST_EVENT = "playhtml:sign-challenge";
const SIGN_RESPONSE_EVENT = "playhtml:sign-response";
const EXTENSION_SIGN_TIMEOUT_MS = 4000;

interface StoredKeypair {
  publicKey: string;
  privateKey: CryptoKey;
}

let localKeypair: StoredKeypair | null = null;
let ensurePromise: Promise<StoredKeypair | null> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function generateKeypair(): Promise<{
  publicKey: string;
  keyPair: CryptoKeyPair;
}> {
  // Non-extractable private key: scripts (including XSS) can use it while the
  // page is open but can never exfiltrate the key material itself.
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const publicKey = await exportPublicKeyHex(keyPair.publicKey);
  return { publicKey, keyPair };
}

/**
 * Loads (or generates and persists) the library's local keypair, then
 * upgrades the persisted PlayerIdentity in localStorage to use the real
 * public key — preserving name/colors. Legacy identities have a random-hex
 * "publicKey" with no key behind them; replacing it is a one-time pid change
 * for anonymous users (accepted in the auth design).
 *
 * Returns null when IndexedDB/WebCrypto are unavailable (private browsing,
 * old browsers) — the identity then stays legacy/unverifiable, and everything
 * else degrades gracefully.
 */
export async function ensureLocalIdentity(): Promise<StoredKeypair | null> {
  if (localKeypair) return localKeypair;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    try {
      if (typeof indexedDB === "undefined" || !crypto?.subtle) return null;
      const db = await openDb();
      let stored = (await idbGet(db, IDB_KEY)) as
        | { publicKey: string; keyPair: CryptoKeyPair }
        | undefined;

      if (!stored?.keyPair?.privateKey || !isVerifiablePublicKey(stored.publicKey)) {
        const generated = await generateKeypair();
        await idbPut(db, IDB_KEY, generated);
        stored = generated;
      }
      db.close();

      localKeypair = {
        publicKey: stored.publicKey,
        privateKey: stored.keyPair.privateKey,
      };

      // Adopt the real key as the persisted identity's pid unless an
      // extension identity already took precedence.
      const identity = generatePersistentPlayerIdentity();
      if (identity.source !== "extension") {
        upgradePersistentPlayerIdentityKey(localKeypair.publicKey, "local");
      }
      return localKeypair;
    } catch (error) {
      console.warn(
        "[playhtml] Local identity unavailable (IndexedDB/WebCrypto failed); identity will be unverifiable.",
        error,
      );
      return null;
    } finally {
      ensurePromise = null;
    }
  })();

  return ensurePromise;
}

export function getLocalPublicKey(): string | null {
  return localKeypair?.publicKey ?? null;
}

/** Test-only: clears module state so ensureLocalIdentity re-runs. */
export function __resetIdentityForTests(): void {
  localKeypair = null;
  ensurePromise = null;
}

/**
 * Signs an auth challenge payload for the given pid. Local pids sign directly
 * with the IndexedDB key; extension pids round-trip through the extension's
 * content-script bridge (the private key never enters page context).
 *
 * Returns null when no key for the pid is reachable — callers treat that as
 * "stay unverified", never as an error.
 */
export async function signChallengeForPid(
  pid: string,
  payload: string,
): Promise<string | null> {
  if (localKeypair && pid === localKeypair.publicKey) {
    try {
      return await signAuthPayload(localKeypair.privateKey, payload);
    } catch (error) {
      console.warn("[playhtml] Failed to sign challenge with local key:", error);
      return null;
    }
  }
  return requestExtensionSignature(pid, payload);
}

/**
 * Asks the extension (via DOM CustomEvents, the only channel that crosses the
 * isolated-world boundary) to sign an auth payload. The extension validates
 * the payload's shape and origin binding independently before signing, so the
 * worst a page can obtain is a signature valid only for a playhtml session on
 * its own origin.
 */
function requestExtensionSignature(
  pid: string,
  payload: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let settled = false;

    const finish = (signature: string | null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener(SIGN_RESPONSE_EVENT, onResponse as EventListener);
      clearTimeout(timer);
      resolve(signature);
    };

    const onResponse = (e: CustomEvent) => {
      const detail = e.detail as
        | { requestId?: string; signature?: string; error?: string }
        | undefined;
      if (!detail || detail.requestId !== requestId) return;
      if (detail.error) {
        console.warn("[playhtml] Extension declined to sign challenge:", detail.error);
        finish(null);
        return;
      }
      finish(typeof detail.signature === "string" ? detail.signature : null);
    };

    const timer = setTimeout(() => finish(null), EXTENSION_SIGN_TIMEOUT_MS);
    document.addEventListener(SIGN_RESPONSE_EVENT, onResponse as EventListener);
    document.dispatchEvent(
      new CustomEvent(SIGN_REQUEST_EVENT, {
        detail: { requestId, pid, payload },
      }),
    );
  });
}
