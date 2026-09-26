import "server-only";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { selectTransactionalSender } from "@/lib/email/select-sender";
import { type AccountEmailPurpose, renderAccountEmail } from "@/lib/email/templates/account-email";
import { requireSupportEmail } from "@/lib/email/transactional";

export type AccountEmail = {
  purpose: AccountEmailPurpose;
  to: string;
  /** Better Auth's link, already built from the configured base URL. */
  url: string;
  /** The single-use token inside `url`. Only its hash leaves this module. */
  token: string;
};

/**
 * Renders and sends one verification or password-reset email through the
 * transactional email module, on whichever transport this deployment gets.
 */
export async function sendAccountEmail(email: AccountEmail): Promise<void> {
  const content = await renderAccountEmail({
    purpose: email.purpose,
    actionUrl: email.url,
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: email.to,
    // One token is one message. The key reaches the provider, so it carries a
    // hash of the token rather than the working credential itself.
    idempotencyKey: `${email.purpose}:${createHash("sha256").update(email.token).digest("hex")}`,
  });
}

/**
 * Sends after the response, as Better Auth asks: an awaited send would make
 * the response time reveal whether an address has an account. A failure is
 * logged by its class only, never with the link or the address.
 */
function sendAccountEmailAfterResponse(email: AccountEmail): void {
  after(async () => {
    try {
      await sendAccountEmail(email);
    } catch (error) {
      console.error(
        `[tendnote] Account email (${email.purpose}) was not sent: ${error instanceof Error ? error.name : "UnknownError"}`,
      );
    }
  });
}

type BetterAuthEmailHookInput = { user: { email: string }; url: string; token: string };

/** Better Auth's two email hooks, each bound to its own purpose. */
export const accountEmailHooks = {
  sendResetPassword: async ({ user, url, token }: BetterAuthEmailHookInput) => {
    sendAccountEmailAfterResponse({ purpose: "reset-password", to: user.email, url, token });
  },
  sendVerificationEmail: async ({ user, url, token }: BetterAuthEmailHookInput) => {
    sendAccountEmailAfterResponse({ purpose: "verify-email", to: user.email, url, token });
  },
};
