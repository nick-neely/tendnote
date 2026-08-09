"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  acceptHouseholdInvitationAction as defaultAcceptAction,
  declineHouseholdInvitationAction as defaultDeclineAction,
  type HouseholdJoinResult,
} from "@/app/actions/household-invitations";
import { Button } from "@/components/ui/button";
import { HOUSEHOLD_GENERIC_ERROR, INVITATION_DATE_FORMAT } from "@/lib/household/invitation-copy";
import type { HouseholdJoinView } from "@/lib/household/join-view";

export type HouseholdJoinAction = (input: { secret: string }) => Promise<HouseholdJoinResult>;

/**
 * The one screen a Household Invitation link leads to.
 *
 * Its whole job is to be honest about how much it knows. Four of its six states
 * are reached *before* the invited address has been proven, and none of them may
 * name a household, an inviter, or an address — so they are written as complete
 * thoughts on their own rather than as a redacted version of the real thing.
 * Only `ready` names anything, and only after the person holding the link has
 * signed in as the address it was sent to.
 */
export function JoinInvitationSurface({
  view,
  secret,
  acceptAction = defaultAcceptAction,
  declineAction = defaultDeclineAction,
}: {
  view: HouseholdJoinView;
  /** Present only for the states where the visitor can actually act. */
  secret: string;
  acceptAction?: HouseholdJoinAction;
  declineAction?: HouseholdJoinAction;
}) {
  const [announcement, setAnnouncement] = useState("");

  return (
    <>
      {/*
        Joining, declining, and an invitation that ends underneath the reader all
        replace this panel outright — including the control that had focus. The
        region is mounted from the start and empty, so the outcome is a content
        change into an existing region rather than a region appearing at the same
        moment as its text, which is announced unreliably.
      */}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      <JoinBody
        acceptAction={acceptAction}
        declineAction={declineAction}
        onAnnounce={setAnnouncement}
        secret={secret}
        view={view}
      />
    </>
  );
}

function JoinBody({
  view,
  secret,
  acceptAction,
  declineAction,
  onAnnounce,
}: {
  view: HouseholdJoinView;
  secret: string;
  acceptAction: HouseholdJoinAction;
  declineAction: HouseholdJoinAction;
  onAnnounce: (message: string) => void;
}) {
  switch (view.state) {
    case "ready":
      return (
        <JoinDecision
          acceptAction={acceptAction}
          declineAction={declineAction}
          expiresAt={view.expiresAt}
          householdName={view.householdName}
          onAnnounce={onAnnounce}
          secret={secret}
        />
      );
    case "sign-in-required":
      return (
        <JoinNotice
          action={{
            href: `/sign-in?returnTo=${encodeURIComponent(joinPath(secret))}`,
            label: "Sign in",
          }}
          body="Sign in with the email address this invitation was sent to, or create an account with it. Nothing happens until you say so."
          secondary={{
            href: `/sign-up?returnTo=${encodeURIComponent(joinPath(secret))}`,
            label: "Create an account",
          }}
        />
      );
    case "address-mismatch":
      return (
        <JoinNotice
          action={{ href: "/sign-in", label: "Sign in with another address" }}
          body="You're signed in with a different email address. Sign in with the one this invitation was sent to and it will be waiting."
        />
      );
    case "workspace-conflict":
      return (
        <JoinNotice
          body="You're already in a household. Tendnote keeps you in one household at a time, so nothing here has changed."
          secondary={{ href: "/account/household", label: "Go to your household" }}
        />
      );
    case "access-pending":
      return (
        <JoinNotice
          body="Your Tendnote account is still waiting for Private Beta Access. This invitation will keep until then, as long as it hasn't run out."
          secondary={{ href: "/pending", label: "Check your access" }}
        />
      );
    default:
      return (
        <JoinNotice
          body="This link can't be used. It may have been used already, cancelled, or run out. Ask whoever invited you to send a new one."
          secondary={{ href: "/", label: "Go to Tendnote" }}
        />
      );
  }
}

function joinPath(secret: string): string {
  return `/join/${encodeURIComponent(secret)}`;
}

/**
 * Every non-actionable state, in one shape. They differ only in words, so they
 * are built from one component: a visitor who lands on two of them in a row
 * should feel the page answering, not changing.
 */
function JoinNotice({
  body,
  action,
  secondary,
}: {
  body: string;
  action?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty">
        {body}
      </p>
      {action || secondary ? (
        <div className="flex flex-col gap-2">
          {action ? (
            <Button asChild className="min-h-11 w-full">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : null}
          {secondary ? (
            <Button asChild className="min-h-11 w-full" variant="outline">
              <Link href={secondary.href}>{secondary.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The one state where the visitor has something to decide.
 *
 * Both decisions are consequential and both get the same two-step shape.
 * Joining is the larger of the two — it creates a durable membership and opens a
 * shared layer — so it is not a single tap; the confirm step restates the
 * sharing boundary at the moment of commitment, which is the only moment it is
 * actually being agreed to. Declining burns the link, so its confirm step says
 * so. Neither is a modal: the page has one job and can afford to change in place.
 */
function JoinDecision({
  householdName,
  expiresAt,
  secret,
  acceptAction,
  declineAction,
  onAnnounce,
}: {
  householdName: string;
  expiresAt: Date;
  secret: string;
  acceptAction: HouseholdJoinAction;
  declineAction: HouseholdJoinAction;
  onAnnounce: (message: string) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"join" | "decline" | null>(null);
  const [outcome, setOutcome] = useState<"declined" | { body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const explanationId = useId();

  function run(action: HouseholdJoinAction, onDone: () => void) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action({ secret });
        if (!result.ok) {
          // A terminal failure is not a retry: the invitation ended while this
          // page was open, so the page becomes the ending rather than offering a
          // button that can never work again.
          if (result.terminal) {
            setConfirming(null);
            setOutcome({ body: result.error });
            onAnnounce(result.error);
            return;
          }
          setError(result.error);
          return;
        }
        onDone();
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  if (outcome === "declined") {
    return (
      <JoinNotice
        body="Declined. This link no longer works, and nothing was shared. If you change your mind, ask for a fresh invitation."
        secondary={{ href: "/", label: "Go to Tendnote" }}
      />
    );
  }
  if (outcome) {
    return <JoinNotice body={outcome.body} secondary={{ href: "/", label: "Go to Tendnote" }} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty">
          Joining <span className="font-medium">{householdName}</span> gives you a small shared
          layer with the people in it. Anything you don&rsquo;t share stays private to you.
        </p>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          This invitation is good until {INVITATION_DATE_FORMAT.format(expiresAt)}.
        </p>
      </div>

      {confirming === "join" ? (
        <ConfirmStep
          confirmLabel={pending ? "Joining…" : `Yes, join ${householdName}`}
          explanation={`You'll become a member of ${householdName}. People there will see anything you choose to give household visibility — nothing you've already written moves, and nothing else is shared.`}
          explanationId={explanationId}
          onBack={() => setConfirming(null)}
          onConfirm={() =>
            run(acceptAction, () => {
              onAnnounce(`You've joined ${householdName}.`);
              router.replace("/account/household");
              router.refresh();
            })
          }
          pending={pending}
        />
      ) : confirming === "decline" ? (
        <ConfirmStep
          backLabel="Keep it for now"
          confirmLabel={pending ? "Declining…" : "Yes, decline"}
          confirmVariant="outline"
          explanation="Declining ends this invitation and the link stops working. Nothing else changes."
          explanationId={explanationId}
          onBack={() => setConfirming(null)}
          onConfirm={() =>
            run(declineAction, () => {
              onAnnounce("Invitation declined.");
              setOutcome("declined");
            })
          }
          pending={pending}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            className="min-h-11 w-full"
            disabled={pending}
            onClick={() => setConfirming("join")}
            type="button"
          >
            Join {householdName}
          </Button>
          <Button
            className="min-h-11 w-full"
            disabled={pending}
            onClick={() => setConfirming("decline")}
            type="button"
            variant="ghost"
          >
            Decline
          </Button>
        </div>
      )}

      {error ? (
        <p
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The shared second step for both decisions: say what this does, then ask again.
 * One component so the two confirmations cannot come to feel like different
 * kinds of question.
 */
function ConfirmStep({
  explanation,
  explanationId,
  confirmLabel,
  confirmVariant = "default",
  backLabel = "Not yet",
  pending,
  onConfirm,
  onBack,
}: {
  explanation: string;
  explanationId: string;
  confirmLabel: string;
  confirmVariant?: "default" | "outline";
  backLabel?: string;
  pending: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty"
        id={explanationId}
      >
        {explanation}
      </p>
      <div className="flex flex-col gap-2">
        <Button
          aria-describedby={explanationId}
          className="min-h-11 w-full"
          disabled={pending}
          onClick={onConfirm}
          type="button"
          variant={confirmVariant}
        >
          {confirmLabel}
        </Button>
        <Button
          className="min-h-11 w-full"
          disabled={pending}
          onClick={onBack}
          type="button"
          variant="ghost"
        >
          {backLabel}
        </Button>
      </div>
    </div>
  );
}
