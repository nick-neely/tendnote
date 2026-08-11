"use server";

import {
  acceptHouseholdInvitation,
  cancelHouseholdInvitation,
  declineHouseholdInvitation,
  dispatchHouseholdInvitationDelivery,
  getHouseholdOverviewForUser,
  listActiveHouseholdMembershipsForUser,
  resendHouseholdInvitation,
  type SentHouseholdInvitation,
  sendHouseholdInvitation,
} from "@tendnote/db/queries/households";
import {
  HOUSEHOLD_INVITATION_EMAIL_LIMIT,
  type RecipientProof,
} from "@tendnote/domain/household-invitations";
import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { after } from "next/server";
import { z } from "zod";
import { getCurrentAccess } from "@/lib/access/current-access";
import {
  chargeHouseholdInvitationBudget,
  chargeHouseholdInvitationRecipientBudget,
} from "@/lib/household/invitation-budget";
import {
  getHouseholdInvitationTransport,
  householdInvitationUrl,
} from "@/lib/household/invitation-delivery";
import type { OwnerActionResult } from "@/lib/owner-action";
import { runOwnerAction } from "@/lib/owner-action";

/**
 * Each of the three Owner actions answers with the whole refreshed Overview
 * rather than the invitation it touched: sending, resending, and cancelling all
 * move the seat count, so returning only the changed row would leave the surface
 * to recompute capacity it does not own.
 */
type OverviewResult = OwnerActionResult<HouseholdOverview>;

/**
 * The wire bound only. The real address rule is the domain policy seam's
 * `parseInvitationRecipient`, so the surface renders the one curated message the
 * lifecycle raises instead of a second, drifting copy of it.
 */
const sendInvitationSchema = z
  .object({ email: z.string().max(HOUSEHOLD_INVITATION_EMAIL_LIMIT * 2) })
  .strict();
const invitationIdSchema = z.object({ invitationId: z.uuid() }).strict();
const invitationSecretSchema = z.object({ secret: z.string().min(1).max(200) }).strict();

async function overviewFor(ownerUserId: string): Promise<HouseholdOverview> {
  const overview = await getHouseholdOverviewForUser({ userId: ownerUserId });
  if (!overview) {
    throw new Error("Household overview unavailable.");
  }
  return overview;
}

/**
 * Hands one committed attempt to the transport, after the response.
 *
 * `after` is what keeps delivery out of the interactive request: the Owner's
 * answer is computed and returned from the committed invitation, and only then
 * does anything external happen. That matters twice over. The Owner is told the
 * invitation exists, which is true, rather than waiting on a provider's claim
 * about an inbox. And every syntactically valid address takes the same time to
 * answer, so response latency carries no signal about the recipient — which is
 * what stops the send becoming an account-enumeration oracle now that a real
 * provider is on the other end of it.
 *
 * ## Deviation from the outbox/background-job style, and the drain path
 *
 * The delivery-and-abuse research asks for dispatch "through the repository's
 * established outbox/background-job style". Half of that is here:
 * `household_invitation_deliveries` *is* the durable outbox, and
 * `dispatchHouseholdInvitationDelivery` claims a row with a conditional
 * `queued → sending` update, so the exact-once authority is the database and not
 * this call site. What is not here is a registered background-job family — a
 * `background_job_kind` value, a queue topic and consumer route, a job table with
 * its own lease, cron backfill, and the shared processor plumbing — which is a
 * large amount of machinery for a private beta's invitation volume.
 *
 * The drain path it would need already exists in the schema:
 * `household_invitation_deliveries_status_idx` on `(status, requested_at)` is
 * there so a worker can select queued attempts oldest-first and call
 * `dispatchHouseholdInvitationDelivery` on each. Because the claim is a
 * conditional update, that worker and this `after` callback cannot both send the
 * same attempt. What that buys, and what is missing until it exists, is a retry
 * for an attempt whose provider call failed: today it is recorded `failed` and
 * the Owner resends. Wiring the family changes nothing above this function.
 */
function deliverAfterResponse(sent: SentHouseholdInvitation): void {
  after(async () => {
    const transport = getHouseholdInvitationTransport();
    await dispatchHouseholdInvitationDelivery({
      deliveryId: sent.deliveryId,
      send: () =>
        transport({
          deliveryId: sent.deliveryId,
          to: sent.invitation.email,
          householdName: sent.householdName,
          inviterName: sent.inviterName,
          acceptUrl: householdInvitationUrl(sent.secret),
          expiresAt: sent.invitation.expiresAt,
        }),
    });
  });
}

/**
 * Charges the budgets that can be known before an invitation exists, for the
 * household the caller actually owns.
 *
 * Send and resend both need exactly this pairing, and both need it to happen
 * before their mutation, so it is one function rather than two copies that could
 * come to disagree about the order. The `?? ownerUserId` fallback only matters
 * for a caller with no household at all — the shared lifecycle refuses them a
 * moment later; charging something rather than nothing keeps the probe budgeted.
 */
async function chargeOwnInvitationBudget(input: {
  ownerUserId: string;
  email?: string;
}): Promise<void> {
  const [membership] = await listActiveHouseholdMembershipsForUser({
    userId: input.ownerUserId,
  });
  await chargeHouseholdInvitationBudget({
    ownerUserId: input.ownerUserId,
    householdId: membership?.householdId ?? input.ownerUserId,
    email: input.email,
  });
}

/**
 * Sends one Household Invitation, as an explicit Owner action.
 *
 * The three abuse budgets are charged before anything is created, so a refused
 * request neither writes a row nor sets an external send in motion. Every
 * syntactically valid address takes the same path and gets the same shape of
 * answer: nothing here looks the recipient up, so there is nothing for the
 * response to leak about whether they have an account, are admitted, or belong
 * to another household.
 */
export async function sendHouseholdInvitationAction(input: {
  email: string;
}): Promise<OverviewResult> {
  return runOwnerAction({
    schema: sendInvitationSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      await chargeOwnInvitationBudget({ ownerUserId, email: parsed.email });

      const sent = await sendHouseholdInvitation({ ownerUserId, email: parsed.email });
      deliverAfterResponse(sent);
      return overviewFor(ownerUserId);
    },
    affectedScopes: (_overview, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (overview) => overview,
  });
}

/**
 * Re-sends one live invitation, rotating its secret and restarting its window.
 *
 * The previous link dies at that moment. That is the point: a resend is a new
 * capability, not a second copy of the old one.
 */
export async function resendHouseholdInvitationAction(input: {
  invitationId: string;
}): Promise<OverviewResult> {
  return runOwnerAction({
    schema: invitationIdSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      await chargeOwnInvitationBudget({ ownerUserId });

      const sent = await resendHouseholdInvitation({
        ownerUserId,
        invitationId: parsed.invitationId,
      });
      // The recipient's own budget is charged as soon as the rotation reveals
      // who it is, and still before the message is handed to the transport.
      await chargeHouseholdInvitationRecipientBudget(sent.invitation.email);
      deliverAfterResponse(sent);
      return overviewFor(ownerUserId);
    },
    affectedScopes: (_overview, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (overview) => overview,
  });
}

/** Cancels one live invitation. Kills the link, frees the seat, sends nothing. */
export async function cancelHouseholdInvitationAction(input: {
  invitationId: string;
}): Promise<OverviewResult> {
  return runOwnerAction({
    schema: invitationIdSchema,
    input,
    budget: { costCategory: "server-action" },
    body: async ({ ownerUserId, input: parsed }) => {
      await cancelHouseholdInvitation({ ownerUserId, invitationId: parsed.invitationId });
      return overviewFor(ownerUserId);
    },
    affectedScopes: (_overview, ownerUserId) => [
      { kind: "owner-collection", collection: "account", ownerUserId },
    ],
    result: (overview) => overview,
  });
}

/**
 * A recipient-side outcome.
 *
 * `terminal` is the difference between "this went wrong, press it again" and
 * "this link is over" — an invitee whose invitation was cancelled while they
 * read the page must not be offered a retry that can never succeed. Anything the
 * shared lifecycle curated is terminal by construction: those messages describe
 * an ended capability, not a hiccup.
 */
export type HouseholdJoinResult = { ok: true } | { ok: false; error: string; terminal: boolean };

const RECIPIENT_SIGN_IN_REQUIRED = "Sign in with the invited email address to continue.";
const RECIPIENT_GENERIC = "That didn't go through. Nothing changed, so you can try again.";

type RecipientFailure = { ok: false; error: string; terminal: boolean };

const retryable = (error: string): RecipientFailure => ({ ok: false, error, terminal: false });

/**
 * The recipient-side gate.
 *
 * Unlike the Owner actions this does not go through `runOwnerAction`: the caller
 * is not acting on their own data, they are presenting a capability. What it
 * needs is the session's proven identity — id and email, never anything the
 * caller supplied — and the shared lifecycle re-decides everything else.
 *
 * Private Beta Access is deliberately *not* checked here. It is the global
 * denier for using Tendnote, not a rule about who may belong to a household: an
 * invited person whose access has not been granted yet still becomes a member,
 * and still lands on the waiting page afterwards. Requiring admission would
 * instead let the invitation expire under someone who did everything right.
 * Signing in is the whole requirement, because the address is what the shared
 * lifecycle matches against.
 */
async function requireRecipientSession(): Promise<
  { ok: true; userId: string; email: string } | RecipientFailure
> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") {
    return retryable(RECIPIENT_SIGN_IN_REQUIRED);
  }
  return { ok: true, userId: access.user.id, email: access.user.email };
}

/**
 * Runs one recipient-side operation against the presented capability.
 *
 * Accept and decline differ only in which lifecycle call they make: both parse
 * the same secret, both need the same proven session, and both classify failures
 * the same way. Sharing the shell keeps that identical treatment identical.
 */
async function withRecipientProof(
  input: { secret: string },
  run: (proof: RecipientProof) => Promise<unknown>,
): Promise<HouseholdJoinResult> {
  const parsed = invitationSecretSchema.safeParse(input);
  if (!parsed.success) return retryable(RECIPIENT_GENERIC);

  const session = await requireRecipientSession();
  if (!session.ok) return session;

  try {
    await run({
      secret: parsed.data.secret,
      userId: session.userId,
      userEmail: session.email,
    });
    return { ok: true };
  } catch (error) {
    // Only the domain's own curated household messages are safe to render: they
    // are written to describe an outcome without describing a household. They
    // are also the only failures that are genuinely over.
    if (
      error instanceof Error &&
      (error.name === "HouseholdValidationError" ||
        error.name === "HouseholdAdmissionConflictError")
    ) {
      return { ok: false, error: error.message, terminal: true };
    }
    return retryable(RECIPIENT_GENERIC);
  }
}

/**
 * Consumes one invitation, creating the active membership.
 *
 * Every failure the recipient can cause — a dead link, someone else's link, an
 * expired one, a household that filled up, an account already in a household —
 * comes back as a curated message from the shared lifecycle. None of them
 * distinguishes a link that never existed from one that is no longer usable.
 */
export async function acceptHouseholdInvitationAction(input: {
  secret: string;
}): Promise<HouseholdJoinResult> {
  return withRecipientProof(input, acceptHouseholdInvitation);
}

/** Declines one invitation, with the same identity proof acceptance requires. */
export async function declineHouseholdInvitationAction(input: {
  secret: string;
}): Promise<HouseholdJoinResult> {
  return withRecipientProof(input, declineHouseholdInvitation);
}
