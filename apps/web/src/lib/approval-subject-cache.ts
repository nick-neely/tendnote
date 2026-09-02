import type { ApprovalSubject } from "@tendnote/db/queries/approval-subjects";

/**
 * The browser's memory of what each parked tool call is *about*, keyed by `toolCallId`.
 *
 * eve 0.47.7 hands the browser a fixed prompt and the frozen tool input, and nothing
 * else — so `accept_suggested_followup` arrives as a tool name and a UUID. Turning that
 * id back into the record it names needs an owner-scoped read, which only the server can
 * do; `useApprovalSubject` asks for one and settles the answer here.
 *
 * ## Why the cache is a module, not React state
 *
 * A parked call and the status line it settles into are two different components in the
 * same slot (`ChatApprovalCard` → `ChatApprovalStatus`), so anything held inside the card
 * is gone the moment the owner answers — exactly when the settled line wants the same
 * title. Keying the answer by `toolCallId` outside the tree lets the status reuse what the
 * card already resolved, and makes "fetch once per call" a property of the store rather
 * than of a dependency array: a re-render, a re-mount, or a second card for the same call
 * all find the answer already there. A `toolCallId` is unique per call and a lookup is
 * owner-scoped and idempotent, so a cached answer can never be the wrong one.
 *
 * ## Why the store lives apart from the hook
 *
 * Two callers want only its lifetime, not its transport: the sign-out button, which has to
 * forget one person's records before the next person uses the device, and the tests. The
 * hook module reaches a `"use server"` action, so keeping the store here is what lets those
 * callers depend on the memory without dragging the server boundary in behind it.
 */

/**
 * ## The four states, and what each one means for the card
 *
 * `described` is a real record: its title replaces the generic heading. `missing` covers
 * "no such record", "not yours", and "that input did not parse" without distinguishing
 * them (ADR 0219), so the card says one neutral sentence and leaves the decision open —
 * the agent-side policy already denied a foreign record long before a card existed, so
 * this is belt and braces. `undescribed` is *no claim at all*: no describer is registered,
 * or the lookup itself did not complete. The card falls back to the frozen input, which is
 * what it showed before this existed.
 */
export type ApprovalSubjectState =
  | { readonly status: "pending" }
  | { readonly status: "described"; readonly subject: ApprovalSubject }
  | { readonly status: "missing" }
  | { readonly status: "undescribed" };

/**
 * Shared instances, because `useSyncExternalStore` tears down a render whose snapshot
 * changes identity every call. A stored `described` state is written once and then kept.
 */
const PENDING: ApprovalSubjectState = { status: "pending" };
export const APPROVAL_SUBJECT_MISSING: ApprovalSubjectState = { status: "missing" };
export const APPROVAL_SUBJECT_UNDESCRIBED: ApprovalSubjectState = { status: "undescribed" };

const states = new Map<string, ApprovalSubjectState>();
const listeners = new Map<string, Set<() => void>>();
/** Every call a lookup has been started for. Membership, not completion: fetch once. */
const started = new Set<string>();

/**
 * How many parked calls the cache remembers.
 *
 * The store deliberately outlives the components that read it — that is what lets a
 * settled status line reuse the title its card resolved — so nothing else would ever drop
 * an entry, and a long-lived tab would accumulate one owner-scoped answer per approval for
 * as long as it stayed open. A conversation never has more than a handful of parked calls
 * on screen at once, so 200 keeps every entry any live card or settled line can still ask
 * for, several hundred turns back.
 */
const MAX_REMEMBERED_CALLS = 200;

/**
 * Drops the oldest answers, but never one a mounted component is still reading.
 *
 * `Set` and `Map` iterate in insertion order, so this walks oldest-first. A call with a
 * live listener is skipped rather than evicted: forgetting it would blank a card that is
 * on screen and — having also forgotten it was ever fetched — re-read the owner's records
 * to fill it back in. The bound is therefore "at most {@link MAX_REMEMBERED_CALLS}
 * *evictable* entries", which differs from a hard cap only if that many approval cards are
 * mounted at once, and those are exactly the entries that must survive.
 */
function evictStaleLookups(): void {
  for (const toolCallId of started) {
    if (started.size < MAX_REMEMBERED_CALLS) return;
    if (listeners.has(toolCallId)) continue;
    started.delete(toolCallId);
    states.delete(toolCallId);
  }
}

/** Registers interest in one call; the returned function drops it again. */
export function subscribeApprovalSubject(toolCallId: string, listener: () => void): () => void {
  const forCall = listeners.get(toolCallId) ?? new Set<() => void>();
  forCall.add(listener);
  listeners.set(toolCallId, forCall);
  return () => {
    forCall.delete(listener);
    if (forCall.size === 0) listeners.delete(toolCallId);
  };
}

/** The answer for one call, or `pending` while its lookup is still out. */
export function readApprovalSubject(toolCallId: string): ApprovalSubjectState {
  return states.get(toolCallId) ?? PENDING;
}

/**
 * Records an answer and tells whoever is reading that call.
 *
 * An answer to a lookup that outlived its own eviction is dropped rather than
 * stored. {@link evictStaleLookups} only ever walks `started`, so an entry in
 * `states` whose id is no longer there is one nothing can drop again - and a
 * long-lived tab busy enough to evict is exactly the tab whose in-flight reads
 * settle late, so the cache would grow by one per such lookup and the bound
 * would stop holding. Nobody is reading it, and the next component that wants
 * it claims a fresh lookup, so nothing is lost by forgetting it.
 *
 * The exception is a call somebody re-subscribed to in the meantime: that is a
 * card on screen, which is the case eviction already refuses to touch. Its
 * answer is kept, and its id is put back into `started` so the entry stays
 * evictable once the card is gone.
 */
export function settleApprovalSubject(toolCallId: string, state: ApprovalSubjectState): void {
  if (!started.has(toolCallId)) {
    if (!listeners.has(toolCallId)) return;
    started.add(toolCallId);
  }
  states.set(toolCallId, state);
  for (const listener of listeners.get(toolCallId) ?? []) listener();
}

/**
 * Takes the right to fetch one call's subject, once.
 *
 * True exactly once per `toolCallId` — the caller that gets it owns the read, and every
 * later render, re-mount, or second card for the same call is told no. Eviction runs here
 * rather than on settle, and *before* the new id is recorded, so the call being claimed can
 * never be the one dropped to make room for it.
 */
export function claimApprovalSubjectLookup(toolCallId: string): boolean {
  if (started.has(toolCallId)) return false;
  evictStaleLookups();
  started.add(toolCallId);
  return true;
}

/**
 * Empties the cache.
 *
 * Called on sign-out, next to the composer drafts: these titles and detail lines are
 * owner-scoped reads of the signed-in person's own records, and signing out is a soft
 * navigation that tears down no JavaScript, so without this they would sit in memory for
 * whoever uses the device next.
 *
 * Also the tests' seam — the store deliberately outlives every component that reads it, so
 * a suite reusing a `toolCallId` across cases would otherwise inherit the previous case's
 * answer.
 */
export function resetApprovalSubjectCache(): void {
  states.clear();
  listeners.clear();
  started.clear();
}
