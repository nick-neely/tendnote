"use client";

import type { HouseholdInvitationSummary } from "@tendnote/domain/household-invitations";
import { HOUSEHOLD_INVITATION_TTL_DAYS } from "@tendnote/domain/household-invitations";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { type FormEvent, useId, useState, useTransition } from "react";
import {
  cancelHouseholdInvitationAction as defaultCancelAction,
  resendHouseholdInvitationAction as defaultResendAction,
  sendHouseholdInvitationAction as defaultSendAction,
} from "@/app/actions/household-invitations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  HOUSEHOLD_GENERIC_ERROR,
  INVITATION_DATE_FORMAT,
  INVITATION_STATE_LABEL,
} from "@/lib/household/invitation-copy";
import type { OwnerActionResult } from "@/lib/owner-action-result";

export type SendInvitationAction = (input: {
  email: string;
}) => Promise<OwnerActionResult<HouseholdOverview>>;
export type InvitationIdAction = (input: {
  invitationId: string;
}) => Promise<OwnerActionResult<HouseholdOverview>>;

export type HouseholdInvitationActions = {
  send?: SendInvitationAction;
  resend?: InvitationIdAction;
  cancel?: InvitationIdAction;
};

/**
 * The Owner's invitation surface, inside the Household Overview.
 *
 * People lead and this follows, because an invitation is a thing an Owner does
 * about the household rather than part of what the household is. It renders only
 * for an Owner: `overview.invitations` is empty for a Member by construction, and
 * the send form is gated on the reader's own role rather than on that emptiness.
 *
 * Every control here causes an email to leave Tendnote, so the form says so
 * before the press rather than confirming it afterwards.
 */
export function HouseholdInvitationsPanel({
  overview,
  actions = {},
  onOverviewChange,
  onAnnounce,
}: {
  overview: HouseholdOverview;
  actions?: HouseholdInvitationActions;
  onOverviewChange: (overview: HouseholdOverview) => void;
  onAnnounce: (message: string) => void;
}) {
  const send = actions.send ?? defaultSendAction;
  const resend = actions.resend ?? defaultResendAction;
  const cancel = actions.cancel ?? defaultCancelAction;

  if (overview.viewerRole !== "owner") return null;

  return (
    <section aria-labelledby="household-invitations-heading" className="flex flex-col gap-3">
      <h2
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
        id="household-invitations-heading"
      >
        Invitations
      </h2>

      {overview.invitations.length > 0 ? (
        <ul className="divide-y rounded-xl border bg-surface">
          {overview.invitations.map((invitation) => (
            <InvitationRow
              cancel={cancel}
              invitation={invitation}
              key={invitation.id}
              onAnnounce={onAnnounce}
              onOverviewChange={onOverviewChange}
              resend={resend}
            />
          ))}
        </ul>
      ) : null}

      {overview.seats.isFull ? (
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Every place in this household is taken, counting anyone with a live invitation. Cancel an
          invitation to make room for someone else.
        </p>
      ) : (
        <InviteForm onAnnounce={onAnnounce} onOverviewChange={onOverviewChange} send={send} />
      )}
    </section>
  );
}

/**
 * One invitation, live or recently ended.
 *
 * It is deliberately not a member row: the address leads instead of a name,
 * because nobody has told Tendnote a name yet, and the state is written out
 * rather than implied by a badge colour.
 *
 * An ended invitation stays for a week and reads as quiet fact — no destructive
 * colour, no controls, no apology. The alternative is worse: a row that simply
 * disappears leaves the Owner unable to tell a decline from a link that was
 * never opened, which is the one question they actually have.
 */
function InvitationRow({
  invitation,
  resend,
  cancel,
  onOverviewChange,
  onAnnounce,
}: {
  invitation: HouseholdInvitationSummary;
  resend: InvitationIdAction;
  cancel: InvitationIdAction;
  onOverviewChange: (overview: HouseholdOverview) => void;
  onAnnounce: (message: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: InvitationIdAction, announce: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action({ invitationId: invitation.id });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onOverviewChange(result.view);
        onAnnounce(announce);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  const live = invitation.state === "pending";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-col">
          <span
            className={`truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium${
              live ? "" : " text-muted-foreground"
            }`}
          >
            {invitation.email}
          </span>
          <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {INVITATION_STATE_LABEL[invitation.state]}
            {live ? ` · good until ${INVITATION_DATE_FORMAT.format(invitation.expiresAt)}` : ""}
          </span>
        </span>
        {/* Actions may wrap under the address at 200% text without scrolling the page. */}
        {live ? (
          <span className="flex shrink-0 flex-wrap gap-2">
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending || !invitation.canResend}
              onClick={() => run(resend, `Invitation to ${invitation.email} sent again.`)}
              size="sm"
              type="button"
              variant="outline"
            >
              Resend
            </Button>
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => run(cancel, `Invitation to ${invitation.email} cancelled.`)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </span>
        ) : null}
      </div>

      {live && !invitation.canResend ? (
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Just sent. You can send it again in a couple of minutes.
        </p>
      ) : null}

      {error ? (
        <p
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}

function InviteForm({
  send,
  onOverviewChange,
  onAnnounce,
}: {
  send: SendInvitationAction;
  onOverviewChange: (overview: HouseholdOverview) => void;
  onAnnounce: (message: string) => void;
}) {
  const emailId = useId();
  const hintId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = email.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await send({ email: trimmed });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setEmail("");
        onOverviewChange(result.view);
        onAnnounce(`Invitation sent to ${trimmed}.`);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={emailId}>Email address</Label>
          <Input
            aria-describedby={hintId}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className="h-11 sm:h-8"
            id={emailId}
            inputMode="email"
            name="invitationEmail"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="sam@example.com"
            type="email"
            value={email}
          />
        </div>
        <Button
          className="min-h-11 w-full sm:min-h-8 sm:w-auto"
          disabled={pending || trimmed.length === 0}
          type="submit"
        >
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </div>
      {/*
        The three things an Owner needs before pressing, in the order they
        matter: what leaves Tendnote, who can use it, and what it costs the
        household while it is outstanding.
      */}
      <p
        className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
        id={hintId}
      >
        Sending emails them a private link. Only someone signed in with this exact address can use
        it, it lasts {HOUSEHOLD_INVITATION_TTL_DAYS} days, and it holds a place in the household
        until it&rsquo;s used, cancelled, or runs out.
      </p>
      {error ? (
        <p
          className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
