// ABOUTME: Thin wrapper around the Resend SDK for adding subscribers and sending welcome emails.
// ABOUTME: Surfaces a minimal interface so the route handler can be tested with a mock.

import { Resend } from 'resend';
import { renderWelcomeEmail, WELCOME_EMAIL_SUBJECT, WELCOME_EMAIL_TEXT } from '../emails/WelcomeEmail';

export type SignupSource = 'website' | 'extension-setup';

export interface ResendClientConfig {
  apiKey: string;
  // Optional: if provided, new contacts are assigned to this segment.
  // Resend's Audiences API was deprecated in favor of Segments — contacts
  // can exist without one and segment assignment is purely for organization.
  segmentId?: string;
}

export interface ResendClient {
  addContact(email: string, source: SignupSource): Promise<{ created: boolean }>;
  sendWelcomeEmail(email: string): Promise<void>;
}

const FROM_ADDRESS = 'spencer <hi@spencer.place>';

function isNotFoundError(error: { name?: string; message?: string }): boolean {
  // Resend returns name 'not_found' when a contact lookup misses.
  // We deliberately don't fall back to message matching — a generic "not
  // found" string from a different error (audience/segment) shouldn't be
  // treated as "this contact is new".
  return error.name === 'not_found';
}

function isDuplicateContactError(error: { name?: string; message?: string }): boolean {
  // Defensive: if Resend ever changes contacts.create from silent-upsert
  // back to surfacing a duplicate-key error, treat it as "already subscribed"
  // rather than failing the request. This races against contacts.get when
  // two requests for the same email arrive within ms of each other.
  return /already.*exist/i.test(error.message || '');
}

export function createResendClient(config: ResendClientConfig): ResendClient {
  const resend = new Resend(config.apiKey);

  return {
    async addContact(email, source) {
      // Check if the contact already exists. We do this explicitly rather than
      // relying on contacts.create to surface a duplicate error, because v6 of
      // the SDK silently upserts in some configurations.
      const { data: existing, error: getError } = await resend.contacts.get({
        email,
      });

      if (existing) {
        return { created: false };
      }
      if (getError && !isNotFoundError(getError)) {
        throw new Error(getError.message);
      }

      const { error: createError } = await resend.contacts.create({
        email,
        unsubscribed: false,
        // Tag contact source via firstName so it shows up in the dashboard
        // without needing custom contact properties (which are a paid feature
        // on Resend). TODO: swap to proper metadata/tags once available on
        // the free tier — note that this means dashboard 'first name' shows
        // 'website' or 'extension-setup', not a real name.
        firstName: source,
        ...(config.segmentId
          ? { segments: [{ id: config.segmentId }] }
          : {}),
      });

      if (createError) {
        // Race-condition guard: if a duplicate slipped through between
        // .get and .create, treat it as already-subscribed.
        if (isDuplicateContactError(createError)) {
          return { created: false };
        }
        throw new Error(createError.message);
      }

      return { created: true };
    },

    async sendWelcomeEmail(email) {
      const html = await renderWelcomeEmail();
      const { error } = await resend.emails.send(
        {
          from: FROM_ADDRESS,
          to: email,
          replyTo: 'hi@spencer.place',
          subject: WELCOME_EMAIL_SUBJECT,
          html,
          text: WELCOME_EMAIL_TEXT,
        },
        // Idempotency key prevents duplicate sends if the worker retries
        // within Resend's 24h dedup window.
        { idempotencyKey: `welcome-email/${email}` },
      );

      if (error) {
        throw new Error(error.message);
      }
    },
  };
}
