import type { DeletionNoticeKind, DeletionNoticeStage } from "@tendnote/domain";
import { RETENTION } from "@tendnote/domain/retention";
import { formatBillingDate } from "@/lib/billing/billing-date";
import type { TransactionalEmailContent } from "../transactional";
import { NotebookEmail, type NotebookEmailCopy, renderNotebookEmail } from "./account-email";

/**
 * The deletion-notice sequence (#621): the notices on days 0, 60, and 83 before
 * a retention deadline, and the confirmation after the purge. A Lapsed Account
 * can resubscribe; a Terminated one can only export, so its notices never offer
 * a subscription.
 */
export type DeletionNoticeEmailProps =
  | {
      notice: DeletionNoticeStage;
      kind: DeletionNoticeKind;
      deletionDate: Date;
      actionUrl: string;
      supportEmail: string;
    }
  | { notice: "deleted"; supportEmail: string };

/**
 * Content-free like every account email: the deletion date is the only fact
 * about the account, and it is the one the reader needs. No name, no record,
 * no plan, no amount. Each later notice names the date rather than counting
 * down, so a notice a delayed sweep sends late is still true.
 */
function noticeCopy(
  notice: DeletionNoticeStage,
  kind: DeletionNoticeKind,
  deletionDate: Date,
): NotebookEmailCopy {
  const date = formatBillingDate(deletionDate);
  const lapsed = kind === "lapsed";
  const offer = lapsed
    ? "Resubscribe before then and everything is where you left it, or export a copy to keep."
    : "Until then you can export a copy, or delete your account yourself.";
  const action = {
    action: lapsed ? "Resubscribe or export" : "Export your data",
    fallback: "Open Tendnote in your browser",
  };
  const reason = lapsed
    ? "The Tendnote subscription for this email address has ended. We send three notices before its data is deleted, so the deletion is never a surprise."
    : "Access to Tendnote for this email address has ended. We send three notices before its data is deleted, so the deletion is never a surprise.";

  if (notice === "day_0") {
    return {
      subject: lapsed
        ? "Your Tendnote subscription has ended"
        : "Your access to Tendnote has ended",
      preview: `Your data is kept until ${date}, then deleted.`,
      heading: lapsed ? "Your subscription has ended" : "Your access to Tendnote has ended",
      body: lapsed
        ? `Your data is kept until ${date}, then deleted. ${offer}`
        : `Your data is kept until ${date}, then deleted. ${offer}`,
      ...action,
      reason,
    };
  }

  const finalNotice = notice === "day_83";
  return {
    subject: `Your Tendnote data will be deleted on ${date}`,
    preview: finalNotice
      ? "This is the last notice before it’s deleted."
      : lapsed
        ? "Resubscribe or export a copy before then."
        : "Export a copy before then.",
    // The heading stays short; the date leads the body, where it never wraps
    // mid-phrase.
    heading: finalNotice
      ? "Last notice before your data is deleted"
      : "A reminder before your data is deleted",
    body: `Your Tendnote data will be deleted on ${date}. ${offer}`,
    ...action,
    reason,
  };
}

const DELETED_COPY: NotebookEmailCopy = {
  subject: "Your Tendnote account has been deleted",
  preview: "Your account and its data are gone.",
  heading: "Your account has been deleted",
  body: `Your Tendnote account and its data have been deleted, as scheduled. Any remaining backup copies expire within ${RETENTION.backupWindow.days} days, and restoring a backup never brings the account back.`,
  reason:
    "We told this email address its Tendnote data would be deleted on a date that has now passed. This is the last email we’ll send to this address.",
};

function emailProps(props: DeletionNoticeEmailProps) {
  if (props.notice === "deleted") {
    return { copy: DELETED_COPY, supportEmail: props.supportEmail };
  }
  return {
    copy: noticeCopy(props.notice, props.kind, props.deletionDate),
    actionUrl: props.actionUrl,
    supportEmail: props.supportEmail,
  };
}

/** Renders one notice in the sequence as both bodies. */
export function renderDeletionNoticeEmail(
  props: DeletionNoticeEmailProps,
): Promise<TransactionalEmailContent> {
  return renderNotebookEmail(emailProps(props));
}

/** React Email preview entry point; not used by the transport. */
export default function DeletionNoticePreview() {
  return (
    <NotebookEmail
      {...emailProps({
        notice: "day_0",
        kind: "lapsed",
        deletionDate: new Date("2027-01-02T12:00:00.000Z"),
        actionUrl: "http://localhost:3000/lapsed",
        supportEmail: "support@example.test",
      })}
    />
  );
}
