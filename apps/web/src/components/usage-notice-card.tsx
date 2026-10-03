import type { UsageNotice } from "@tendnote/domain/usage-bounds";
import { backgroundUsageNoticeText } from "@/lib/assistant/usage-notice";

/**
 * A usage notice: a plain fact rather than an error, in a quiet dashed card,
 * with the one recovery condition in its detail.
 */
export function UsageNoticeCard({ headline, detail }: { headline: string; detail: string }) {
  return (
    <div
      className="rounded-xl border border-border border-dashed p-4 text-[length:var(--text-small)] leading-[var(--text-small-line)]"
      role="status"
    >
      <p className="font-medium text-foreground">{headline}</p>
      <p className="text-muted-foreground">{detail}</p>
    </div>
  );
}

/**
 * Background work's notice on Home while it is paused at the account's
 * background Account Ceiling, and nothing otherwise. It explains the brief that
 * did not arrive and the capture still waiting to be processed.
 */
export function BackgroundUsageNotice({ notice }: { notice?: UsageNotice }) {
  if (!notice || notice.state === "normal") return null;
  return <UsageNoticeCard {...backgroundUsageNoticeText(notice)} />;
}
