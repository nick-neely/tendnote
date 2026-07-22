import { z } from "zod";
import type { AssetMemory, AssetMemoryValue } from "./asset-memories";
import type { Asset } from "./assets";
import {
  describeRecurrence,
  type GeneralActionRecurrence,
  nextRoutineDueAt,
  startOfLocalDay,
} from "./general-actions";
import { parseLocalCalendarDate } from "./local-calendar-dates";

/**
 * Asset-linked General Action proposals (#203): the pure rule that turns a *reviewed*
 * Asset Memory carrying a date or an interval — a warranty expiry, a subscription
 * renewal, a maintenance cadence, a replacement schedule — into a Suggested General
 * Action the owner can accept, edit, dismiss, or ignore through the existing review
 * path (#196 user stories 40, 41).
 *
 * Nothing here writes: planning is a deterministic, side-effect-free reading of an
 * asset plus a memory at an instant, so the review seam, the Asset Profile, and Eve
 * can all ask "what would this memory propose?" and get the same answer. Everything
 * this module refuses to propose is as load-bearing as what it does: an unreviewed
 * memory, a bare fact with no timing, and a date that has already passed all yield
 * nothing, which is what keeps proactive asset surfacing capped and explainable
 * rather than a second notification system (#196).
 */

/**
 * Why a memory proposes an action — the *what* of the work, read off the memory's
 * label. Orthogonal to timing: a replacement can be a one-off date ("Replace by")
 * or a cadence ("Replacement interval"), and both are the same kind of work.
 */
export const assetActionProposalReasonSchema = z.enum([
  "warranty_expiry",
  "renewal",
  "replacement",
  "maintenance",
  "dated_reminder",
]);
export type AssetActionProposalReason = z.infer<typeof assetActionProposalReasonSchema>;

/**
 * The cap on one planning pass over a single asset. A proposal is a review item, and
 * a review queue that arrives twenty items deep from one fridge is a nag, not a
 * memory (#196: capped and explainable). Deliberately small — the owner can run the
 * pass again once they have cleared what it proposed.
 */
export const MAX_ASSET_ACTION_PROPOSALS = 3;

/**
 * How many days of warning each kind of deadline earns. A warranty is worth knowing
 * about with time to act on it (make the claim, buy the extension); a renewal needs
 * just enough room to cancel or re-decide. A replacement or an unclassified date
 * means the day it says — inventing lead time there would be putting words in the
 * owner's mouth.
 */
const LEAD_DAYS: Record<AssetActionProposalReason, number> = {
  warranty_expiry: 14,
  renewal: 7,
  replacement: 0,
  maintenance: 0,
  dated_reminder: 0,
};

/**
 * The label patterns behind each reason, in priority order — first match wins. Order
 * matters: "Warranty expires" contains "expir", so warranty must be read before the
 * generic renewal words, or every warranty would propose a renewal.
 */
const REASON_PATTERNS: ReadonlyArray<{ reason: AssetActionProposalReason; pattern: RegExp }> = [
  { reason: "warranty_expiry", pattern: /warrant|guarantee/i },
  { reason: "replacement", pattern: /replac|swap|change out/i },
  { reason: "renewal", pattern: /renew|subscri|membership|billing|expir|due on/i },
  { reason: "maintenance", pattern: /service|maintenance|inspect|tune.?up|oil change|clean/i },
];

/**
 * What a memory is about, from its label. An interval with an unrecognized label is
 * maintenance by default — a cadence on an asset is, by definition, recurring care.
 * A date with an unrecognized label stays an honest `dated_reminder`: we know *when*
 * the owner wants to think about it, and we do not pretend to know why.
 */
function classifyReason(label: string, value: AssetMemoryValue): AssetActionProposalReason {
  for (const { reason, pattern } of REASON_PATTERNS) {
    if (pattern.test(label)) {
      return reason;
    }
  }
  return value.type === "interval" ? "maintenance" : "dated_reminder";
}

/** The proposal's title: the work to do, named after the asset it is about. */
function composeTitle(
  reason: AssetActionProposalReason,
  asset: Pick<Asset, "name">,
  memory: Pick<AssetMemory, "label">,
): string {
  switch (reason) {
    case "warranty_expiry":
      return `Check the warranty on ${asset.name}`;
    case "renewal":
      return `Renew ${asset.name}`;
    case "replacement":
      return `Replace ${asset.name}`;
    case "maintenance":
      return `Service ${asset.name}`;
    case "dated_reminder":
      // Nothing was inferred, so the memory's own words carry the proposal.
      return `${memory.label}: ${asset.name}`;
  }
}

/**
 * The proposal's notes: where it came from, in the owner's own words. This is the
 * whole "explainable" half of the review gate — an owner reading a suggested action
 * they did not write should be able to see the exact detail that produced it and
 * decide whether the inference was fair.
 */
function composeNotes(
  asset: Pick<Asset, "name">,
  memory: Pick<AssetMemory, "label" | "value">,
  recurrence: GeneralActionRecurrence | null,
): string {
  const fact = recurrence
    ? describeRecurrence(recurrence)
    : memory.value?.type === "date"
      ? memory.value.date
      : null;
  const detail = fact ? `${memory.label}: ${fact}` : memory.label;
  return `Proposed from the "${detail}" detail on ${asset.name}.`;
}

/**
 * When a dated fact should land on the ledger: `leadDays` before the date it names,
 * never earlier than today. The clamp matters — a warranty expiring in three days
 * would otherwise propose an action born two weeks overdue, and an action that is
 * already late the moment it exists is a guilt trip, not a reminder.
 *
 * Returns null for a date that has already passed: there is nothing left to remind
 * anyone about, and a stale fact must not manufacture an overdue action.
 */
function resolveDatedDueAt(date: string, leadDays: number, now: Date): Date | null {
  const target = parseLocalCalendarDate(date);
  if (!target) {
    return null;
  }
  const today = startOfLocalDay(now);
  if (target.getTime() < today) {
    return null;
  }

  const lead = new Date(target.getFullYear(), target.getMonth(), target.getDate() - leadDays);
  return lead.getTime() < today ? new Date(today) : lead;
}

/**
 * One proposed Suggested General Action, ready for the review seam to persist. Carries
 * the memory it was read from so the write can link the two and stay idempotent, and
 * the reason so the audit trail and the review card can say *why* without re-deriving it.
 */
export type AssetActionProposalPlan = {
  reason: AssetActionProposalReason;
  /** The reviewed Asset Memory this proposal is grounded in. */
  assetMemoryId: string;
  title: string;
  notes: string;
  /** The proposed due date; always set — an untimed proposal would not be one. */
  dueAt: Date;
  /** A cadence for an interval memory (making the proposal a Routine); else null. */
  recurrence: GeneralActionRecurrence | null;
};

export type PlanAssetMemoryActionProposalInput = {
  asset: Pick<Asset, "id" | "name" | "kind">;
  memory: Pick<AssetMemory, "id" | "label" | "value" | "notes" | "status">;
  now: Date;
};

/**
 * What one Asset Memory would propose, or null when it would propose nothing.
 *
 * Only a reviewed (`active`) memory proposes: an inferred memory that is itself still
 * waiting in review must not spawn a second review item downstream of its own gate —
 * the owner has not yet said the *fact* is true, so Tendnote cannot act as if it is.
 * Only a timed value proposes: a filter size is recall, not a reminder.
 */
export function planAssetMemoryActionProposal(
  input: PlanAssetMemoryActionProposalInput,
): AssetActionProposalPlan | null {
  const { asset, memory, now } = input;
  if (memory.status !== "active" || memory.value === null) {
    return null;
  }

  const { value } = memory;
  if (value.type !== "date" && value.type !== "interval") {
    return null;
  }

  const reason = classifyReason(memory.label, value);
  const recurrence: GeneralActionRecurrence | null =
    value.type === "interval" ? { interval: value.interval, unit: value.unit } : null;

  // A cadence's first occurrence rolls forward from today through the *same* helper a
  // completed Routine uses, so a Routine's birth and its every roll-forward can never
  // disagree about what "every 6 months" means.
  const dueAt = recurrence
    ? nextRoutineDueAt(recurrence, now)
    : value.type === "date"
      ? resolveDatedDueAt(value.date, LEAD_DAYS[reason], now)
      : null;
  if (!dueAt) {
    return null;
  }

  return {
    reason,
    assetMemoryId: memory.id,
    title: composeTitle(reason, asset, memory),
    notes: composeNotes(asset, memory, recurrence),
    dueAt,
    recurrence,
  };
}

export type PlanAssetMemoryActionProposalsInput = {
  asset: Pick<Asset, "id" | "name" | "kind">;
  memories: ReadonlyArray<Pick<AssetMemory, "id" | "label" | "value" | "notes" | "status">>;
  now: Date;
};

/**
 * What an asset's reviewed memories would propose in one pass — capped at
 * {@link MAX_ASSET_ACTION_PROPOSALS}, preserving the store's oldest-first memory order
 * so the cap is deterministic (the same memories every run) rather than an arbitrary
 * slice. The cap is the proactive-surfacing budget from #196: an asset may keep
 * proposing across passes, but it can never arrive as a wall of review items at once.
 */
export function planAssetMemoryActionProposals(
  input: PlanAssetMemoryActionProposalsInput,
): AssetActionProposalPlan[] {
  const plans: AssetActionProposalPlan[] = [];
  for (const memory of input.memories) {
    if (plans.length >= MAX_ASSET_ACTION_PROPOSALS) {
      break;
    }
    const plan = planAssetMemoryActionProposal({ asset: input.asset, memory, now: input.now });
    if (plan) {
      plans.push(plan);
    }
  }
  return plans;
}
