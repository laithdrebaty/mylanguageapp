/**
 * Outbound email.
 *
 * No provider is configured yet and which one to use is not decided, so this
 * follows the same shape as `services/storage.ts` and `services/ai.ts`: a thin
 * interface with a degraded implementation, rather than a hard dependency that
 * stops the server from starting.
 *
 * Unconfigured, a message is written to the log instead of being sent. That
 * keeps the password-reset flow fully testable in development — the link is in
 * the API output — without pretending mail was delivered.
 *
 * To add a real provider later, implement `MailProvider` and return it from
 * `createMailer()`. Nothing above this file changes.
 */

import { logger } from "../lib/logger";

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. Deliberately not HTML: these are short transactional notes. */
  text: string;
}

export interface MailProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/**
 * Writes the message to the log at info level.
 *
 * `configured` is false so callers can tell the difference between "sent" and
 * "logged" — the reset endpoint uses it to decide whether returning the link in
 * the response is acceptable.
 */
class LoggingMailProvider implements MailProvider {
  readonly name = "log";
  readonly configured = false;

  async send(message: MailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "Email not sent — no mail provider configured. Message written to the log instead.",
    );
  }
}

function createMailer(): MailProvider {
  // When a provider is chosen, construct it here from its environment
  // variables and fall through to the logger when they are absent.
  return new LoggingMailProvider();
}

export const mailer: MailProvider = createMailer();
