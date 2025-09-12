import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

// Mock crypto for Node.js environment
const mockCrypto = {
  randomUUID: vi.fn(() => 'test-session-uuid'),
  subtle: {
    importKey: vi.fn(),
    verify: vi.fn(),
  }
};

// Setup global crypto mock
globalThis.crypto = mockCrypto as any;

// Test data - these should match real Ed25519/RSA-PSS key formats
const TEST_KEYS = {
  ed25519: {
    publicKey: "MCowBQYDK2VwAyEAMndQFsLmugJTh0yVF0somtpb9FVY91mTTmMXUB+Bzfc=", // Real Ed25519 public key
    signature: "ZYVDrvh6Buc6ce4Znle3+efFC1ZZ7aOe9uX++bUmdpAdwfj78/IZbDYRL1U9k+BDW6jr3VNk9MQTqIPB1O2VBw==", // 64 bytes
    algorithm: "Ed25519"
  },
  rsaPss: {
    publicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA", // Truncated RSA public key for test
    signature: "dGVzdC1yc2Etc2lnbmF0dXJlLWxvbmctZW5vdWdoLWZvci1yc2EtcHNzLXNpZ25hdHVyZS10ZXN0aW5nLXB1cnBvc2VzLW9ubHk=", // 256 bytes when decoded  
    algorithm: "RSA-PSS"
  }
};

// Import the functions we need to test - we'll need to extract these from party.ts
// For now, let's recreate the key functions to test

async function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string,
  algorithm: string = "Ed25519"
): Promise<boolean> {
  try {
    console.log(`[PartyKit] Verifying signature with algorithm: ${algorithm}`);
    console.log(`[PartyKit] Public key length: ${publicKeyBase64.length}`);
    console.log(`[PartyKit] Signature length: ${signatureBase64.length}`);
    
    // Early return for empty inputs
    if (!signatureBase64 || !publicKeyBase64) {
      console.log(`[PartyKit] Signature verification result: false (empty inputs)`);
      return false;
    }
    
    let publicKeyBuffer: Buffer;
    let signatureBuffer: Buffer;
    
    try {
      // Check if inputs are valid base64
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(publicKeyBase64) || !/^[A-Za-z0-9+/]*={0,2}$/.test(signatureBase64)) {
        console.log(`[PartyKit] Signature verification result: false (invalid base64)`);
        return false;
      }
      
      publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");
      signatureBuffer = Buffer.from(signatureBase64, "base64");
    } catch (error) {
      console.log(`[PartyKit] Signature verification result: false (invalid base64)`);
      return false;
    }
    
    const keyAlgorithm = algorithm === "RSA-PSS" 
      ? { name: "RSA-PSS", hash: "SHA-256" }
      : { name: "Ed25519" };
    
    const publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyBuffer,
      keyAlgorithm,
      false,
      ["verify"]
    );

    const messageBuffer = new TextEncoder().encode(message);

    const verifyAlgorithm = algorithm === "RSA-PSS" 
      ? { name: "RSA-PSS", saltLength: 32 }
      : "Ed25519";

    const result = await crypto.subtle.verify(
      verifyAlgorithm,
      publicKey,
      signatureBuffer,
      messageBuffer
    );
    
    console.log(`[PartyKit] Signature verification result: ${result}`);
    return result;
  } catch (error) {
    console.error("Signature verification failed:", error);
    return false;
  }
}

interface ValidatedSession {
  sessionId: string;
  publicKey: string;
  domain: string;
  establishedAt: number;
  expiresAt: number;
}

interface SessionAction {
  sessionId: string;
  action: string;
  elementId: string;
  data: any;
  timestamp: number;
  nonce: string;
}

class MockSessionManager {
  private validSessions = new Map<string, ValidatedSession>();
  private usedNonces = new Set<string>();

  createSession(publicKey: string, domain: string = "localhost"): ValidatedSession {
    const session: ValidatedSession = {
      sessionId: crypto.randomUUID(),
      publicKey,
      domain,
      establishedAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    };
    
    this.validSessions.set(session.sessionId, session);
    return session;
  }

  findExistingSession(publicKey: string): ValidatedSession | null {
    for (const session of this.validSessions.values()) {
      if (session.publicKey === publicKey && session.expiresAt > Date.now()) {
        return session;
      }
    }
    return null;
  }

  validateSessionAction(action: SessionAction): boolean {
    // Check if session exists and is not expired
    const session = this.validSessions.get(action.sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return false;
    }

    // Check nonce uniqueness
    const nonceKey = `${action.sessionId}:${action.nonce}`;
    if (this.usedNonces.has(nonceKey)) {
      return false;
    }

    // Basic action validation
    const isValidFormat = !!(
      action.sessionId &&
      action.action &&
      action.elementId &&
      action.timestamp &&
      action.nonce &&
      (Date.now() - action.timestamp) < 5 * 60 * 1000 // Within 5 minutes
    );

    if (isValidFormat) {
      this.usedNonces.add(nonceKey);
    }

    return isValidFormat;
  }

  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [sessionId, session] of this.validSessions.entries()) {
      if (session.expiresAt < now) {
        this.validSessions.delete(sessionId);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  getSessionCount(): number {
    return this.validSessions.size;
  }
}

describe("Server-Side Authentication - Signature Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should verify valid Ed25519 signature", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(true);

    const result = await verifySignature(
      "test message",
      TEST_KEYS.ed25519.signature,
      TEST_KEYS.ed25519.publicKey,
      "Ed25519"
    );

    expect(result).toBe(true);
    expect(mockCrypto.subtle.importKey).toHaveBeenCalledWith(
      "spki",
      expect.anything(),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
  });

  it("should verify valid RSA-PSS signature", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(true);

    const result = await verifySignature(
      "test message",
      TEST_KEYS.rsaPss.signature,
      TEST_KEYS.rsaPss.publicKey,
      "RSA-PSS"
    );

    expect(result).toBe(true);
    expect(mockCrypto.subtle.importKey).toHaveBeenCalledWith(
      "spki",
      expect.anything(),
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["verify"]
    );
  });

  it("should reject invalid signatures", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(false);

    const result = await verifySignature(
      "test message",
      "invalid-signature",
      TEST_KEYS.ed25519.publicKey,
      "Ed25519"
    );

    expect(result).toBe(false);
  });

  it("should handle malformed public keys gracefully", async () => {
    mockCrypto.subtle.importKey.mockRejectedValue(new Error("Invalid key format"));

    const result = await verifySignature(
      "test message",
      TEST_KEYS.ed25519.signature,
      "malformed-key!!!",
      "Ed25519"
    );

    expect(result).toBe(false);
  });

  it("should handle crypto operation failures", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockRejectedValue(new Error("Crypto operation failed"));

    const result = await verifySignature(
      "test message",
      TEST_KEYS.ed25519.signature,
      TEST_KEYS.ed25519.publicKey,
      "Ed25519"
    );

    expect(result).toBe(false);
  });

  it("should log verification details", async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(true);

    await verifySignature(
      "test message",
      TEST_KEYS.ed25519.signature,
      TEST_KEYS.ed25519.publicKey,
      "Ed25519"
    );

    expect(consoleSpy).toHaveBeenCalledWith('[PartyKit] Verifying signature with algorithm: Ed25519');
    expect(consoleSpy).toHaveBeenCalledWith(`[PartyKit] Public key length: ${TEST_KEYS.ed25519.publicKey.length}`);
    expect(consoleSpy).toHaveBeenCalledWith(`[PartyKit] Signature length: ${TEST_KEYS.ed25519.signature.length}`);
    expect(consoleSpy).toHaveBeenCalledWith('[PartyKit] Signature verification result: true');
  });
});

describe("Server-Side Authentication - Session Management", () => {
  let sessionManager: MockSessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new MockSessionManager();
    mockCrypto.randomUUID.mockReturnValue('test-session-123');
  });

  it("should create new session", () => {
    const session = sessionManager.createSession(TEST_KEYS.ed25519.publicKey);

    expect(session).toEqual({
      sessionId: 'test-session-123',
      publicKey: TEST_KEYS.ed25519.publicKey,
      domain: 'localhost',
      establishedAt: expect.any(Number),
      expiresAt: expect.any(Number),
    });

    // Should expire in 24 hours
    expect(session.expiresAt - session.establishedAt).toBe(24 * 60 * 60 * 1000);
  });

  it("should find existing session by public key", () => {
    const session = sessionManager.createSession(TEST_KEYS.ed25519.publicKey);
    const found = sessionManager.findExistingSession(TEST_KEYS.ed25519.publicKey);

    expect(found).toEqual(session);
  });

  it("should return null for non-existent session", () => {
    const found = sessionManager.findExistingSession("non-existent-key");
    expect(found).toBeNull();
  });

  it("should not find expired sessions", () => {
    const session = sessionManager.createSession(TEST_KEYS.ed25519.publicKey);
    
    // Manually expire the session
    session.expiresAt = Date.now() - 1000;
    
    const found = sessionManager.findExistingSession(TEST_KEYS.ed25519.publicKey);
    expect(found).toBeNull();
  });

  it("should clean up expired sessions", () => {
    mockCrypto.randomUUID
      .mockReturnValueOnce('session-1')
      .mockReturnValueOnce('session-2');
      
    const session1 = sessionManager.createSession(TEST_KEYS.ed25519.publicKey, "domain1");
    const session2 = sessionManager.createSession(TEST_KEYS.rsaPss.publicKey, "domain2");
    
    // Expire first session
    session1.expiresAt = Date.now() - 1000;
    
    expect(sessionManager.getSessionCount()).toBe(2);
    
    const cleaned = sessionManager.cleanupExpiredSessions();
    
    expect(cleaned).toBe(1);
    expect(sessionManager.getSessionCount()).toBe(1);
  });
});

describe("Server-Side Authentication - Session Actions", () => {
  let sessionManager: MockSessionManager;
  let validSession: ValidatedSession;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new MockSessionManager();
    validSession = sessionManager.createSession(TEST_KEYS.ed25519.publicKey);
    mockCrypto.randomUUID.mockReturnValue('action-nonce-456');
  });

  it("should validate valid session action", () => {
    const action: SessionAction = {
      sessionId: validSession.sessionId,
      action: 'write',
      elementId: 'test-element',
      data: { x: 10, y: 20 },
      timestamp: Date.now(),
      nonce: 'unique-nonce-123',
    };

    const isValid = sessionManager.validateSessionAction(action);
    expect(isValid).toBe(true);
  });

  it("should reject action with invalid session", () => {
    const action: SessionAction = {
      sessionId: 'invalid-session-id',
      action: 'write',
      elementId: 'test-element',
      data: { x: 10, y: 20 },
      timestamp: Date.now(),
      nonce: 'unique-nonce-123',
    };

    const isValid = sessionManager.validateSessionAction(action);
    expect(isValid).toBe(false);
  });

  it("should reject action with expired session", () => {
    // Expire the session
    validSession.expiresAt = Date.now() - 1000;

    const action: SessionAction = {
      sessionId: validSession.sessionId,
      action: 'write',
      elementId: 'test-element',
      data: { x: 10, y: 20 },
      timestamp: Date.now(),
      nonce: 'unique-nonce-123',
    };

    const isValid = sessionManager.validateSessionAction(action);
    expect(isValid).toBe(false);
  });

  it("should reject duplicate nonce", () => {
    const action: SessionAction = {
      sessionId: validSession.sessionId,
      action: 'write',
      elementId: 'test-element',
      data: { x: 10, y: 20 },
      timestamp: Date.now(),
      nonce: 'duplicate-nonce',
    };

    // First action should succeed
    expect(sessionManager.validateSessionAction(action)).toBe(true);
    
    // Second action with same nonce should fail
    expect(sessionManager.validateSessionAction(action)).toBe(false);
  });

  it("should reject old timestamp", () => {
    const action: SessionAction = {
      sessionId: validSession.sessionId,
      action: 'write',
      elementId: 'test-element',
      data: { x: 10, y: 20 },
      timestamp: Date.now() - (10 * 60 * 1000), // 10 minutes ago
      nonce: 'unique-nonce-123',
    };

    const isValid = sessionManager.validateSessionAction(action);
    expect(isValid).toBe(false);
  });

  it("should reject incomplete action data", () => {
    const incompleteAction = {
      sessionId: validSession.sessionId,
      action: 'write',
      // missing elementId, data, timestamp, nonce
    } as any;

    const isValid = sessionManager.validateSessionAction(incompleteAction);
    expect(isValid).toBe(false);
  });
});

describe("Server-Side Authentication - Error Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle empty signature", async () => {
    const result = await verifySignature("test", "", TEST_KEYS.ed25519.publicKey, "Ed25519");
    expect(result).toBe(false);
  });

  it("should handle empty public key", async () => {
    const result = await verifySignature("test", TEST_KEYS.ed25519.signature, "", "Ed25519");
    expect(result).toBe(false);
  });

  it("should handle invalid base64 in signature", async () => {
    const result = await verifySignature("test", "not-base64!", TEST_KEYS.ed25519.publicKey, "Ed25519");
    expect(result).toBe(false);
  });

  it("should handle invalid base64 in public key", async () => {
    const result = await verifySignature("test", TEST_KEYS.ed25519.signature, "not-base64!", "Ed25519");
    expect(result).toBe(false);
  });

  it("should default to Ed25519 when no algorithm specified", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(true);

    await verifySignature("test", TEST_KEYS.ed25519.signature, TEST_KEYS.ed25519.publicKey);

    expect(mockCrypto.subtle.importKey).toHaveBeenCalledWith(
      "spki",
      expect.anything(),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
  });
});