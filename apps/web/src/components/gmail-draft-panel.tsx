"use client";

import { type MessageDraftPurpose, suggestGmailSubject } from "@tendnote/domain";
import { CheckIcon, MailCheckIcon, MailIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import {
  createGmailDraftAction,
  type GmailDraftActionResult,
  retryGmailDraftAction,
} from "@/app/actions/gmail-drafts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DraftView } from "@/lib/draft-view";
import type { GmailDraftView } from "@/lib/gmail-draft-view";

const MANUAL = "manual" as const;

export type PersonEmailOption = { id: string; value: string; isPrimary: boolean };

/**
 * Gmail draft externalization for an approved Tendnote draft (Phase 2D, ADR-0083/
 * 0096). Shows inline Gmail state on the draft card — never a separate Gmail page —
 * and gates the write behind confirming a recipient and an approved subject. A
 * recipient is either a saved contact method or an explicitly entered address; a
 * manual address is action-specific and never saved as a contact method (ADR-0085).
 * Last-mile body edits persist through the Tendnote draft before the write (ADR-0086).
 * Failures show a visible retry — Tendnote never retries in the background (ADR-0091).
 */
export function GmailDraftPanel({
  draft,
  personName,
  personEmails,
  connected,
  initialView,
  onWrite,
}: {
  draft: DraftView;
  personName: string | null;
  personEmails: PersonEmailOption[];
  connected: boolean;
  initialView: GmailDraftView | null;
  /** Called after a successful/failed write so the surface can refresh counts. */
  onWrite?: () => void;
}) {
  const [view, setView] = useState<GmailDraftView | null>(initialView);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const primaryEmail = personEmails.find((option) => option.isPrimary) ?? personEmails[0] ?? null;
  const [recipientId, setRecipientId] = useState<string>(primaryEmail?.id ?? MANUAL);
  const [manualEmail, setManualEmail] = useState("");
  const [subject, setSubject] = useState(() =>
    suggestGmailSubject({ purpose: draft.purpose as MessageDraftPurpose, personName }),
  );
  const [body, setBody] = useState(draft.body);

  const subjectId = useId();
  const manualEmailId = useId();
  const bodyId = useId();

  function apply(result: GmailDraftActionResult) {
    if (result.status === "blocked") {
      setError(result.reason);
      return;
    }
    setView(result.view);
    setError(
      result.status === "failed" ? (result.view.error ?? "Gmail draft write failed.") : null,
    );
    if (result.status === "succeeded") {
      setOpen(false);
    }
    onWrite?.();
  }

  function handleCreate() {
    const recipient =
      recipientId === MANUAL
        ? { email: manualEmail.trim(), source: "manual_entry" as const, contactMethodId: null }
        : {
            email: personEmails.find((option) => option.id === recipientId)?.value ?? "",
            source: "contact_method" as const,
            contactMethodId: recipientId,
          };

    if (!recipient.email) {
      setError("Add a recipient email address first.");
      return;
    }
    if (!subject.trim()) {
      setError("Add a subject first.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        apply(
          await createGmailDraftAction({
            draftId: draft.id,
            subject: subject.trim(),
            recipient,
            // Persist a last-mile body edit through the Tendnote draft first.
            bodyEdit: body,
          }),
        );
      } catch {
        setError("Couldn't save this draft to Gmail. Try again.");
      }
    });
  }

  function handleRetry() {
    if (!view) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        apply(await retryGmailDraftAction({ draftId: draft.id, actionId: view.actionId }));
      } catch {
        setError("Couldn't retry the Gmail draft. Try again.");
      }
    });
  }

  // Success: the last known external state. Phase 2D shows only this — it does not
  // reconcile whether the user later edited or sent the draft in Gmail (ADR-0089).
  if (view?.status === "succeeded") {
    return (
      <div className="flex items-center gap-2 border-t pt-3 text-[length:var(--text-small)] text-muted-foreground">
        <MailCheckIcon aria-hidden className="size-4 shrink-0 text-primary" />
        <span>
          Saved as a Gmail draft to{" "}
          <span className="font-medium text-foreground">{view.recipientEmail}</span>. Send it
          yourself from Gmail.
        </span>
      </div>
    );
  }

  if (view?.status === "failed") {
    return (
      <div className="flex flex-col gap-2 border-t pt-3">
        {/* Operational failure uses the same destructive treatment as the draft
            card's other errors (person-drafts.tsx), paired with an icon so state is
            never conveyed by color alone. */}
        <p
          className="flex items-center gap-2 text-[length:var(--text-small)] text-destructive"
          role="alert"
        >
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
          Couldn&rsquo;t save this draft to Gmail.
        </p>
        <div className="flex justify-end">
          <Button
            disabled={pending}
            onClick={handleRetry}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCwIcon />
            {pending ? "Retrying…" : "Retry"}
          </Button>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <p className="border-t pt-3 text-[length:var(--text-small)] text-muted-foreground">
        <Link className="underline underline-offset-2" href="/account">
          Connect Gmail
        </Link>{" "}
        to save this approved draft as a Gmail draft.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="flex justify-end border-t pt-3">
        <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
          <MailIcon />
          Save to Gmail
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[length:var(--text-small)] font-medium text-muted-foreground">
          Recipient
        </legend>
        {personEmails.map((option) => (
          <label className="flex items-center gap-2 text-[length:var(--text-body)]" key={option.id}>
            <input
              checked={recipientId === option.id}
              className="size-4 shrink-0 [accent-color:var(--primary)]"
              name={`gmail-recipient-${draft.id}`}
              onChange={() => setRecipientId(option.id)}
              type="radio"
              value={option.id}
            />
            <span>{option.value}</span>
            {option.isPrimary ? (
              <span className="text-[length:var(--text-caption)] text-muted-foreground">
                Primary
              </span>
            ) : null}
          </label>
        ))}
        <label className="flex items-center gap-2 text-[length:var(--text-body)]">
          <input
            checked={recipientId === MANUAL}
            className="size-4 shrink-0 [accent-color:var(--primary)]"
            name={`gmail-recipient-${draft.id}`}
            onChange={() => setRecipientId(MANUAL)}
            type="radio"
            value={MANUAL}
          />
          <span>{personEmails.length ? "Another address" : "Email address"}</span>
        </label>
        {recipientId === MANUAL ? (
          <>
            <Label className="sr-only" htmlFor={manualEmailId}>
              Recipient email address
            </Label>
            <Input
              autoComplete="email"
              id={manualEmailId}
              onChange={(event) => setManualEmail(event.target.value)}
              placeholder="name@example.com"
              type="email"
              value={manualEmail}
            />
            <p className="text-[length:var(--text-caption)] text-muted-foreground">
              This address is used for this draft only — it isn&rsquo;t saved to their profile.
            </p>
          </>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={subjectId}>Subject</Label>
        <Input
          id={subjectId}
          onChange={(event) => setSubject(event.target.value)}
          value={subject}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={bodyId}>Message</Label>
        <Textarea
          id={bodyId}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          value={body}
        />
        <p className="text-[length:var(--text-caption)] text-muted-foreground">
          Edits here save back to the Tendnote draft before the Gmail draft is created.
        </p>
      </div>

      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-1.5">
        <Button
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={pending} onClick={handleCreate} size="sm" type="button">
          <CheckIcon />
          {pending ? "Saving…" : "Save to Gmail"}
        </Button>
      </div>
    </div>
  );
}
