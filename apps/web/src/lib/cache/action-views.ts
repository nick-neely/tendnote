import { listLinkedAssetsForGeneralActions } from "@tendnote/db/queries/assets";
import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import {
  listActiveGeneralActions,
  listPausedGeneralActions,
  listResolvedGeneralActions,
} from "@tendnote/db/queries/general-actions";
import { listReminderSchedulesForOwner } from "@tendnote/db/queries/reminders";
import { cacheLife, cacheTag } from "next/cache";
import { toGeneralActionAreaView } from "@/lib/general-action-area-view";
import { toGeneralActionLinkedAssetView, toGeneralActionView } from "@/lib/general-action-view";
import { cacheProfiles } from "./cache-profiles";

const ACTION_REFRESH_MS = 30_000;

export const actionCacheContract = {
  owner(ownerUserId: string) {
    return {
      tags: [`action:owner:${ownerUserId}`, `action:owner:${ownerUserId}:linked-assets`] as const,
    };
  },
  entity(ownerUserId: string, actionId: string) {
    return `action:owner:${ownerUserId}:action:${actionId}`;
  },
  linkedAsset(assetId: string) {
    return `action:linked-asset:${assetId}`;
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

async function cachedActionTodayViews(ownerUserId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...actionCacheContract.owner(ownerUserId).tags);

  const active = await listActiveGeneralActions({ ownerUserId });
  const linkedAssetsByAction = await listLinkedAssetsForGeneralActions({
    callerUserId: ownerUserId,
    generalActionIds: active.map((action) => action.id),
  });
  const now = new Date(refreshedAt);
  return active.map((action) => {
    cacheTag(actionCacheContract.entity(ownerUserId, action.id));
    for (const linkedAsset of linkedAssetsByAction[action.id] ?? []) {
      cacheTag(actionCacheContract.linkedAsset(linkedAsset.asset.id));
    }
    return {
      action: { status: action.status, dueAt: action.dueAt, deferUntil: action.deferUntil },
      view: toGeneralActionView(action, {
        now,
        callerUserId: ownerUserId,
        linkedAssets: (linkedAssetsByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView),
      }),
    };
  });
}

async function cachedActionActiveViews(ownerUserId: string, refreshedAt: number) {
  "use cache";
  cacheLife(cacheProfiles.interactive);
  cacheTag(...actionCacheContract.owner(ownerUserId).tags);
  const active = await listActiveGeneralActions({ ownerUserId });
  const linkedAssetsByAction = await listLinkedAssetsForGeneralActions({
    callerUserId: ownerUserId,
    generalActionIds: active.map((action) => action.id),
  });
  const now = new Date(refreshedAt);
  return active.map((action) => {
    cacheTag(actionCacheContract.entity(ownerUserId, action.id));
    for (const linkedAsset of linkedAssetsByAction[action.id] ?? []) {
      cacheTag(actionCacheContract.linkedAsset(linkedAsset.asset.id));
    }
    return toGeneralActionView(action, {
      now,
      callerUserId: ownerUserId,
      linkedAssets: (linkedAssetsByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView),
    });
  });
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
  cacheTag(...actionCacheContract.owner(ownerUserId).tags);
  const [active, paused, resolved, reminderSchedules] = await Promise.all([
    listActiveGeneralActions({ ownerUserId }),
    listPausedGeneralActions({ ownerUserId }),
    listResolvedGeneralActions({ ownerUserId, limit: resolvedLimit }),
    listReminderSchedulesForOwner({ ownerUserId }),
  ]);
  const all = [...active, ...paused, ...resolved];
  const linkedAssetsByAction = await listLinkedAssetsForGeneralActions({
    callerUserId: ownerUserId,
    generalActionIds: all.map((action) => action.id),
  });
  const now = new Date(refreshedAt);
  const reminderScheduleByActionId = new Map(
    reminderSchedules.map((schedule) => [schedule.generalActionId, schedule]),
  );
  const toView = (action: (typeof all)[number]) => {
    cacheTag(actionCacheContract.entity(ownerUserId, action.id));
    for (const linkedAsset of linkedAssetsByAction[action.id] ?? []) {
      cacheTag(actionCacheContract.linkedAsset(linkedAsset.asset.id));
    }
    return toGeneralActionView(action, {
      now,
      callerUserId: ownerUserId,
      linkedAssets: (linkedAssetsByAction[action.id] ?? []).map(toGeneralActionLinkedAssetView),
      reminderSchedule: reminderScheduleByActionId.get(action.id) ?? null,
    });
  };
  return { active: active.map(toView), paused: paused.map(toView), resolved: resolved.map(toView) };
}
