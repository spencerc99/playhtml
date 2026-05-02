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

    const client = createResendClient({ apiKey: 'k' });
    const result = await client.addContact('a@b.com', 'website');

    expect(result).toEqual({ created: true });
    expect(mockContactsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        unsubscribed: false,
        firstName: 'website',
      }),
    );
    // No audienceId/segmentId by default
    const call = mockContactsCreate.mock.calls[0][0];
    expect(call.audienceId).toBeUndefined();
    expect(call.segments).toBeUndefined();
  });

  it('addContact passes segmentId via segments array when configured', async () => {
    mockContactsCreate.mockResolvedValueOnce({
      data: { id: 'contact_123', email: 'a@b.com' },
      error: null,
    });

    const client = createResendClient({ apiKey: 'k', segmentId: 'seg_xyz' });
    await client.addContact('a@b.com', 'extension-setup');

    expect(mockContactsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        firstName: 'extension-setup',
        segments: [{ id: 'seg_xyz' }],
      }),
    );
  });

  it('addContact returns { created: false } when contact already exists', async () => {
    mockContactsCreate.mockResolvedValueOnce({
      data: null,
      error: { name: 'validation_error', message: 'Contact already exists' },
    });

    const client = createResendClient({ apiKey: 'k' });
    const result = await client.addContact('a@b.com', 'website');

    expect(result).toEqual({ created: false });
  });

  it('addContact throws on unexpected errors', async () => {
    mockContactsCreate.mockResolvedValueOnce({
      data: null,
      error: { name: 'internal_server_error', message: 'boom' },
    });

    const client = createResendClient({ apiKey: 'k' });
    await expect(client.addContact('a@b.com', 'website')).rejects.toThrow('boom');
  });

  it('sendWelcomeEmail calls emails.send with from, to, subject, html, text + idempotency key', async () => {
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'em_1' }, error: null });

    const client = createResendClient({ apiKey: 'k' });
    await client.sendWelcomeEmail('a@b.com');

    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    const [params, opts] = mockEmailsSend.mock.calls[0];
    expect(params.from).toBe('spencer <hi@spencer.place>');
    expect(params.to).toBe('a@b.com');
    expect(params.replyTo).toBe('hi@spencer.place');
    expect(typeof params.subject).toBe('string');
    expect(params.subject.length).toBeGreaterThan(0);
    expect(typeof params.html).toBe('string');
    expect(params.html).toContain('we were online');
    expect(typeof params.text).toBe('string');
    expect(params.text.length).toBeGreaterThan(0);
    expect(opts.idempotencyKey).toBe('welcome-email/a@b.com');
  });

  it('sendWelcomeEmail throws when emails.send returns error', async () => {
    mockEmailsSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'application_error', message: 'service down' },
    });

    const client = createResendClient({ apiKey: 'k' });
    await expect(client.sendWelcomeEmail('a@b.com')).rejects.toThrow('service down');
  });
});
