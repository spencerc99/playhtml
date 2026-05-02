// ABOUTME: Thin wrapper around the Resend SDK for adding subscribers and sending welcome emails.
// ABOUTME: Surfaces a minimal interface so the route handler can be tested with a mock.

import { Resend } from 'resend';
import { renderWelcomeEmail, WELCOME_EMAIL_SUBJECT, WELCOME_EMAIL_TEXT } from '../emails/WelcomeEmail';

export type SignupSource = 'website' | 'extension-setup';

export interface ResendClientConfig {
  apiKey: string;
  audienceId: string;
}

export interface ResendClient {
  addContact(email: string, source: SignupSource): Promise<{ created: boolean }>;
  sendWelcomeEmail(email: string): Promise<void>;
}

const FROM_ADDRESS = 'spencer <hi@spencer.place>';

function isAlreadyExistsError(message: string): boolean {
  // Resend returns a 400 validation error with a message containing
  // "already exists" when a contact is already in the audience.
  return /already.*exists/i.test(message);
}

export function createResendClient(config: ResendClientConfig): ResendClient {
  const resend = new Resend(config.apiKey);

  return {
    async addContact(email, source) {
      const { data, error } = await resend.contacts.create({
        audienceId: config.audienceId,
        email,
        unsubscribed: false,
        // Resend's TS types don't expose arbitrary metadata, but it accepts
        // firstName which renders cleanly in the dashboard. Use it as a tag
        // for source so future broadcasts can segment if we want.
        firstName: source === 'extension-setup' ? 'extension-setup' : 'website',
      });

      if (error) {
        if (isAlreadyExistsError(error.message)) {
          return { created: false };
        }
        throw new Error(error.message);
      }

      return { created: !!data };
    },

    async sendWelcomeEmail(email) {
      const html = await renderWelcomeEmail();
      const { error } = await resend.emails.send({
        from: FROM_ADDRESS,
        to: email,
        subject: WELCOME_EMAIL_SUBJECT,
        html,
        text: WELCOME_EMAIL_TEXT,
      });

      if (error) {
        throw new Error(error.message);
      }
    },
  };
}
