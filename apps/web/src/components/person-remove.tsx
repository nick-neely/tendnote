"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deletePersonAction } from "@/app/actions/people";
import { ErrorText, GENERIC_ERROR } from "@/components/person-followup-shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmPhraseMatches, generateConfirmPhrase } from "@/lib/confirm-phrase";

/** A single thing attached to the person, previewed so the user sees what they'd lose. */
export type RemovalItem = { id: string; text: string };

type RundownGroup = {
  key: string;
  singular: string;
  plural: string;
  items: RemovalItem[];
};

function buildRundown(groups: {
  memories: RemovalItem[];
  followups: RemovalItem[];
  drafts: RemovalItem[];
}): RundownGroup[] {
  return [
    { key: "memories", singular: "memory", plural: "memories", items: groups.memories },
    { key: "followups", singular: "follow-up", plural: "follow-ups", items: groups.followups },
    { key: "drafts", singular: "draft", plural: "drafts", items: groups.drafts },
  ].filter((group) => group.items.length > 0);
}

/**
 * The one place a person can be permanently removed: a quiet escape hatch at the foot
 * of the profile aside, for someone created by mistake. It is deliberately
 * low-emphasis and human-only — never an Eve tool — with the weight of the decision
 * carried by an explicit confirmation.
 *
 * The confirmation is proportional to what's at stake. It always names exactly what
 * will be deleted — a memory/follow-up/draft rundown that expands to preview each item,
 * so the user can see what they'd lose rather than trust a bare number (logged-context
 * notes survive a delete, so they aren't claimed here). When the person has any of that
 * saved, it also gates the delete behind retyping a short random phrase, so a profile
 * with real history can't be lost on a reflexive click. An empty, clearly-a-mistake
 * profile skips the phrase — the friction should match the loss.
 *
 * On success we navigate back to People, since the profile no longer exists.
 */
export function PersonRemove({
  personId,
  personName,
  memories,
  followups,
  drafts,
}: {
  personId: string;
  personName: string;
  memories: RemovalItem[];
  followups: RemovalItem[];
  drafts: RemovalItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const rundown = buildRundown({ memories, followups, drafts });
  const hasHistory = rundown.length > 0;
  const phraseConfirmed = confirmPhraseMatches(typed, phrase);
  const canRemove = !pending && (!hasHistory || phraseConfirmed);

  function handleOpenChange(next: boolean) {
    // Hold the dialog open while the delete is in flight so the pending state and any
    // error stay visible.
    if (pending) {
      return;
    }

    setOpen(next);

    if (next) {
      // A fresh phrase each open; the point is a deliberate read-and-type, so it must
      // not be a value the user could have memorized from a previous attempt.
      setPhrase(generateConfirmPhrase());
      setTyped("");
      setError(null);
    } else {
      setError(null);
    }
  }

  function confirmRemove() {
    if (!canRemove) {
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await deletePersonAction({ personId });
        // Leave the (now-deleted) profile for the People list, and refresh so any
        // cached view of this person elsewhere drops away.
        router.push("/people");
        router.refresh();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={open}>
      <AlertDialogTrigger asChild>
        <Button
          className="text-muted-foreground hover:text-destructive"
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2Icon />
          Remove person
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {personName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {hasHistory
              ? `Deleting ${personName} permanently removes everything saved about them. This can't be undone.`
              : `${personName} has nothing saved yet, so this only removes their profile. It can't be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasHistory ? (
          <div className="max-h-56 overflow-y-auto rounded-lg border bg-surface">
            <Accordion className="px-3.5" type="multiple">
              {rundown.map((group) => (
                <AccordionItem key={group.key} value={group.key}>
                  <AccordionTrigger className="text-sm hover:no-underline">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-5 font-medium tabular-nums">{group.items.length}</span>
                      <span>{group.items.length === 1 ? group.singular : group.plural}</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="flex flex-col divide-y border-t">
                      {group.items.map((item) => (
                        <li
                          className="line-clamp-2 py-2 text-pretty text-muted-foreground first:pt-2.5"
                          key={item.id}
                        >
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        ) : null}

        {hasHistory ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-foreground" htmlFor="person-remove-confirm">
              Type{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8125rem] font-medium text-foreground select-none">
                {phrase}
              </code>{" "}
              to confirm
            </label>
            <Input
              autoComplete="off"
              // Typing the phrase is the intended next action in this gated dialog.
              autoFocus
              disabled={pending}
              id="person-remove-confirm"
              onChange={(event) => setTyped(event.target.value)}
              // Retyping is the safeguard; pasting the on-screen phrase would defeat it.
              onDrop={(event) => event.preventDefault()}
              onPaste={(event) => event.preventDefault()}
              placeholder={phrase}
              spellCheck={false}
              value={typed}
            />
          </div>
        ) : null}

        {error ? <ErrorText message={error} /> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canRemove}
            onClick={(event) => {
              // Keep the dialog mounted so we can await the delete and only leave the
              // page on success; Radix would otherwise close it on click.
              event.preventDefault();
              confirmRemove();
            }}
            variant="destructive"
          >
            {pending ? "Removing…" : "Remove person"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
