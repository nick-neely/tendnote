import { listLinkedAssetsForGeneralActions } from "@tendnote/db/queries/assets";
import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import {
  listActiveGeneralActions,
  listPausedGeneralActions,
  listResolvedGeneralActions,
} from "@tendnote/db/queries/general-actions";
import { listShareableHouseholdMembersForUser } from "@tendnote/db/queries/households";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import { cacheLife, cacheTag } from "next/cache";
import { toGeneralActionAreaView } from "@/lib/general-action-area-view";
import { toGeneralActionLinkedAssetView, toGeneralActionView } from "@/lib/general-action-view";
import {
  tagForAffectedScope,
  tagsForAffectedScope,
  tagsForAffectedScopes,
} from "./affected-scope-tags";
import { cacheProfiles } from "./cache-profiles";

const ACTION_REFRESH_MS = 30_000;

export const actionCacheContract = {
  owner(ownerUserId: string) {
    return {
      tags: tagsForAffectedScope({
        kind: "viewer-collection",
        collection: "general-actions",
        viewerUserId: ownerUserId,
      }),
    };
  },
  entity(ownerUserId: string, actionId: string) {
    return tagForAffectedScope({
      kind: "viewer-entity",
      entity: "general-action",
      entityId: actionId,
      viewerUserId: ownerUserId,
    });
  },
  linkedAsset(assetId: string) {
    return tagForAffectedScope({
      kind: "linked-entity",
      entity: "asset",
      entityId: assetId,
    });
  },
};

/** A bounded active projection plus its linked Asset labels for Action Today. */
export async function getCachedActionTodayViews(input: { ownerUserId: string; now: Date }) {
  const refreshedAt = Math.floor(input.now.getTime() / ACTION_REFRESH_MS) * ACTION_REFRESH_MS;
  return cachedActionTodayViews(input.ownerUserId, refreshedAt);
}

/** The default `/actions` render: only the active ledger and its Area filter. */
export async function getCachedActionPrimaryViews(input: { ownerUserId: string; now: Date }) {
  const refreshedAt = Math.floor(input.now.getTime() / ACTION_REFRESH_MS) * ACTION_REFRESH_MS;
  const [active, areas] = await Promise.all([
    cachedActionActiveViews(input.ownerUserId, refreshedAt),
    cachedActionAreas(input.ownerUserId),
  ]);
  return { active, areas };
}

/**
 * The bounded Action ledger projection used by `/actions`. Secondary panes
 * (Areas, people, household sharing and review proposals) intentionally stay
 * outside this cache so opening a relevant pane never makes the active ledger
 * wait on them.
 */
export async function getCachedActionLedgerViews(input: {
  ownerUserId: string;
  now: Date;
  resolvedLimit: number;
}) {
  const refreshedAt = Math.floor(input.now.getTime() / ACTION_REFRESH_MS) * ACTION_REFRESH_MS;
  return cachedActionLedgerViews(input.ownerUserId, refreshedAt, input.resolvedLimit);
}

type LinkedAssetsByAction = Awaited<ReturnType<typeof listLinkedAssetsForGeneralActions>>;
type ActionViewOptions = Parameters<typeof toGeneralActionView>[1];

/**
 * Display names for the co-members a projection actually has to name.
 *
 * Only a household-native record with a named Responsibility Holder needs a
 * roster, so a member with no household — or a household with no chore anyone
 * has claimed, which is the ordinary case — pays nothing for this (ADR 0215).
 */
async function memberNamesForHolders(
  ownerUserId: string,
  actions: readonly { ownership: string; responsibilityHolderUserId: string | null }[],
): Promise<ReadonlyMap<string, string> | undefined> {
  const named = actions.some(
    (action) =>
      action.ownership === "household_native" && action.responsibilityHolderUserId !== null,
  );
  if (!named) return undefined;
  const members = await listShareableHouseholdMembersForUser({ userId: ownerUserId });
  return new Map(members.map((member) => [member.userId, member.name]));
}

/**
 * Maps one Action to its view and emits that Action's invalidation tags on the way.
 *
 * This must only be called from inside a `"use cache"` body: `cacheTag` registers
 * against the cache entry currently being produced, so the entity tag and the tag of
 * every Asset the Action links only attach when the walk happens there. It stays a
 * plain helper for exactly that reason — the tags follow the caller's scope.
 */
function toTaggedActionView(
  action: Parameters<typeof toGeneralActionView>[0],
  context: {
    ownerUserId: string;
    now: Date;
    linkedAssetsByAction: LinkedAssetsByAction;
    memberNames?: ReadonlyMap<string, string>;
    reminderSchedule?: ActionViewOptions["reminderSchedule"];
  },
) {
  cacheTag(actionCacheContract.entity(context.ownerUserId, action.id));
  const linkedAssets = context.linkedAssetsByAction[action.id] ?? [];
  for (const linkedAsset of linkedAssets) {
    cacheTag(actionCacheContract.linkedAsset(linkedAsset.asset.id));
  }
  return toGeneralActionView(action, {
    now: context.now,
    callerUserId: context.ownerUserId,
    linkedAssets: linkedAssets.map(toGeneralActionLinkedAssetView),
    memberNames: context.memberNames,
    reminderSchedule: context.reminderSchedule,
  });
}

/**
 * The active-Action projection Action Today and the default `/actions` render share:
 * the bounded active list, its linked-Asset labels, and each Action's tagged view.
 * The two callers differ only in the shape they hand back, so the reads, the refresh
 * bucket and the tag walk live here once. Called from within each caller's own
 * `"use cache"` body so its tags land on that caller's entry.
 */
async function taggedActiveActionViews(ownerUserId: string, refreshedAt: number) {
  const active = await listActiveGeneralActions({ ownerUserId });
  const [linkedAssetsByAction, memberNames] = await Promise.all([
    listLinkedAssetsForGeneralActions({
      callerUserId: ownerUserId,
      generalActionIds: active.map((action) => action.id),
    }),
    memberNamesForHolders(ownerUserId, active),
  ]);
  const now = new Date(refreshedAt);
  return active.map((action) => ({
    action,
    view: toTaggedActionView(action, { ownerUserId, now, linkedAssetsByAction, memberNames }),
  }));
}

async function cachedActionTodayViews(ownerUserId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...actionCacheContract.owner(ownerUserId).tags);
  const tagged = await taggedActiveActionViews(ownerUserId, refreshedAt);
  return tagged.map(({ action, view }) => ({
    action: { status: action.status, dueAt: action.dueAt, deferUntil: action.deferUntil },
    view,
  }));
}

async function cachedActionActiveViews(ownerUserId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...actionCacheContract.owner(ownerUserId).tags);
  return (await taggedActiveActionViews(ownerUserId, refreshedAt)).map(({ view }) => view);
}

async function cachedActionAreas(ownerUserId: string) {
  "use cache";
  cacheLife(cacheProfiles.reference);
  cacheTag(...actionCacheContract.owner(ownerUserId).tags);
  return (await listGeneralActionAreas({ ownerUserId, includeArchived: true })).map(
    toGeneralActionAreaView,
  );
}

async function cachedActionLedgerViews(
  ownerUserId: string,
  refreshedAt: number,
  resolvedLimit: number,
) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(
    ...tagsForAffectedScopes([
      {
        kind: "viewer-collection",
        collection: "general-actions",
        viewerUserId: ownerUserId,
      },
      { kind: "owner-collection", collection: "account", ownerUserId },
    ] satisfies AffectedScope[]),
  );
  const [active, paused, resolved, reminderSchedules] = await Promise.all([
    listActiveGeneralActions({ ownerUserId }),
    listPausedGeneralActions({ ownerUserId }),
    listResolvedGeneralActions({ ownerUserId, limit: resolvedLimit }),
    listReminderSchedulesForOwner({ ownerUserId }),
  ]);
  const all = [...active, ...paused, ...resolved];
  const [linkedAssetsByAction, memberNames] = await Promise.all([
    listLinkedAssetsForGeneralActions({
      callerUserId: ownerUserId,
      generalActionIds: all.map((action) => action.id),
    }),
    memberNamesForHolders(ownerUserId, all),
  ]);
  const now = new Date(refreshedAt);
  const reminderScheduleByActionId = new Map(
    reminderSchedules.map((schedule) => [schedule.generalActionId, schedule]),
  );
  const toView = (action: (typeof all)[number]) =>
    toTaggedActionView(action, {
      ownerUserId,
      now,
      linkedAssetsByAction,
      memberNames,
      reminderSchedule: reminderScheduleByActionId.get(action.id) ?? null,
    });
  return { active: active.map(toView), paused: paused.map(toView), resolved: resolved.map(toView) };
}
