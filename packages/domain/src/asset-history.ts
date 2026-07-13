import type { AssetAuditEvent } from "./assets";
import type { GeneralActionEvent, GeneralActionEventKind } from "./general-actions";

/**
 * User-facing Asset History (#202): a derived, read-only story of what happened
 * with an Asset, composed from records that already exist — the asset's own
 * lifecycle (from the internal audit trail), reviewed Asset Memories, and the
 * lifecycle history of the General Actions linked to it. Never a separate
 * maintenance-log source of truth (#196): General Action lifecycle stays the one
 * source for action-derived history, and this module only merges and filters.
 */

/** The asset-lifecycle moments history surfaces: added (created or accepted), archived, restored. */
export type AssetHistoryAssetEvent = "added" | "archived" | "restored";

// Audit kinds that surface in user-facing history, and what they read as. The
// rest of the audit trail (edits, memory/evidence/link writes, proposal churn)
// stays internal-first (#196) — memories tell their own story below, and
// evidence/links are visible live on the profile.
const ASSET_EVENT_FOR_AUDIT_KIND: Partial<Record<AssetAuditEvent["kind"], AssetHistoryAssetEvent>> =
  {
    created: "added",
    // An accepted proposal became real at `promoted` — its `suggested` event is
    // review provenance, not the asset existing.
    promoted: "added",
    archived: "archived",
    restored: "restored",
  };

/** The linked-action moments history keeps; deferrals/pauses/edits stay on the action. */
const ACTION_HISTORY_KINDS = new Set<GeneralActionEventKind>([
  "created",
  "completed",
  "reopened",
  "dismissed",
  "archived",
]);

export type AssetHistoryEntry =
  | { id: string; type: "asset"; at: Date; event: AssetHistoryAssetEvent }
  | { id: string; type: "memory"; at: Date; memoryId: string; label: string }
  | {
      id: string;
      type: "action";
      at: Date;
      actionId: string;
      actionTitle: string;
      event: GeneralActionEventKind;
    };

/** One visible linked action with its lifecycle events, as history composes it. */
export type AssetHistoryActionSource = {
  action: { id: string; title: string };
  events: ReadonlyArray<Pick<GeneralActionEvent, "id" | "kind" | "createdAt">>;
};

export type ComposeAssetHistoryInput = {
  /** The asset's internal audit trail; only user-facing lifecycle kinds surface. */
  auditEvents: ReadonlyArray<Pick<AssetAuditEvent, "id" | "kind" | "createdAt">>;
  /** The reviewed (active) memories the caller may see — already scope-filtered. */
  memories: ReadonlyArray<{ id: string; label: string; createdAt: Date }>;
  /** Each visible linked action with its lifecycle events, already scope-filtered. */
  actions: ReadonlyArray<AssetHistoryActionSource>;
  /** Optional cap, applied after the newest-first merge. */
  limit?: number;
};

/**
 * Merges the three history sources into one newest-first, deterministic list.
 * Pure composition: inputs must already be loaded and scope-filtered by the
 * query layer, so this function never widens what a caller can see.
 */
export function composeAssetHistory(input: ComposeAssetHistoryInput): AssetHistoryEntry[] {
  // Insertion order doubles as the tiebreak: each source arrives oldest-first
  // (the store ordering contracts), so same-instant events — an archive and
  // restore in one burst — still read newest-first after the sort.
  const entries: AssetHistoryEntry[] = [];
  const sequence = new Map<string, number>();
  const push = (entry: AssetHistoryEntry) => {
    sequence.set(entry.id, entries.length);
    entries.push(entry);
  };

  for (const event of input.auditEvents) {
    const mapped = ASSET_EVENT_FOR_AUDIT_KIND[event.kind];
    if (mapped) {
      push({ id: `asset-${event.id}`, type: "asset", at: event.createdAt, event: mapped });
    }
  }

  for (const memory of input.memories) {
    push({
      id: `memory-${memory.id}`,
      type: "memory",
      at: memory.createdAt,
      memoryId: memory.id,
      label: memory.label,
    });
  }

  for (const { action, events } of input.actions) {
    for (const event of events) {
      if (ACTION_HISTORY_KINDS.has(event.kind)) {
        push({
          id: `action-${event.id}`,
          type: "action",
          at: event.createdAt,
          actionId: action.id,
          actionTitle: action.title,
          event: event.kind,
        });
      }
    }
  }

  // Newest first; reverse insertion order breaks same-instant ties, so an
  // oldest-first source trail always reads back newest-first.
  entries.sort(
    (a, b) =>
      b.at.getTime() - a.at.getTime() || (sequence.get(b.id) ?? 0) - (sequence.get(a.id) ?? 0),
  );
  return input.limit === undefined ? entries : entries.slice(0, input.limit);
}
