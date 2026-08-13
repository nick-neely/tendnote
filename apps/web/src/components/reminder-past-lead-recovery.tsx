"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function pastReminderLeadTimeMessage(nextChoiceLabel: string) {
  return `That alert time has passed. No catch-up alert was sent. Save again to use ${nextChoiceLabel}.`;
}

export const pastExactReminderTimeMessage =
  "That alert time has passed. Choose a future due date or alert time.";

export function ReminderPastLeadRecovery({
  label,
  onRecover,
  pending,
}: {
  label: string;
  onRecover: () => Promise<void>;
  pending: boolean;
}) {
  return (
    <aside className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3.5">
      <p className="text-sm font-medium">{pastReminderLeadTimeMessage(label)}</p>
      <Button
        className="mt-2"
        disabled={pending}
        onClick={onRecover}
        size="sm"
        type="button"
        variant="outline"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Saving…" : `Use ${label}`}
      </Button>
    </aside>
  );
}
