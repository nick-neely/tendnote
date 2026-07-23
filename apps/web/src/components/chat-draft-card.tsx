"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { editDraftBodyAction, getDraftViewAction } from "@/app/actions/drafts";
import { ResultCard } from "@/components/assistant-result-card";
import { DraftBody } from "@/components/draft-body";
import { DraftEditor } from "@/components/draft-editor";
import { DraftGroundingPopover } from "@/components/draft-grounding-popover";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, PenLineIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { copyDraftToClipboard } from "@/lib/draft-markdown";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";

type DraftView = Extract<AssistantToolView, { kind: "message_draft" }>;

/**
 * Interactive in-chat draft card (PRD #75). The draft tool persists the record and
 * snapshots its body into the chat transcript; this card lets the user edit that
 * draft inline with the shared WYSIWYG editor and copy it to send themselves —
 * without leaving the conversation or claiming anything was sent. The grounding and
 * privacy note are tucked behind a quiet info popover so the draft itself leads.
 * The fuller lifecycle (approve, regenerate, dismiss, mark sent) stays on the
 * person ledger, which this links to. Routed from the assistant panel rather than
 * the presentational tool-result module so its server actions stay out of that
 * module's render tests.
 */
export function ChatDraftCard({ view, isNew = false }: { view: DraftView; isNew?: boolean }) {
  const [body, setBody] = useState(view.body);
  const [grounding, setGrounding] = useState(view.grounding);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const personHref = view.personId ? `/people/${view.personId}#message-drafts` : null;

  // Hydrate from the authoritative record (ADR-0028): the transcript replays the
  // body as first generated, so on a later visit reconcile with the live draft —
  // reflecting an inline edit or a change made on the person page. Skipped while
  // editing so it never clobbers in-progress text.
  useEffect(() => {
    let active = true;
    if (isEditing) {
      return;
    }
    getDraftViewAction({ draftId: view.draftId })
      .then((live) => {
        if (active && live) {
          setBody(live.body);
          setGrounding(live.grounding.map((item) => ({ trust: item.trust, label: item.label })));
        }
      })
      .catch(() => {
        // A failed reconcile just leaves the snapshot in place; nothing to surface.
      });
    return () => {
      active = false;
    };
    // Re-reconcile only on draft identity, not on local edits.
  }, [view.draftId, isEditing]);

  async function handleCopy() {
    setError(null);
    try {
      await copyDraftToClipboard(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to your clipboard.");
    }
  }

  function handleSave(nextBody: string) {
    setError(null);
    if (!nextBody || nextBody === body) {
      setIsEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        const updated = await editDraftBodyAction({ draftId: view.draftId, body: nextBody });
        setBody(updated.body);
        setIsEditing(false);
      } catch {
        setError("That edit didn't save. Try again.");
      }
    });
  }

  return (
    <ResultCard
      footer={
        isEditing ? undefined : (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <DraftGroundingPopover grounding={grounding} />
            <div className="flex items-center gap-1">
              <Button onClick={handleCopy} size="sm" type="button" variant="ghost">
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => setIsEditing(true)} size="sm" type="button" variant="ghost">
                <PenLineIcon />
                Edit
              </Button>
              {personHref ? (
                <Link
                  className="inline-flex items-center gap-0.5 px-1 text-[length:var(--text-caption)] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  href={personHref}
                >
                  Open
                  <ArrowUpRightIcon aria-hidden className="size-3" />
                </Link>
              ) : null}
            </div>
          </div>
        )
      }
      icon={<PenLineIcon className="size-3" />}
      isNew={isNew}
      kind="message_draft"
      label="Drafted a message"
      tone="neutral"
    >
      {isEditing ? (
        <DraftEditor
          markdown={body}
          onCancel={() => {
            setError(null);
            setIsEditing(false);
          }}
          onSave={handleSave}
          saving={pending}
        />
      ) : (
        <DraftBody markdown={body} />
      )}

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </ResultCard>
  );
}
