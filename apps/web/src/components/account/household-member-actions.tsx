"use client";

import type {
  HouseholdMemberSummary,
  HouseholdOverview,
} from "@tendnote/domain/household-overview";
import { useState, useTransition } from "react";
import {
  offerHouseholdOwnerRoleAction as defaultOfferAction,
  removeHouseholdMemberAction as defaultRemoveAction,
  withdrawHouseholdOwnerOfferAction as defaultWithdrawAction,
} from "@/app/actions/household-governance";
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
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import type { OwnerActionResult } from "@/lib/owner-action-result";

export type MemberIdAction = (input: {
  memberUserId: string;
}) => Promise<OwnerActionResult<HouseholdOverview>>;

export type HouseholdMemberGovernanceActions = {
  offer?: MemberIdAction;
  withdraw?: MemberIdAction;
  remove?: MemberIdAction;
};

/**
 * What one Owner may do about one other person, rendered on that person's row.
 *
 * Only the moves that are actually open appear as controls. A rule that is
 * holding something back — most often the protection that stops one Owner
 * removing another — is written out as a plain line instead of a disabled
 * button, because a control that can never be pressed teaches nothing and a
 * sentence does. Neither is styled destructive: the household's setup contract
 * reserves that weight for the final consequential press, not for a boundary.
 *
 * Removing someone is the one thing here that ends another person's access, so
 * it is the only one that asks twice.
 */
export function HouseholdMemberActions({
  member,
  actions = {},
  onOverviewChange,
  onAnnounce,
}: {
  member: HouseholdMemberSummary;
  actions?: HouseholdMemberGovernanceActions;
  onOverviewChange: (overview: HouseholdOverview) => void;
  onAnnounce: (message: string) => void;
}) {
  const offer = actions.offer ?? defaultOfferAction;
  const withdraw = actions.withdraw ?? defaultWithdrawAction;
  const remove = actions.remove ?? defaultRemoveAction;

  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: MemberIdAction, announce: string, onDone?: () => void) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await action({ memberUserId: member.userId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onDone?.();
        onOverviewChange(result.view);
        onAnnounce(announce);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  // The row's own row-level note: an outstanding offer, or the reason a move is
  // unavailable. The offer wins, because it is the live thing.
  //
  // Removal is preferred over promotion when both are blocked, and that priority
  // is deliberate rather than arbitrary. There is exactly one row where the two
  // sentences differ — another Owner's — and there the removal sentence is the
  // protection worth teaching ("owners can't remove another owner") while the
  // promotion one restates the Owner badge already on the row. Every other case
  // where both are blocked, the person has left and both sentences are the same.
  const note = member.awaitingOwnerReply
    ? `Asked to co-own. It's ${member.name}'s to accept.`
    : (member.remove.blockedReason ?? member.promote.blockedReason);

  const hasControls =
    member.promote.available || member.remove.available || member.awaitingOwnerReply;
  if (!hasControls && !note) return null;

  return (
    <>
      {hasControls ? (
        // Wraps under the name at 200% text rather than pushing the row wide.
        <span className="flex shrink-0 flex-wrap items-center gap-1">
          {/*
            One press, no confirmation, and that is the intended weight. This
            grants nothing: it writes a question that the recipient answers, and
            any Owner can take it back from this same row until they do. Adding
            a dialog would put ceremony on a reversible ask and flatten the
            distinction with Remove beside it, which is the press that actually
            ends someone's access.
          */}
          {member.promote.available ? (
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => run(offer, `${member.name} was asked to co-own this household.`)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Make an owner
            </Button>
          ) : null}

          {member.awaitingOwnerReply ? (
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => run(withdraw, `The co-owner offer to ${member.name} was taken back.`)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Take it back
            </Button>
          ) : null}

          {member.remove.available ? (
            <AlertDialog
              onOpenChange={(next) => {
                if (pending) return;
                setRemoving(next);
                if (next) setError(null);
              }}
              open={removing}
            >
              <AlertDialogTrigger asChild>
                <Button
                  className="min-h-11 text-muted-foreground hover:text-destructive sm:min-h-8"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {member.name} from this household?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Their access ends right away. Anything they shared here stops being visible to
                    everyone, and anything shared with them disappears from their view. What they
                    wrote stays theirs. Coming back would need a new invitation.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {error ? (
                  <p
                    className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>Keep them here</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={pending}
                    onClick={(event) => {
                      // Held open so the pending state and any refusal stay visible;
                      // Radix would otherwise close on click and swallow both.
                      event.preventDefault();
                      run(remove, `${member.name} was removed from the household.`, () =>
                        setRemoving(false),
                      );
                    }}
                    variant="destructive"
                  >
                    {pending ? "Removing…" : "Remove them"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </span>
      ) : null}

      {note ? (
        <p className="w-full max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {note}
        </p>
      ) : null}

      {error && !removing ? (
        <p
          className="w-full text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
