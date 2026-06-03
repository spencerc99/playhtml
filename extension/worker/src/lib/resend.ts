// ABOUTME: Thin wrapper around the Resend SDK for adding subscribers and sending signup emails.
// ABOUTME: Surfaces a minimal interface so the route handler can be tested with a mock.

import { Resend } from 'resend';
import {
  renderUpdatesEmail,
  renderWelcomeEmail,
  UPDATES_EMAIL_SUBJECT,
  UPDATES_EMAIL_TEXT,
  WELCOME_EMAIL_SUBJECT,
  WELCOME_EMAIL_TEXT,
} from '../emails/WelcomeEmail';

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
  sendUpdatesEmail(email: string): Promise<void>;
}

const FROM_ADDRESS = 'spencer <hi@spencer.place>';
const REPLY_TO_ADDRESS = 'hi@spencer.place';

interface SendEmailOptions {
  email: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

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

async function sendEmail(
  resend: Resend,
  { email, subject, html, text, idempotencyKey }: SendEmailOptions,
): Promise<void> {
  const { error } = await resend.emails.send(
    {
      from: FROM_ADDRESS,
      to: email,
      replyTo: REPLY_TO_ADDRESS,
      subject,
      html,
      text,
    },
    // Idempotency key prevents duplicate sends if the worker retries
    // within Resend's 24h dedup window.
    { idempotencyKey },
  );

  if (error) {
    throw new Error(error.message);
  }
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

      // We accept `source` from callers but don't pass it to Resend — custom
      // contact properties are a paid feature, and using firstName as a tag
      // pollutes the dashboard. If we ever need to segment by signup source,
      // do it via a proper Resend Segment.
      void source;

      const { error: createError } = await resend.contacts.create({
        email,
        unsubscribed: false,
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
      await sendEmail(resend, {
        email,
        subject: WELCOME_EMAIL_SUBJECT,
        html,
        text: WELCOME_EMAIL_TEXT,
        idempotencyKey: `welcome-email/${email}`,
      });
    },

    async sendUpdatesEmail(email) {
      const html = await renderUpdatesEmail();
      await sendEmail(resend, {
        email,
        subject: UPDATES_EMAIL_SUBJECT,
        html,
        text: UPDATES_EMAIL_TEXT,
        idempotencyKey: `updates-email/${email}`,
      });
    },
  };
}
