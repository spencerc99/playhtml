// PlayHTML Cryptographic Utilities
// Implements Ed25519 key generation, signing, and verification

import type { PlayHTMLIdentity } from "@playhtml/common";
import { verifySignature } from "@playhtml/common";

// Utility functions for base64 encoding/decoding
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Generate a new PlayHTML identity with Ed25519 key pair (RSA-PSS fallback)
export async function generateIdentity(displayName?: string): Promise<PlayHTMLIdentity> {
  try {
    // Try Ed25519 first (preferred), fallback to RSA-PSS
    let keyPair;
    let algorithm;

    try {
      // Try Ed25519 first
      keyPair = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"]
      );
      algorithm = "Ed25519";
    } catch {
      // Fallback to RSA-PSS for better browser support
      keyPair = await crypto.subtle.generateKey(
        {
          name: "RSA-PSS",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
      );
      algorithm = "RSA-PSS";
    }

    // Export keys
    const privateKeyBuffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const publicKeyBuffer = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    return {
      privateKey: arrayBufferToBase64(privateKeyBuffer),
      publicKey: arrayBufferToBase64(publicKeyBuffer),
      displayName,
      createdAt: Date.now(),
      version: 1,
      algorithm,
    };
  } catch (error) {
    console.error("Failed to generate identity:", error);
    throw new Error("Identity generation failed. This browser may not support the required crypto APIs.");
  }
}

// Import private key from base64 string for signing
export async function importPrivateKey(privateKeyBase64: string, algorithm: string = "Ed25519"): Promise<CryptoKey> {
  const privateKeyBuffer = base64ToArrayBuffer(privateKeyBase64);

  const keyAlgorithm = algorithm === "RSA-PSS"
    ? { name: "RSA-PSS", hash: "SHA-256" }
    : { name: "Ed25519" };

  return await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    keyAlgorithm,
    false, // not extractable
    ["sign"]
  );
}

// Sign a message using a private key
export async function signMessage(message: string, privateKeyBase64: string, algorithm: string = "Ed25519"): Promise<string> {
  try {
    const privateKey = await importPrivateKey(privateKeyBase64, algorithm);
    const messageBuffer = new TextEncoder().encode(message);

    const signAlgorithm = algorithm === "RSA-PSS"
      ? { name: "RSA-PSS", saltLength: 32 }
      : "Ed25519";

    const signature = await crypto.subtle.sign(
      signAlgorithm,
      privateKey,
      messageBuffer
    );

    return arrayBufferToBase64(signature);
  } catch (error) {
    console.error("Failed to sign message:", error);
    throw new Error("Message signing failed");
  }
}

// Re-export verifySignature from common package (single source of truth)
export { verifySignature };

// Export/import identity as JSON
export function exportIdentity(identity: PlayHTMLIdentity): string {
  return JSON.stringify(identity, null, 2);
}

export function importIdentity(jsonData: string): PlayHTMLIdentity {
  try {
    const parsed = JSON.parse(jsonData);

    // Validate required fields
    if (!parsed.privateKey || !parsed.publicKey || !parsed.createdAt) {
      throw new Error("Invalid identity format");
    }

    return parsed as PlayHTMLIdentity;
  } catch (error) {
    throw new Error("Failed to import identity: " + (error instanceof Error ? error.message : String(error)));
  }
}
