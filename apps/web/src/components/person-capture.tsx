"use client";

import { CheckIcon, LockIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { captureGlobalAssistantSourceRecord } from "@/app/actions/source-records";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * Person-scoped capture: the assistant's job on a profile is to take a quick note,
 * not to hold a conversation — so here it's a focused composer, not a shrunken
 * chat. Saved notes flow into Logged context below; `router.refresh()` re-reads
 * the server-rendered ledger so the new note appears in place.
 */
export function PersonCapture({
  personId,
  personName,
  firstName,
}: {
  personId: string;
  personName: string;
  firstName: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    const text = value.trim();

    if (!text || pending) {
      return;
    }

    setError(null);
    setSaved(false);

    startTransition(async () => {
      try {
        await captureGlobalAssistantSourceRecord({ retainedContent: text, personId });
        setValue("");
        setSaved(true);
        router.refresh();
        window.setTimeout(() => setSaved(false), 4000);
      } catch {
        setError("That didn't save. Try again.");
      }
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Add a note</h2>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-[length:var(--text-caption)] text-muted-foreground">
          <LockIcon aria-hidden className="size-3" />
          Private
        </span>
      </div>

      <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
        Jot something about {firstName}. Saved privately, and reviewed before it becomes a memory.
      </p>

      <Textarea
        aria-label={`Add a note about ${personName}`}
        className="min-h-24 resize-none bg-card"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Note something about ${personName}…`}
        value={value}
      />

      <div className="flex items-center justify-between gap-3">
        <span
          aria-live="polite"
          className="text-[length:var(--text-caption)] text-muted-foreground"
        >
          {saved ? (
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <CheckIcon aria-hidden className="size-3.5 text-primary" />
              Saved to logged context
            </span>
          ) : (
            "Enter to save · Shift + Enter for a new line"
          )}
        </span>
        <Button disabled={pending || value.trim().length === 0} onClick={save} size="sm">
          Save note
        </Button>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
