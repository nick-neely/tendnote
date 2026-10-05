import "server-only";

import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import type { DeletionNoticeKind, DeletionNoticeStage } from "@tendnote/domain";
import { selectTransactionalSender } from "@/lib/email/select-sender";
import { renderDeletionNoticeEmail } from "@/lib/email/templates/deletion-notice";
import { requireSupportEmail } from "@/lib/email/transactional";
import { LAPSED_PATH, RESTRICTED_PATH } from "./access-state";

/**
 * One notice before a retention deadline (#621). It links to the area the
 * account signs in to: resubscribe and export for a Lapsed Account, export only
 * for a Terminated one. Keyed on the account, the deadline, and the stage, so a
 * repeat of one notice collapses into one message and a later deadline after
 * resubscribing gets a sequence of its own.
 */
export async function sendDeletionNoticeEmail(input: {
  to: string;
  userId: string;
  kind: DeletionNoticeKind;
  stage: DeletionNoticeStage;
  retentionDeadline: Date;
}): Promise<void> {
  const path = input.kind === "lapsed" ? LAPSED_PATH : RESTRICTED_PATH;
  const content = await renderDeletionNoticeEmail({
    notice: input.stage,
    kind: input.kind,
    deletionDate: input.retentionDeadline,
    actionUrl: new URL(path, resolveBetterAuthBaseUrl()).toString(),
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: input.to,
    idempotencyKey: `deletion-notice:${input.userId}:${input.retentionDeadline.getTime()}:${input.stage}`,
  });
}

/** The confirmation once a retention-deadline purge has deleted the account, keyed on its intent. */
export async function sendPurgeConfirmationEmail(input: {
  to: string;
  userId: string;
  requestedAt: Date;
}): Promise<void> {
  const content = await renderDeletionNoticeEmail({
    notice: "deleted",
    supportEmail: requireSupportEmail(),
  });

  await selectTransactionalSender()({
    ...content,
    to: input.to,
    idempotencyKey: `deletion-confirmation:${input.userId}:${input.requestedAt.getTime()}`,
  });
}
