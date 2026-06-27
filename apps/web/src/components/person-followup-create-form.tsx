import { PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { createFollowupAction } from "@/app/actions/followups";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FollowupView } from "@/lib/followup-view";

/**
 * Collapsed "New follow-up" affordance that expands into an inline create form,
 * so adding a reminder stays on the person's ledger without a modal. On success
 * the new reminder is handed to the parent to join the active list.
 */
export function CreateFollowupForm({
  personId,
  firstName,
  defaultDueDate,
  onCreate,
}: {
  personId: string;
  firstName: string;
  defaultDueDate: string;
  onCreate: (view: FollowupView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedReason = reason.trim();

  function reset() {
    setReason("");
    setDueDate(defaultDueDate);
    setError(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        className="self-start"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PlusIcon />
        New follow-up
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2.5 rounded-xl border border-dashed bg-surface px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmedReason || !dueDate) {
          return;
        }
        setError(null);
        startTransition(async () => {
          try {
            const created = await createFollowupAction({
              personId,
              reason: trimmedReason,
              dueAt: dueDate,
            });
            onCreate(created);
            reset();
          } catch {
            setError(GENERIC_ERROR);
          }
        });
      }}
    >
      <Input
        aria-label={`Why follow up with ${firstName}?`}
        autoFocus
        onChange={(event) => setReason(event.target.value)}
        placeholder={`Why follow up with ${firstName}?`}
        value={reason}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          aria-label="Due date"
          className="w-44"
          onChange={(event) => setDueDate(event.target.value)}
          type="date"
          value={dueDate}
        />
        <div className="flex items-center gap-1.5">
          <Button onClick={reset} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={pending || !trimmedReason || !dueDate} size="sm" type="submit">
            Add follow-up
          </Button>
        </div>
      </div>
      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
