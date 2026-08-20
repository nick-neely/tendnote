import type {
  ContactMethod,
  ContextFact,
  Followup,
  Memory,
  Person,
  SourceRecord,
  SourceRecordPerson,
  UnresolvedPersonMention,
} from "@tendnote/domain";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../client";
import {
  contactMethods,
  contextFacts,
  followups,
  interactions,
  memories,
  people,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "../../schema";
import { archiveEntry } from "./archive";
import type { OwnerDataExportResource } from "./types";

/** The dedicated Interaction table has no domain-level lifecycle type yet. */
export type OwnerDataExportInteraction = {
  id: string;
  personId: string;
  ownerUserId: string;
  interactionType: "call" | "text" | "email" | "meeting" | "hangout" | "note";
  occurredAt: Date;
  summary: string;
  source: "manual" | "agent" | "contact_import" | "calendar" | "gmail" | "seed";
  confidence: "low" | "medium" | "high";
  createdAt: Date;
  updatedAt: Date;
};

export type OwnerDataExportRelationshipContext = {
  people: Person[];
  contactMethods: ContactMethod[];
  memories: Memory[];
  sourceRecords: SourceRecord[];
  sourceRecordPeople: SourceRecordPerson[];
  unresolvedMentions: UnresolvedPersonMention[];
  interactions: OwnerDataExportInteraction[];
  followups: Followup[];
  contextFacts: ContextFact[];
};

export type OwnerDataExportRelationshipContextLoader = (input: {
  ownerUserId: string;
}) => Promise<OwnerDataExportRelationshipContext>;

/**
 * Load the durable relationship graph for one owner. Every person-linked row is
 * joined back to the owner's People rows so an inconsistent or merely shared row
 * cannot turn a visibility read into an export read. This deliberately does not
 * use proactive-view status filters: the archive is portability, not a dashboard.
 */
export async function loadOwnerDataExportRelationshipContext(input: {
  ownerUserId: string;
}): Promise<OwnerDataExportRelationshipContext> {
  const ownerUserId = input.ownerUserId;
  const db = getDb();

  const [
    personRows,
    contactMethodRows,
    memoryRows,
    sourceRecordRows,
    sourceRecordPeopleRows,
    unresolvedMentionRows,
    interactionRows,
    followupRows,
    contextFactRows,
  ] = await Promise.all([
    db.select().from(people).where(eq(people.ownerUserId, ownerUserId)).orderBy(asc(people.id)),
    db
      .select({ contactMethod: contactMethods })
      .from(contactMethods)
      .innerJoin(people, eq(contactMethods.personId, people.id))
      .where(eq(people.ownerUserId, ownerUserId))
      .orderBy(asc(contactMethods.id)),
    db
      .select({ memory: memories })
      .from(memories)
      .innerJoin(people, eq(memories.personId, people.id))
      .where(and(eq(memories.ownerUserId, ownerUserId), eq(people.ownerUserId, ownerUserId)))
      .orderBy(asc(memories.id)),
    db
      .select()
      .from(sourceRecords)
      .where(eq(sourceRecords.ownerUserId, ownerUserId))
      .orderBy(asc(sourceRecords.id)),
    db
      .select({ link: sourceRecordPeople })
      .from(sourceRecordPeople)
      .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
      .innerJoin(people, eq(sourceRecordPeople.personId, people.id))
      .where(and(eq(sourceRecords.ownerUserId, ownerUserId), eq(people.ownerUserId, ownerUserId)))
      .orderBy(asc(sourceRecordPeople.id)),
    db
      .select({ mention: unresolvedPersonMentions })
      .from(unresolvedPersonMentions)
      .innerJoin(sourceRecords, eq(unresolvedPersonMentions.sourceRecordId, sourceRecords.id))
      .where(eq(sourceRecords.ownerUserId, ownerUserId))
      .orderBy(asc(unresolvedPersonMentions.id)),
    db
      .select({ interaction: interactions })
      .from(interactions)
      .innerJoin(people, eq(interactions.personId, people.id))
      .where(and(eq(interactions.ownerUserId, ownerUserId), eq(people.ownerUserId, ownerUserId)))
      .orderBy(asc(interactions.id)),
    db
      .select({ followup: followups })
      .from(followups)
      .innerJoin(people, eq(followups.personId, people.id))
      .where(and(eq(followups.ownerUserId, ownerUserId), eq(people.ownerUserId, ownerUserId)))
      .orderBy(asc(followups.id)),
    db
      .select()
      .from(contextFacts)
      .where(and(eq(contextFacts.subjectKind, "self"), eq(contextFacts.subjectUserId, ownerUserId)))
      .orderBy(asc(contextFacts.id)),
  ]);

  return {
    people: personRows,
    contactMethods: contactMethodRows.map((row) => row.contactMethod),
    memories: memoryRows.map((row) => row.memory),
    sourceRecords: sourceRecordRows,
    sourceRecordPeople: sourceRecordPeopleRows.map((row) => row.link),
    unresolvedMentions: unresolvedMentionRows.map((row) => row.mention),
    interactions: interactionRows.map((row) => row.interaction),
    followups: followupRows.map((row) => row.followup),
    contextFacts: contextFactRows.map((row) => ({
      id: row.id,
      subject:
        row.subjectKind === "self"
          ? { kind: "self" as const, userId: row.subjectUserId as string }
          : { kind: "household" as const, householdId: row.subjectHouseholdId as string },
      category: row.category,
      content: row.content,
      lifecycle: row.lifecycle,
      sensitivity: row.sensitivity,
      provenance: row.provenanceJson,
      suggestionEvidence: row.suggestionEvidence,
      creatorUserId: row.creatorUserId,
      lastActorUserId: row.lastActorUserId,
      reviewedAt: row.reviewedAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  };
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function jsonBytes(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function recordSensitivity(records: readonly { sensitivity?: string }[]) {
  if (records.some((record) => record.sensitivity === "restricted")) return "restricted" as const;
  if (records.some((record) => record.sensitivity === "sensitive")) return "sensitive" as const;
  return "normal" as const;
}

function envelope<T>(records: readonly T[]) {
  return { schemaVersion: "1.0", records };
}

function entry<T>(
  path: string,
  records: readonly T[],
  sensitivity?: OwnerDataExportResource["sensitivity"],
) {
  const bytes = jsonBytes(envelope(records));
  return {
    entry: archiveEntry({ path, bytes }),
    resource: {
      path,
      schemaVersion: "1.0",
      contentType: "application/json" as const,
      recordCount: records.length,
      byteCount: bytes.byteLength,
      ...(sensitivity ? { sensitivity } : {}),
    },
  };
}

function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Defense-in-depth owner filter for callers that already loaded a graph. The
 * database loader is owner-scoped too; keeping this pure filter at the archive
 * seam makes the generated ZIP safe even when a fixture or future adapter hands
 * it a broader candidate set.
 */
export function filterOwnerDataExportRelationshipContext(
  ownerUserId: string,
  input: OwnerDataExportRelationshipContext,
): OwnerDataExportRelationshipContext {
  const ownedPeople = sortById(input.people.filter((person) => person.ownerUserId === ownerUserId));
  const personIds = new Set(ownedPeople.map((person) => person.id));
  const ownedSourceRecords = sortById(
    input.sourceRecords.filter((record) => record.ownerUserId === ownerUserId),
  );
  const sourceRecordIds = new Set(ownedSourceRecords.map((record) => record.id));

  return {
    people: ownedPeople,
    contactMethods: sortById(
      input.contactMethods.filter((method) => personIds.has(method.personId)),
    ),
    memories: sortById(
      input.memories.filter(
        (memory) => memory.ownerUserId === ownerUserId && personIds.has(memory.personId),
      ),
    ),
    sourceRecords: ownedSourceRecords,
    sourceRecordPeople: sortById(
      input.sourceRecordPeople.filter(
        (link) => sourceRecordIds.has(link.sourceRecordId) && personIds.has(link.personId),
      ),
    ),
    unresolvedMentions: sortById(
      input.unresolvedMentions.filter((mention) => sourceRecordIds.has(mention.sourceRecordId)),
    ),
    interactions: sortById(
      input.interactions.filter(
        (interaction) =>
          interaction.ownerUserId === ownerUserId && personIds.has(interaction.personId),
      ),
    ),
    followups: sortById(
      input.followups.filter(
        (followup) => followup.ownerUserId === ownerUserId && personIds.has(followup.personId),
      ),
    ),
    contextFacts: sortById(
      input.contextFacts.filter(
        (fact) => fact.subject.kind === "self" && fact.subject.userId === ownerUserId,
      ),
    ),
  };
}

function sourceRecordForExport(record: SourceRecord) {
  // `content` is Retained Content. `rawContent` is deliberately omitted because
  // it is short-lived/provider-shaped input rather than the canonical evidence.
  return {
    id: record.id,
    ownerUserId: record.ownerUserId,
    householdId: record.householdId ?? null,
    sourceType: record.sourceType,
    content: record.content,
    retentionPolicy: record.retentionPolicy,
    status: record.status,
    confidence: record.confidence,
    sensitivity: record.sensitivity,
    scope: record.scope,
    importance: record.importance,
    // Keep only the durable capture surface. Provider/session hashes, provider
    // ids, and extraction linkage are operational state rather than portable
    // source truth and must not cross the export boundary.
    metadataJson: durableSourceRecordMetadata(record.metadataJson),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

function durableSourceRecordMetadata(metadata: Record<string, unknown>) {
  return typeof metadata.captureSurface === "string"
    ? { captureSurface: metadata.captureSurface }
    : {};
}

function personForExport(person: Person) {
  return {
    id: person.id,
    ownerUserId: person.ownerUserId,
    displayName: person.displayName,
    firstName: person.firstName,
    lastName: person.lastName,
    birthday: person.birthday,
    relationshipType: person.relationshipType,
    closenessLevel: person.closenessLevel,
    profileBlurb: person.profileBlurb,
    source: person.source,
    createdAt: iso(person.createdAt),
    updatedAt: iso(person.updatedAt),
  };
}

function contactMethodForExport(method: ContactMethod) {
  return {
    ...method,
    createdAt: iso(method.createdAt),
    updatedAt: iso(method.updatedAt),
  };
}

function memoryForExport(memory: Memory, sourceRecordIds: ReadonlySet<string>) {
  if (!sourceRecordIds.has(memory.sourceRecordId)) {
    throw new Error(
      `Owner data export memory ${memory.id} references source record ${memory.sourceRecordId} outside the owner export.`,
    );
  }

  return {
    id: memory.id,
    personId: memory.personId,
    ownerUserId: memory.ownerUserId,
    householdId: memory.householdId ?? null,
    sourceRecordId: memory.sourceRecordId,
    memoryType: memory.memoryType,
    content: memory.content,
    status: memory.status,
    importance: memory.importance,
    sensitivity: memory.sensitivity,
    confidence: memory.confidence,
    scope: memory.scope,
    approvedAt: iso(memory.approvedAt),
    dismissedAt: iso(memory.dismissedAt),
    createdAt: iso(memory.createdAt),
    updatedAt: iso(memory.updatedAt),
  };
}

function interactionForExport(interaction: OwnerDataExportInteraction) {
  return {
    ...interaction,
    occurredAt: iso(interaction.occurredAt),
    createdAt: iso(interaction.createdAt),
    updatedAt: iso(interaction.updatedAt),
  };
}

function followupForExport(followup: Followup, sourceRecordIds: ReadonlySet<string>) {
  return {
    ...followup,
    sourceRecordId:
      followup.sourceRecordId && sourceRecordIds.has(followup.sourceRecordId)
        ? followup.sourceRecordId
        : null,
    dueAt: iso(followup.dueAt),
    lastPromptedAt: iso(followup.lastPromptedAt),
    createdAt: iso(followup.createdAt),
    updatedAt: iso(followup.updatedAt),
  };
}

function contextFactForExport(fact: ContextFact, sourceRecordIds: ReadonlySet<string>) {
  return {
    id: fact.id,
    subject: fact.subject,
    category: fact.category,
    content: fact.content,
    lifecycle: fact.lifecycle,
    sensitivity: fact.sensitivity,
    provenance: {
      ...fact.provenance,
      sourceRecordId:
        fact.provenance.sourceRecordId && sourceRecordIds.has(fact.provenance.sourceRecordId)
          ? fact.provenance.sourceRecordId
          : null,
    },
    suggestionEvidence: fact.suggestionEvidence,
    creatorUserId: fact.creatorUserId,
    lastActorUserId: fact.lastActorUserId,
    reviewedAt: iso(fact.reviewedAt),
    archivedAt: iso(fact.archivedAt),
    createdAt: iso(fact.createdAt),
    updatedAt: iso(fact.updatedAt),
  };
}

function unresolvedMentionForExport(
  mention: UnresolvedPersonMention,
  personIds: ReadonlySet<string>,
) {
  return {
    ...mention,
    candidatePersonIds: mention.candidatePersonIds.filter((personId) => personIds.has(personId)),
    resolvedPersonId:
      mention.resolvedPersonId && personIds.has(mention.resolvedPersonId)
        ? mention.resolvedPersonId
        : null,
    createdAt: iso(mention.createdAt),
    resolvedAt: iso(mention.resolvedAt),
  };
}

export type OwnerDataExportArchiveExtension = {
  entries: ReturnType<typeof archiveEntry>[];
  resources: OwnerDataExportResource[];
  families: string[];
  /**
   * The exact owner-filtered ids represented by this extension. Downstream
   * export families use this graph as their authoritative grounding boundary
   * instead of trusting a broader loader/adaptor candidate set.
   */
  grounding: {
    sourceRecordIds: string[];
    personIds: string[];
    memoryIds: string[];
    followupIds: string[];
    sensitivityByRecordId: Record<string, "normal" | "sensitive" | "restricted">;
  };
};

/** Convert the graph into stable, versioned JSON resources for the ZIP builder. */
export function ownerDataExportRelationshipContextExtension(
  ownerUserId: string,
  input: OwnerDataExportRelationshipContext,
): OwnerDataExportArchiveExtension {
  const context = filterOwnerDataExportRelationshipContext(ownerUserId, input);
  const sourceRecordIds = new Set(context.sourceRecords.map((record) => record.id));
  const peopleResource = entry(
    "resources/people/people-v1.json",
    context.people.map(personForExport),
  );
  const contactMethodsResource = entry(
    "resources/people/contact-methods-v1.json",
    context.contactMethods.map(contactMethodForExport),
  );
  const memoriesResource = entry(
    "resources/relationship/memories-v1.json",
    context.memories.map((memory) => memoryForExport(memory, sourceRecordIds)),
    recordSensitivity(context.memories),
  );
  const sourceRecordsResource = entry(
    "resources/relationship/source-records-v1.json",
    context.sourceRecords.map(sourceRecordForExport),
    recordSensitivity(context.sourceRecords),
  );
  const sourceRecordPeopleResource = entry(
    "resources/relationship/source-record-people-v1.json",
    context.sourceRecordPeople,
  );
  const interactionsResource = entry(
    "resources/relationship/interactions-v1.json",
    context.interactions.map(interactionForExport),
  );
  const followupsResource = entry(
    "resources/relationship/follow-ups-v1.json",
    context.followups.map((followup) => followupForExport(followup, sourceRecordIds)),
  );
  const contextFactsResource = entry(
    "resources/context/context-facts-v1.json",
    context.contextFacts.map((fact) => contextFactForExport(fact, sourceRecordIds)),
    recordSensitivity(context.contextFacts),
  );
  const unresolvedMentionsResource = entry(
    "resources/relationship/unresolved-person-mentions-v1.json",
    context.unresolvedMentions.map((mention) =>
      unresolvedMentionForExport(mention, new Set(context.people.map((person) => person.id))),
    ),
  );
  const resources = [
    peopleResource,
    contactMethodsResource,
    memoriesResource,
    sourceRecordsResource,
    sourceRecordPeopleResource,
    unresolvedMentionsResource,
    interactionsResource,
    followupsResource,
    contextFactsResource,
  ];

  return {
    entries: resources.map((resource) => resource.entry),
    resources: resources.map((resource) => resource.resource),
    families: [
      "People",
      "Contact Methods",
      "Memories",
      "Source Records",
      "Interactions",
      "Follow-Ups",
      "Self Context",
    ],
    grounding: {
      sourceRecordIds: context.sourceRecords.map((record) => record.id),
      personIds: context.people.map((person) => person.id),
      memoryIds: context.memories.map((memory) => memory.id),
      followupIds: context.followups.map((followup) => followup.id),
      sensitivityByRecordId: Object.fromEntries([
        ...context.sourceRecords.map((record) => [record.id, record.sensitivity] as const),
        ...context.memories.map((memory) => [memory.id, memory.sensitivity] as const),
      ]),
    },
  };
}
