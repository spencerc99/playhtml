// Test the msgpack encoding/decoding for cursor messages
import { describe, it, expect } from 'vitest';
import { encodeCursorClientMessage, decodeCursorPartyMessage } from './cursor-encoding';
import type { CursorClientMessage } from '@playhtml/common';

describe('Cursor Message Encoding', () => {
  it('should encode and decode cursor update messages', () => {
    const cursorUpdate = {
      type: 'cursor-update' as const,
      presence: {
        cursor: { x: 100, y: 200, pointer: 'mouse' as const },
        playerIdentity: {
          publicKey: 'test-key-123',
          name: 'TestPlayer',
          playerStyle: {
            colorPalette: ['#ff0000', '#00ff00']
          }
        },
        lastSeen: 1234567890,
        message: 'Hello world'
      }
    };

    // Encode to msgpack
    const encoded = encodeCursorClientMessage(cursorUpdate);
    expect(encoded).toBeInstanceOf(Uint8Array);

    // Decode back from msgpack
    const decoded = decodeCursorPartyMessage(encoded);
    expect(decoded).toEqual(cursorUpdate);
  });

  it('should handle cursor sync messages', () => {
    const cursorSync = {
      type: 'cursor-sync' as const,
      users: {
        'user1': {
          presence: {
            cursor: { x: 300, y: 400, pointer: 'touch' as const },
            playerIdentity: {
              publicKey: 'user1-key',
              playerStyle: { colorPalette: ['#123456'] }
            }
          },
          metadata: {
            country: 'US',
            connectionId: 'conn1'
          }
        }
      }
    };

    // Since this is a server->client message, we test JSON fallback
    const jsonString = JSON.stringify(cursorSync);
    const decoded = decodeCursorPartyMessage(jsonString);
    expect(decoded).toEqual(cursorSync);
  });

  it('should handle request sync messages', () => {
    const requestSync: CursorClientMessage = {
      type: 'cursor-request-sync' as const
    };

    const encoded = encodeCursorClientMessage(requestSync);
    expect(encoded).toBeInstanceOf(Uint8Array);

    // Verify it can be decoded (server would use different decoder)
    const decoded = decodeCursorPartyMessage(encoded);
    expect(decoded).toEqual(requestSync);
  });
});