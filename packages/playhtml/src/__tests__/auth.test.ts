import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateIdentity,
  signMessage,
  verifySignature,
  generateSessionChallenge,
  createSessionAction,
  getCurrentSession,
} from "../auth";
import type { PlayHTMLIdentity, SessionChallenge } from "@playhtml/common";

// Mock global crypto for testing
const mockCrypto = {
  randomUUID: vi.fn(() => 'test-uuid-12345'),
  subtle: {
    generateKey: vi.fn(),
    sign: vi.fn(),
    verify: vi.fn(),
    importKey: vi.fn(),
    exportKey: vi.fn(),
  }
};

Object.defineProperty(globalThis, 'crypto', {
  value: mockCrypto,
  writable: true
});

// Mock window object for session utilities  
Object.defineProperty(globalThis, 'window', {
  value: {
    location: {
      hostname: 'localhost'
    }
  },
  writable: true
});

describe("Authentication - Identity Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a valid Ed25519 identity", async () => {
    // Mock successful Ed25519 key generation
    const mockKeyPair = {
      privateKey: { type: 'private' },
      publicKey: { type: 'public' }
    };
    
    mockCrypto.subtle.generateKey.mockResolvedValue(mockKeyPair as any);
    mockCrypto.subtle.exportKey
      .mockResolvedValueOnce(new ArrayBuffer(32)) // private key
      .mockResolvedValueOnce(new ArrayBuffer(44)); // public key

    const identity = await generateIdentity("Test User");

    expect(identity).toHaveProperty('privateKey');
    expect(identity).toHaveProperty('publicKey');
    expect(identity).toHaveProperty('displayName', 'Test User');
    expect(identity).toHaveProperty('algorithm', 'Ed25519');
    expect(identity).toHaveProperty('createdAt');
    expect(identity).toHaveProperty('version', 1);
    
    expect(crypto.subtle.generateKey).toHaveBeenCalledWith(
      { name: "Ed25519" },
      true,
      ["sign", "verify"]
    );
  });

  it("should fallback to RSA-PSS when Ed25519 fails", async () => {
    // Mock Ed25519 failure, RSA-PSS success
    mockCrypto.subtle.generateKey
      .mockRejectedValueOnce(new Error("Ed25519 not supported"))
      .mockResolvedValueOnce({
        privateKey: { type: 'private' },
        publicKey: { type: 'public' }
      } as any);
    
    mockCrypto.subtle.exportKey
      .mockResolvedValueOnce(new ArrayBuffer(256)) // RSA private key
      .mockResolvedValueOnce(new ArrayBuffer(270)); // RSA public key

    const identity = await generateIdentity("Test User");

    expect(identity.algorithm).toBe('RSA-PSS');
    expect(crypto.subtle.generateKey).toHaveBeenCalledTimes(2);
    expect(crypto.subtle.generateKey).toHaveBeenLastCalledWith({
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    }, true, ["sign", "verify"]);
  });

  it("should create identity with correct structure", async () => {
    const mockKeyPair = { privateKey: {}, publicKey: {} };
    mockCrypto.subtle.generateKey.mockResolvedValue(mockKeyPair as any);
    mockCrypto.subtle.exportKey
      .mockResolvedValue(new ArrayBuffer(32));

    const identity = await generateIdentity();

    expect(identity).toEqual(expect.objectContaining({
      privateKey: expect.any(String),
      publicKey: expect.any(String),
      createdAt: expect.any(Number),
      version: 1,
      algorithm: expect.stringMatching(/^(Ed25519|RSA-PSS)$/),
    }));
  });
});

describe("Authentication - Message Signing", () => {
  let testIdentity: PlayHTMLIdentity;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create a test identity
    testIdentity = {
      privateKey: "dGVzdC1wcml2YXRlLWtleQ==", // base64: "test-private-key"
      publicKey: "dGVzdC1wdWJsaWMta2V5", // base64: "test-public-key"
      algorithm: "Ed25519",
      displayName: "Test User",
      createdAt: Date.now(),
      version: 1,
    };
  });

  it("should sign a message with Ed25519", async () => {
    const mockSignature = new ArrayBuffer(64);
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.sign.mockResolvedValue(mockSignature);

    const message = "test message";
    const signature = await signMessage(message, testIdentity.privateKey, "Ed25519");

    expect(mockCrypto.subtle.importKey).toHaveBeenCalledWith(
      "pkcs8",
      expect.anything(),
      { name: "Ed25519" },
      false,
      ["sign"]
    );
    expect(mockCrypto.subtle.sign).toHaveBeenCalledWith(
      "Ed25519",
      expect.anything(),
      expect.anything()
    );
    expect(signature).toEqual(expect.any(String));
  });

  it("should sign a message with RSA-PSS", async () => {
    const mockSignature = new ArrayBuffer(256);
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.sign.mockResolvedValue(mockSignature);

    const message = "test message";
    const signature = await signMessage(message, testIdentity.privateKey, "RSA-PSS");

    expect(mockCrypto.subtle.importKey).toHaveBeenCalledWith(
      "pkcs8",
      expect.anything(),
      { name: "RSA-PSS", hash: "SHA-256" },
      false,
      ["sign"]
    );
    expect(mockCrypto.subtle.sign).toHaveBeenCalledWith(
      { name: "RSA-PSS", saltLength: 32 },
      expect.anything(),
      expect.anything()
    );
  });

  it("should produce deterministic signatures", async () => {
    const mockSignature = new ArrayBuffer(64);
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.sign.mockResolvedValue(mockSignature);

    const message = "consistent message";
    const signature1 = await signMessage(message, testIdentity.privateKey, "Ed25519");
    const signature2 = await signMessage(message, testIdentity.privateKey, "Ed25519");

    expect(signature1).toBe(signature2);
  });

  it("should handle signing errors gracefully", async () => {
    mockCrypto.subtle.importKey.mockRejectedValue(new Error("Import failed"));

    await expect(signMessage("test", testIdentity.privateKey, "Ed25519"))
      .rejects.toThrow("Message signing failed");
  });
});

describe("Authentication - Signature Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should verify valid Ed25519 signature", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(true);

    const result = await verifySignature(
      "test message",
      "dGVzdC1zaWduYXR1cmU=", // base64: "test-signature"
      "dGVzdC1wdWJsaWMta2V5", // base64: "test-public-key"
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
    expect(mockCrypto.subtle.verify).toHaveBeenCalledWith(
      "Ed25519",
      expect.anything(),
      expect.anything(),
      expect.any(ArrayBuffer)
    );
  });

  it("should verify valid RSA-PSS signature", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(true);

    const result = await verifySignature(
      "test message",
      "dGVzdC1zaWduYXR1cmU=",
      "dGVzdC1wdWJsaWMta2V5",
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
    expect(mockCrypto.subtle.verify).toHaveBeenCalledWith(
      { name: "RSA-PSS", saltLength: 32 },
      expect.anything(),
      expect.anything(),
      expect.any(ArrayBuffer)
    );
  });

  it("should return false for invalid signature", async () => {
    mockCrypto.subtle.importKey.mockResolvedValue({} as any);
    mockCrypto.subtle.verify.mockResolvedValue(false);

    const result = await verifySignature(
      "test message",
      "invalid-signature",
      "dGVzdC1wdWJsaWMta2V5",
      "Ed25519"
    );

    expect(result).toBe(false);
  });

  it("should return false on crypto errors", async () => {
    mockCrypto.subtle.importKey.mockRejectedValue(new Error("Key import failed"));

    const result = await verifySignature(
      "test message",
      "dGVzdC1zaWduYXR1cmU=",
      "invalid-key",
      "Ed25519"
    );

    expect(result).toBe(false);
  });
});

describe("Authentication - Session Challenges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCrypto.randomUUID.mockReturnValue('test-challenge-uuid');
    
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true
    });
  });

  it("should generate valid session challenge", () => {
    const challenge = generateSessionChallenge();

    expect(challenge).toEqual({
      challenge: 'test-challenge-uuid',
      domain: 'localhost',
      timestamp: expect.any(Number),
      expiresAt: expect.any(Number),
    });

    // Should expire in 5 minutes (300,000ms)
    expect(challenge.expiresAt - challenge.timestamp).toBe(5 * 60 * 1000);
  });

  it("should create unique challenges", () => {
    mockCrypto.randomUUID
      .mockReturnValueOnce('challenge-1')
      .mockReturnValueOnce('challenge-2');

    const challenge1 = generateSessionChallenge();
    const challenge2 = generateSessionChallenge();

    expect(challenge1.challenge).not.toBe(challenge2.challenge);
  });

  it("should use correct domain from window.location", () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'example.com' },
      writable: true
    });

    const challenge = generateSessionChallenge();
    expect(challenge.domain).toBe('example.com');
  });
});

describe("Authentication - Session Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCrypto.randomUUID.mockReturnValue('action-nonce-123');
  });

  it("should create valid session action", () => {
    // Mock current session
    const mockSession = {
      sessionId: 'test-session-123',
      publicKey: 'test-key',
      domain: 'localhost',
      establishedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    vi.doMock('../auth', () => ({
      getCurrentSession: () => mockSession,
    }));

    const action = createSessionAction('write', 'element-123', { x: 10, y: 20 });

    expect(action).toEqual({
      sessionId: 'test-session-123',
      action: 'write',
      elementId: 'element-123', 
      data: { x: 10, y: 20 },
      timestamp: expect.any(Number),
      nonce: 'action-nonce-123',
    });
  });

  it("should throw error if no current session", () => {
    vi.doMock('../auth', () => ({
      getCurrentSession: () => null,
    }));

    expect(() => {
      createSessionAction('write', 'element-123', {});
    }).toThrow('No active session for creating actions');
  });
});

