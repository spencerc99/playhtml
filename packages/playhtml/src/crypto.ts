// PlayHTML Cryptographic Utilities
// Implements Ed25519 key generation, signing, and verification

import type { PlayHTMLIdentity, SignedAction, AuthenticatedMessage } from "@playhtml/common";
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

// Generate a new PlayHTML identity with RSA-PSS key pair (better browser support than Ed25519)
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
      algorithm, // Store which algorithm was used
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

// Import public key from base64 string for verification
export async function importPublicKey(publicKeyBase64: string, algorithm: string = "Ed25519"): Promise<CryptoKey> {
  const publicKeyBuffer = base64ToArrayBuffer(publicKeyBase64);
  
  const keyAlgorithm = algorithm === "RSA-PSS" 
    ? { name: "RSA-PSS", hash: "SHA-256" }
    : { name: "Ed25519" };
  
  return await crypto.subtle.importKey(
    "spki",
    publicKeyBuffer,
    keyAlgorithm,
    false, // not extractable
    ["verify"]
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

// Re-export verifySignature from common package for backward compatibility
export { verifySignature };

// Create a signed action for authenticated operations
export async function createSignedAction(
  action: string,
  elementId: string,
  data: any,
  identity: PlayHTMLIdentity
): Promise<SignedAction> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  
  const payload = { action, elementId, data, timestamp, nonce };
  const message = JSON.stringify(payload);
  const signature = await signMessage(message, identity.privateKey, identity.algorithm);

  return {
    ...payload,
    signature,
    publicKey: identity.publicKey,
    algorithm: identity.algorithm,
  };
}

// Verify a signed action
export async function verifySignedAction(signedAction: SignedAction): Promise<boolean> {
  const { signature, publicKey, algorithm, ...payload } = signedAction;
  const message = JSON.stringify(payload);
  
  // Check timestamp freshness (5 minute window)
  const age = Date.now() - signedAction.timestamp;
  if (age > 5 * 60 * 1000 || age < -60 * 1000) {
    console.error("Signed action timestamp outside acceptable window");
    return false;
  }
  
  return await verifySignature(message, signature, publicKey, algorithm);
}

// Create an authenticated message for server communication
export async function createAuthenticatedMessage(
  type: string,
  data: any,
  identity: PlayHTMLIdentity
): Promise<AuthenticatedMessage> {
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  
  const payload = { type, data, timestamp, nonce };
  const message = JSON.stringify(payload);
  const signature = await signMessage(message, identity.privateKey, identity.algorithm);

  return {
    ...payload,
    signature,
    publicKey: identity.publicKey,
    algorithm: identity.algorithm,
  };
}

// Verify an authenticated message
export async function verifyAuthenticatedMessage(
  message: AuthenticatedMessage
): Promise<boolean> {
  const { signature, publicKey, algorithm, ...payload } = message;
  const messageToVerify = JSON.stringify(payload);
  
  // Check timestamp freshness
  const age = Date.now() - message.timestamp;
  if (age > 5 * 60 * 1000 || age < -60 * 1000) {
    return false;
  }
  
  return await verifySignature(messageToVerify, signature, publicKey, algorithm);
}

// Export/import identity with optional password encryption
export function exportIdentity(identity: PlayHTMLIdentity, password?: string): string {
  // For now, export as plain JSON. TODO: Add encryption support
  if (password) {
    console.warn("Password encryption not yet implemented, exporting as plain text");
  }
  
  return JSON.stringify(identity, null, 2);
}

export function importIdentity(jsonData: string, password?: string): PlayHTMLIdentity {
  // For now, import from plain JSON. TODO: Add decryption support
  if (password) {
    console.warn("Password decryption not yet implemented, importing as plain text");
  }
  
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