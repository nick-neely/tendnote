import type { ContextFactView } from "@tendnote/domain";

/** JSON-safe exact fact shape shared by Self Context Eve read and mutation tools. */
export function toSelfContextFactToolView(fact: ContextFactView) {
  return {
    id: fact.id,
    subject: fact.subject,
    category: fact.category,
    content: fact.content,
    lifecycle: fact.lifecycle,
    sensitivity: fact.sensitivity,
    provenance: fact.provenance,
    reviewedAt: fact.reviewedAt?.toISOString() ?? null,
    archivedAt: fact.archivedAt?.toISOString() ?? null,
    createdAt: fact.createdAt.toISOString(),
    updatedAt: fact.updatedAt.toISOString(),
    trust: fact.trust,
    authority: fact.authority,
    visibility: fact.visibility,
  };
}
