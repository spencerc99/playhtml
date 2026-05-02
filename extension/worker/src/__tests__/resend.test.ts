// ABOUTME: Tests for the Resend client wrapper.
// ABOUTME: Verifies addContact handles new vs existing contact responses correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContactsCreate = vi.fn();
const mockEmailsSend = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    contacts: { create: mockContactsCreate },
    emails: { send: mockEmailsSend },
  })),
}));

import { createResendClient } from '../lib/resend';

describe('createResendClient', () => {
  beforeEach(() => {
    mockContactsCreate.mockReset();
    mockEmailsSend.mockReset();
  });

  it('addContact returns { created: true } when contact is new', async () => {
    mockContactsCreate.mockResolvedValueOnce({
      data: { id: 'contact_123', email: 'a@b.com' },
      error: null,
    });

    const client = createResendClient({ apiKey: 'k', audienceId: 'a' });
    const result = await client.addContact('a@b.com', 'website');

    expect(result).toEqual({ created: true });
    expect(mockContactsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        audienceId: 'a',
        email: 'a@b.com',
        unsubscribed: false,
      }),
    );
  });

  it('addContact returns { created: false } when contact already exists', async () => {
    mockContactsCreate.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'Contact already exists' },
    });

    const client = createResendClient({ apiKey: 'k', audienceId: 'a' });
    const result = await client.addContact('a@b.com', 'website');

    expect(result).toEqual({ created: false });
  });

  it('addContact throws on unexpected errors', async () => {
    mockContactsCreate.mockResolvedValueOnce({
      data: null,
      error: { name: 'internal_server_error', message: 'boom' },
    });

    const client = createResendClient({ apiKey: 'k', audienceId: 'a' });
    await expect(client.addContact('a@b.com', 'website')).rejects.toThrow('boom');
  });

  it('sendWelcomeEmail calls emails.send with from, to, subject, html, text', async () => {
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'em_1' }, error: null });

    const client = createResendClient({ apiKey: 'k', audienceId: 'a' });
    await client.sendWelcomeEmail('a@b.com');

    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    const call = mockEmailsSend.mock.calls[0][0];
    expect(call.from).toBe('spencer <hi@spencer.place>');
    expect(call.to).toBe('a@b.com');
    expect(typeof call.subject).toBe('string');
    expect(call.subject.length).toBeGreaterThan(0);
    expect(typeof call.html).toBe('string');
    expect(call.html).toContain('we were online');
    expect(typeof call.text).toBe('string');
    expect(call.text.length).toBeGreaterThan(0);
  });
});
