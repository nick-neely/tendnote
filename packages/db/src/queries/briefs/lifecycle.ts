import { type BriefItem, resolveBriefItemTransition } from "@tendnote/domain";
import type { BriefLifecycleStore } from "./types";

export type BriefItemActionInput = {
  ownerUserId: string;
  briefItemId: string;
};

export type SnoozeBriefItemInput = BriefItemActionInput & {
  // When the snooze expires and the candidate may surface again (PRD #65, #68).
  snoozedUntil: Date;
};

/**
 * Owner-scoped brief-item lifecycle (PRD #65, issue #66). Dismiss, snooze, and
 * acted-on are local to the brief surface: they move item status through the
 * shared domain transition matrix and never mutate the underlying memory, source
 * record, or follow-up. The real source action (e.g. accepting a suggested
 * follow-up, issue #71) happens through its own lifecycle; only after it succeeds
 * does the brief item move to acted-on. Every mutation is owner-scoped and audited
 * so user-triggered changes to generated artifacts stay explainable.
 */
export function createBriefLifecycle(store: BriefLifecycleStore) {
  async function requireItem(input: BriefItemActionInput): Promise<BriefItem> {
    const item = await store.getBriefItem(input);

    if (!item) {
      throw new Error("Brief item not found.");
    }

    return item;
  }

  return {
    /** Dismisses a brief item so it stops demanding attention; underlying records are untouched. */
    async dismissBriefItem(input: BriefItemActionInput): Promise<BriefItem> {
      const item = await requireItem(input);
      const status = resolveBriefItemTransition(item.status, "dismiss");

      const updated = await store.updateBriefItem({
        ownerUserId: input.ownerUserId,
        briefItemId: item.id,
        patch: { status, snoozedUntil: null },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "brief_item.dismiss",
        entityType: "brief_item",
        entityId: updated.id,
        metadataJson: { briefId: updated.briefId, kind: updated.kind },
      });

      return updated;
    },

    /** Snoozes a brief item until `snoozedUntil`, deferring it without losing the context. */
    async snoozeBriefItem(input: SnoozeBriefItemInput): Promise<BriefItem> {
      const item = await requireItem(input);
      const status = resolveBriefItemTransition(item.status, "snooze");

      const updated = await store.updateBriefItem({
        ownerUserId: input.ownerUserId,
        briefItemId: item.id,
        patch: { status, snoozedUntil: input.snoozedUntil },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "brief_item.snooze",
        entityType: "brief_item",
        entityId: updated.id,
        metadataJson: {
          briefId: updated.briefId,
          kind: updated.kind,
          snoozedUntil: input.snoozedUntil.toISOString(),
        },
      });

      return updated;
    },

    /**
     * Marks a brief item acted-on after the real source action has succeeded. This
     * is invoked by the action that owns the source mutation (e.g. suggested
     * follow-up acceptance, issue #71), not as a standalone status flip.
     */
    async markBriefItemActed(input: BriefItemActionInput): Promise<BriefItem> {
      const item = await requireItem(input);
      const status = resolveBriefItemTransition(item.status, "act");

      const updated = await store.updateBriefItem({
        ownerUserId: input.ownerUserId,
        briefItemId: item.id,
        patch: { status, snoozedUntil: null },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "brief_item.act",
        entityType: "brief_item",
        entityId: updated.id,
        metadataJson: { briefId: updated.briefId, kind: updated.kind },
      });

      return updated;
    },
  };
}
