"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { hardDeleteAssetAction } from "@/app/actions/assets";
import { ErrorText, GENERIC_ERROR } from "@/components/general-action-shared";
import { Trash2Icon } from "@/components/icons";
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

export type AssetRemovalSummary = {
  memories: number;
  evidence: number;
  reviewItems: number;
  linkedRecords: number;
};

const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

/** Human-only correction/privacy escape hatch. Archive remains normal cleanup. */
export function AssetRemove({
  assetId,
  assetName,
  summary,
}: {
  assetId: string;
  assetName: string;
  summary: AssetRemovalSummary;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hasSavedContext = summary.memories + summary.evidence + summary.reviewItems > 0;
  const canDelete = !pending && (!hasSavedContext || confirmPhraseMatches(typed, phrase));

  function changeOpen(next: boolean) {
    if (pending) return;
    setOpen(next);
    setError(null);
    if (next) {
      setPhrase(generateConfirmPhrase());
      setTyped("");
    }
  }

  function remove() {
    if (!canDelete) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await hardDeleteAssetAction({ assetId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push("/assets");
        router.refresh();
      } catch {
        setError(GENERIC_ERROR);
      }
    });
  }

  return (
    <section className="border-t pt-4" aria-label="Privacy and correction">
      <AlertDialog onOpenChange={changeOpen} open={open}>
        <AlertDialogTrigger asChild>
          <Button
            className="text-muted-foreground hover:text-destructive"
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
            Delete asset permanently
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {assetName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This is for a mistaken record or a privacy request. Archiving is safer for normal
              cleanup. Permanent deletion cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded-lg bg-surface px-4 py-3 text-sm">
            <p className="font-medium text-foreground">Tendnote will permanently delete:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>{countLabel(summary.memories, "memory", "memories")}</li>
              <li>{countLabel(summary.evidence, "evidence item")}</li>
              <li>{countLabel(summary.reviewItems, "review item")}</li>
              <li>its generated summary and history</li>
            </ul>
            {summary.linkedRecords > 0 ? (
              <p className="mt-3 text-muted-foreground">
                {countLabel(summary.linkedRecords, "link")} will be removed. Linked actions, people,
                and other assets stay intact.
              </p>
            ) : null}
          </div>

          {hasSavedContext ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-foreground" htmlFor="asset-delete-confirm">
                Type{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                  {phrase}
                </code>{" "}
                to confirm
              </label>
              <Input
                autoComplete="off"
                autoFocus
                disabled={pending}
                id="asset-delete-confirm"
                onChange={(event) => setTyped(event.target.value)}
                onDrop={(event) => event.preventDefault()}
                onPaste={(event) => event.preventDefault()}
                spellCheck={false}
                value={typed}
              />
            </div>
          ) : null}

          {error ? <ErrorText message={error} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canDelete}
              onClick={(event) => {
                event.preventDefault();
                remove();
              }}
              variant="destructive"
            >
              {pending ? "Deleting…" : "Delete asset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
