// ABOUTME: Tests for the Resend client wrapper.
// ABOUTME: Verifies addContact handles new vs existing contact responses correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContactsGet = vi.fn();
const mockContactsCreate = vi.fn();
const mockEmailsSend = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    contacts: { get: mockContactsGet, create: mockContactsCreate },
    emails: { send: mockEmailsSend },
  })),
}));

import { createResendClient } from '../lib/resend';

describe('createResendClient', () => {
  beforeEach(() => {
    mockContactsGet.mockReset();
    mockContactsCreate.mockReset();
    mockEmailsSend.mockReset();
  });

  it('addContact returns { created: true } when contact does not exist yet', async () => {
    mockContactsGet.mockResolvedValueOnce({
      data: null,
      error: { name: 'not_found', message: 'Contact not found' },
    });
    mockContactsCreate.mockResolvedValueOnce({
      data: { id: 'contact_123', email: 'a@b.com' },
      error: null,
    });

    const client = createResendClient({ apiKey: 'k' });
    const result = await client.addContact('a@b.com', 'website');

    expect(result).toEqual({ created: true });
    expect(mockContactsGet).toHaveBeenCalledWith({ email: 'a@b.com' });
    expect(mockContactsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        unsubscribed: false,
        firstName: 'website',
      }),
    );
    const createCall = mockContactsCreate.mock.calls[0][0];
    expect(createCall.segments).toBeUndefined();
  });

  it('addContact passes segmentId via segments array when configured', async () => {
    mockContactsGet.mockResolvedValueOnce({
      data: null,
      error: { name: 'not_found', message: 'Contact not found' },
    });
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
    mockContactsGet.mockResolvedValueOnce({
      data: { id: 'contact_existing', email: 'a@b.com' },
      error: null,
    });

    const client = createResendClient({ apiKey: 'k' });
    const result = await client.addContact('a@b.com', 'website');

    expect(result).toEqual({ created: false });
    // Critically: we did NOT call create when the contact already exists.
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });

  it('addContact throws when contacts.get fails with a non-not-found error', async () => {
    mockContactsGet.mockResolvedValueOnce({
      data: null,
      error: { name: 'internal_server_error', message: 'boom' },
    });

    const client = createResendClient({ apiKey: 'k' });
    await expect(client.addContact('a@b.com', 'website')).rejects.toThrow('boom');
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });

  it('addContact throws when contacts.create fails', async () => {
    mockContactsGet.mockResolvedValueOnce({
      data: null,
      error: { name: 'not_found', message: 'Contact not found' },
    });
    mockContactsCreate.mockResolvedValueOnce({
      data: null,
      error: { name: 'internal_server_error', message: 'create failed' },
    });

    const client = createResendClient({ apiKey: 'k' });
    await expect(client.addContact('a@b.com', 'website')).rejects.toThrow('create failed');
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
