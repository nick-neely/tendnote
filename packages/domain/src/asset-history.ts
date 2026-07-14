import type { AssetEvidenceKind } from "./asset-evidence";
import type { AssetLinkRelation, AssetPersonRelation } from "./asset-links";
import type { AssetAuditEvent } from "./assets";
import type { GeneralActionEvent, GeneralActionEventKind } from "./general-actions";

/**
 * User-facing Asset History (#202): a derived, read-only story of what happened
 * with an Asset, composed from records that already exist — the asset's own
 * lifecycle (from the internal audit trail), reviewed Asset Memories, captured
 * Evidence, the context links it carries, and the lifecycle history of the
 * General Actions linked to it. Never a separate maintenance-log source of truth
 * (#196): General Action lifecycle stays the one source for action-derived
 * history, and this module only merges and filters.
 *
 * History is composed from the *records themselves*, not from the audit trail's
 * detail, for two reasons: the audit trail is owner-keyed (an asset's whole
 * trail, private children included), so retelling it would leak a co-member's
 * private evidence label through a household asset; and the records the caller
 * can see are exactly the story the caller is entitled to. The trade is that a
 * removed record leaves no "removed" moment behind — history says what is true
 * of this asset, in the order it became true, the same way memories always have.
 */

/** The asset-lifecycle moments history surfaces: added (created or accepted), archived, restored. */
export type AssetHistoryAssetEvent = "added" | "archived" | "restored";

// Audit kinds that surface in user-facing history, and what they read as. The
// rest of the audit trail (edits, child-record writes, proposal churn) stays
// internal-first (#196) — the records themselves tell those stories below.
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
      type: "evidence";
      at: Date;
      evidenceId: string;
      kind: AssetEvidenceKind;
      label: string;
    }
  | {
      id: string;
      type: "asset-link";
      at: Date;
      linkId: string;
      otherAssetId: string;
      otherAssetName: string;
      relation: AssetLinkRelation;
      /** Which end this asset reads the link from — the sentence's direction. */
      direction: "outgoing" | "incoming";
    }
  | {
      id: string;
      type: "person-link";
      at: Date;
      linkId: string;
      personId: string;
      displayName: string;
      relation: AssetPersonRelation;
    }
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

/** One confirmed Related Asset Link, already resolved from this asset's side. */
export type AssetHistoryLinkSource = {
  linkId: string;
  relation: AssetLinkRelation;
  direction: "outgoing" | "incoming";
  otherAsset: { id: string; name: string };
  createdAt: Date;
};

/** One Asset Person Link, already named through the caller's own person record. */
export type AssetHistoryPersonLinkSource = {
  linkId: string;
  relation: AssetPersonRelation;
  person: { id: string; displayName: string };
  createdAt: Date;
};

export type ComposeAssetHistoryInput = {
  /** The asset's internal audit trail; only user-facing lifecycle kinds surface. */
  auditEvents: ReadonlyArray<Pick<AssetAuditEvent, "id" | "kind" | "createdAt">>;
  /** The reviewed (active) memories the caller may see — already scope-filtered. */
  memories: ReadonlyArray<{ id: string; label: string; createdAt: Date }>;
  /** The evidence the caller may see — already scope-filtered. */
  evidence: ReadonlyArray<{
    id: string;
    label: string;
    kind: AssetEvidenceKind;
    createdAt: Date;
  }>;
  /** Confirmed Related Asset Links only — a pending suggestion is not yet a moment. */
  assetLinks: ReadonlyArray<AssetHistoryLinkSource>;
  /** The caller's own person links — people are owner-private records. */
  personLinks: ReadonlyArray<AssetHistoryPersonLinkSource>;
  /** Each visible linked action with its lifecycle events, already scope-filtered. */
  actions: ReadonlyArray<AssetHistoryActionSource>;
  /** Optional cap, applied after the newest-first merge. */
  limit?: number;
};

/** Appends one composed entry, remembering the order it arrived in. */
type PushHistoryEntry = (entry: AssetHistoryEntry) => void;

function pushAssetEvents(
  auditEvents: ComposeAssetHistoryInput["auditEvents"],
  push: PushHistoryEntry,
) {
  for (const event of auditEvents) {
    const mapped = ASSET_EVENT_FOR_AUDIT_KIND[event.kind];
    if (mapped) {
      push({ id: `asset-${event.id}`, type: "asset", at: event.createdAt, event: mapped });
    }
  }
}

function pushMemories(memories: ComposeAssetHistoryInput["memories"], push: PushHistoryEntry) {
  for (const memory of memories) {
    push({
      id: `memory-${memory.id}`,
      type: "memory",
      at: memory.createdAt,
      memoryId: memory.id,
      label: memory.label,
    });
  }
}

function pushEvidence(evidence: ComposeAssetHistoryInput["evidence"], push: PushHistoryEntry) {
  for (const record of evidence) {
    push({
      id: `evidence-${record.id}`,
      type: "evidence",
      at: record.createdAt,
      evidenceId: record.id,
      kind: record.kind,
      label: record.label,
    });
  }
}

function pushAssetLinks(
  assetLinks: ComposeAssetHistoryInput["assetLinks"],
  push: PushHistoryEntry,
) {
  for (const link of assetLinks) {
    push({
      id: `asset-link-${link.linkId}`,
      type: "asset-link",
      at: link.createdAt,
      linkId: link.linkId,
      otherAssetId: link.otherAsset.id,
      otherAssetName: link.otherAsset.name,
      relation: link.relation,
      direction: link.direction,
    });
  }
}

function pushPersonLinks(
  personLinks: ComposeAssetHistoryInput["personLinks"],
  push: PushHistoryEntry,
) {
  for (const link of personLinks) {
    push({
      id: `person-link-${link.linkId}`,
      type: "person-link",
      at: link.createdAt,
      linkId: link.linkId,
      personId: link.person.id,
      displayName: link.person.displayName,
      relation: link.relation,
    });
  }
}

function pushActionEvents(actions: ComposeAssetHistoryInput["actions"], push: PushHistoryEntry) {
  for (const { action, events } of actions) {
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
}

/**
 * Merges every history source into one newest-first, deterministic list. Pure
 * composition: inputs must already be loaded and scope-filtered by the query
 * layer, so this function never widens what a caller can see.
 */
export function composeAssetHistory(input: ComposeAssetHistoryInput): AssetHistoryEntry[] {
  // Insertion order doubles as the tiebreak: each source arrives oldest-first
  // (the store ordering contracts), so same-instant events — an archive and
  // restore in one burst — still read newest-first after the sort.
  const entries: AssetHistoryEntry[] = [];
  const sequence = new Map<string, number>();
  const push: PushHistoryEntry = (entry) => {
    sequence.set(entry.id, entries.length);
    entries.push(entry);
  };

  pushAssetEvents(input.auditEvents, push);
  pushMemories(input.memories, push);
  pushEvidence(input.evidence, push);
  pushAssetLinks(input.assetLinks, push);
  pushPersonLinks(input.personLinks, push);
  pushActionEvents(input.actions, push);

  // Newest first; reverse insertion order breaks same-instant ties, so an
  // oldest-first source trail always reads back newest-first.
  entries.sort(
    (a, b) =>
      b.at.getTime() - a.at.getTime() || (sequence.get(b.id) ?? 0) - (sequence.get(a.id) ?? 0),
  );
  return input.limit === undefined ? entries : entries.slice(0, input.limit);
}
