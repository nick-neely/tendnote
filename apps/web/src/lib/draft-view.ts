import type {
  DraftSourceRef,
  DraftSourceRefTrust,
  MessageDraft,
  MessageDraftStatus,
} from "@tendnote/domain";

/**
 * A single grounding line for the review UI. Only the snapshotted label and its
 * trust tier are exposed — never the raw record id (ADR-0028) — so the user sees
 * "Confirmed: Moved to Denver", not a uuid.
 */
export type DraftGroundingView = {
  kind: DraftSourceRef["kind"];
  trust: DraftSourceRefTrust;
  trustLabel: string;
  label: string;
};

/**
 * Serializable, fixed-shape view of a persisted draft for the review surface
 * (issue #78). The component reads these snapshot fields and references the
 * persisted draft by id only for actions; it never treats unpersisted text as the
 * source of truth.
 */
export type DraftView = {
  id: string;
  personId: string;
  status: MessageDraftStatus;
  statusLabel: string;
  channel: string;
  purpose: string;
  body: string;
  // Editable only while the draft is still active (draft or approved).
  editable: boolean;
  grounding: DraftGroundingView[];
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABELS: Record<MessageDraftStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  dismissed: "Dismissed",
  sent_manually: "Sent manually",
};

const TRUST_LABELS: Record<DraftSourceRefTrust, string> = {
  confirmed_fact: "Confirmed",
  logged_context: "You noted",
  tentative: "Unconfirmed",
  intent: "Follow-up",
  entry_point: "Surfaced from",
};

export function toDraftView(draft: MessageDraft): DraftView {
  return {
    id: draft.id,
    personId: draft.personId,
    status: draft.status,
    statusLabel: STATUS_LABELS[draft.status],
    channel: draft.channel,
    purpose: draft.purpose,
    body: draft.body,
    editable: draft.status === "draft" || draft.status === "approved",
    grounding: draft.sourceRefs.map((ref) => ({
      kind: ref.kind,
      trust: ref.trust,
      trustLabel: TRUST_LABELS[ref.trust],
      label: ref.label,
    })),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
