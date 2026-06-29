import { createHash } from "node:crypto";
import { z } from "zod";
import { ACTIVE_FOLLOWUP_STATUSES, type Followup, followupStatusSchema } from "./followups";
import type { Memory } from "./memories";
import type { Person } from "./people";
import type { SourceRecord } from "./source-records";

/**
 * Record-level supporting references for a context snapshot. Phase 1B grounds
 * generated prose with the IDs of the records it was built from rather than
 * sentence-level citations (ADR 0009). Consumers fetch the underlying records
 * before making specific claims or drafts.
 */
export const snapshotSupportingReferencesSchema = z.object({
  personIds: z.array(z.string()).default([]),
  memoryIds: z.array(z.string()).default([]),
  sourceRecordIds: z.array(z.string()).default([]),
  suggestedMemoryIds: z.array(z.string()).default([]),
  followupIds: z.array(z.string()).default([]),
});

/**
 * A compact contextual follow-up reference. Carries only enough to orient the
 * user — id, status, due date, and reason — so the snapshot can reflect active
 * or recently completed reminders without becoming a reminder feed or scheduling
 * model. Follow-up lifecycle stays owned by follow-up records, not the snapshot
 * cache (ADR 0009; statuses defined by ADR 0007).
 */
export const compactFollowupReferenceSchema = z.object({
  id: z.string(),
  status: followupStatusSchema,
  dueAt: z.string(),
  reason: z.string(),
});

/**
 * A context snapshot is a rebuildable cache row, not a source of truth (ADR
 * 0009). It stores generated summary prose plus record-level supporting
 * references, compact follow-up context, and operational cache metadata
 * (generation time, generator version, input fingerprint, optional failure
 * detail). One current row per owner/person.
 */
export const contextSnapshotSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  personId: z.string(),
  summary: z.string(),
  supportingReferences: snapshotSupportingReferencesSchema,
  followups: z.array(compactFollowupReferenceSchema).default([]),
  generatorVersion: z.string().min(1),
  inputFingerprint: z.string().min(1),
  generatedAt: z.date(),
  failureReason: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createContextSnapshotSchema = contextSnapshotSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SnapshotSupportingReferences = z.infer<typeof snapshotSupportingReferencesSchema>;
export type CompactFollowupReference = z.infer<typeof compactFollowupReferenceSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type CreateContextSnapshotInput = z.infer<typeof createContextSnapshotSchema>;

/**
 * The trusted input pack handed to a snapshot generator. The builder owns
 * loading these inputs, applying policy filters, and owner scoping; a generator
 * only turns this pack into prose and references (ADR 0009, PRD #11). Follow-ups
 * are the snapshot-eligible ones (active or recently completed) the builder
 * selected — see {@link selectSnapshotFollowups}.
 */
export type SnapshotInputPack = {
  person: Person;
  approvedMemories: Memory[];
  sourceRecords: SourceRecord[];
  suggestedMemories: Memory[];
  followups: Followup[];
};

/**
 * How long a completed follow-up stays useful as relationship context before it
 * drops out of the snapshot. Keeps "recently completed" bounded so the card does
 * not accumulate history (PRD #11: snapshots are not a reminder feed).
 */
export const RECENTLY_COMPLETED_FOLLOWUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Selects the follow-ups eligible to appear as compact snapshot context: active
 * reminders (open or snoozed) plus follow-ups completed within the recent window.
 * Suggested, dismissed, and archived follow-ups are excluded — suggested ones are
 * tentative review items, the rest are not relationship context (ADR 0006, ADR
 * 0007, PRD #11). Deterministic given `now`, so eligibility is testable without
 * a store.
 */
export function selectSnapshotFollowups(followups: Followup[], now: Date = new Date()): Followup[] {
  const recentCutoff = now.getTime() - RECENTLY_COMPLETED_FOLLOWUP_WINDOW_MS;

  return followups
    .filter((followup) => {
      if (ACTIVE_FOLLOWUP_STATUSES.has(followup.status)) {
        return true;
      }

      return followup.status === "completed" && followup.updatedAt.getTime() >= recentCutoff;
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}

/**
 * Compact follow-up references for the snapshot: id, status, due date, and reason
 * only. The builder owns this so the snapshot reflects reminders without copying
 * follow-up lifecycle into the cache (PRD #11).
 */
export function collectCompactFollowups(input: SnapshotInputPack): CompactFollowupReference[] {
  return input.followups.map((followup) => ({
    id: followup.id,
    status: followup.status,
    dueAt: followup.dueAt.toISOString(),
    reason: followup.reason,
  }));
}

/**
 * A generator's only output: the snapshot prose and the version tag identifying
 * what actually produced it (a deterministic tag or a model identifier). Each
 * generator declares its own version so persisted provenance always matches the
 * real producer — even when an adapter falls back internally. Record-level
 * supporting references and all policy/freshness/persistence decisions stay with
 * the shared builder, so swapping generators cannot change what the snapshot
 * grounds on (ADR 0009, PRD #11).
 */
export type SnapshotProse = {
  summary: string;
  generatorVersion: string;
};

/** Version tag for the deterministic generator (ADR 0009 operational metadata). */
export const DETERMINISTIC_GENERATOR_VERSION = "deterministic-v1";

/**
 * Record-level supporting references for a snapshot, derived straight from the
 * policy-filtered input pack. The builder owns this so references are never a
 * generator (or model) decision (PRD #11, ADR 0009).
 */
export function collectSnapshotReferences(input: SnapshotInputPack): SnapshotSupportingReferences {
  return {
    personIds: [input.person.id],
    memoryIds: input.approvedMemories.map((memory) => memory.id),
    sourceRecordIds: input.sourceRecords.map((sourceRecord) => sourceRecord.id),
    suggestedMemoryIds: input.suggestedMemories.map((memory) => memory.id),
    followupIds: input.followups.map((followup) => followup.id),
  };
}

/**
 * Deterministic snapshot generator. Serves as the Phase 1B fallback and the
 * generator used in tests and on LLM failure (ADR 0009, PRD #11). It keeps the
 * trust model intact: approved memories read as confirmed facts, source records
 * stay logged context ("you noted"), and suggested memories are never stated as
 * facts in the prose — they survive only as supporting references for review.
 */
export function generateDeterministicSnapshot(input: SnapshotInputPack): SnapshotProse {
  const { person, approvedMemories, sourceRecords } = input;
  const lines: string[] = [];

  lines.push(`${person.displayName} is a ${person.relationshipType} relationship.`);

  if (person.profileBlurb) {
    lines.push(person.profileBlurb);
  }

  if (approvedMemories.length > 0) {
    lines.push(`Confirmed: ${approvedMemories.map((memory) => memory.content).join(" ")}`);
  }

  if (sourceRecords.length > 0) {
    lines.push(`You noted: ${sourceRecords.map((sourceRecord) => sourceRecord.content).join(" ")}`);
  }

  return { summary: lines.join("\n"), generatorVersion: DETERMINISTIC_GENERATOR_VERSION };
}

/**
 * Builds the prompt handed to an LLM snapshot generator. Pure and testable so the
 * generator contract can be verified without a model. It carries the trust framing
 * into the prompt: confirmed facts (approved memories) and logged context worded
 * as "you noted" (source records). Grounding outranks tone, and the requested
 * length scales to the available facts, so a single fact yields a sentence rather
 * than an embellished paragraph (the model must not invent feelings or significance).
 *
 * Suggested-memory content is deliberately excluded from the prompt, matching the
 * deterministic generator's hard exclusion (ADR 0009: suggested memories belong in
 * separated review hints / supporting references only). Keeping their text out of
 * the prompt is a hard guarantee rather than trusting the model not to promote a
 * tentative observation to a fact.
 *
 * Follow-ups are not put in the prompt either: they ride along as compact
 * structured references (see {@link collectCompactFollowups}) so the snapshot
 * reflects reminders without the prose becoming a reminder feed (PRD #11).
 */
export function buildSnapshotPrompt(input: SnapshotInputPack): string {
  const { person, approvedMemories, sourceRecords } = input;
  const sections: string[] = [
    "Write a brief, grounded relationship snapshot that helps the user remember this person.",
    "Use only the facts provided below. State confirmed facts plainly. Frame logged",
    'context as "you noted".',
    "",
    // The "warm + 1-3 paragraphs" framing used to coax embellishment out of weaker
    // models: with only one or two facts the model would pad to fill the paragraph
    // quota, inventing feelings, routines, and significance the facts never stated.
    // Grounding now outranks tone and length scales to the available facts, matching
    // the anti-confabulation rules the draft and extraction prompts already enforce.
    "Grounding rules (these override tone and length):",
    "- Report only what the facts state. Do not infer, embellish, or invent feelings,",
    "  routines, backstory, motivations, or significance that is not explicitly given.",
    "- Do not narrate what the relationship 'means' or how it feels. This is a note to",
    "  self, not a greeting card or a story. Avoid sentimentality. If a fact is just a",
    "  fact, state it and stop.",
    "",
    "Length (match the amount of information — never pad):",
    "- One or two facts: write one or two plain sentences. Do not stretch them into a",
    "  paragraph.",
    "- Only add a second short paragraph when several distinct facts genuinely need it.",
    "  Never exceed three short paragraphs.",
    "",
    // The card and page header already show the person's name and relationship, and
    // the card renders the summary as plain text (it does not parse Markdown). Ask
    // for clean prose with no Markdown and no restated header, so formatting tokens
    // and duplicated name/role lines never leak into the rendered card. A
    // display-time sanitizer (web) is the safety net for when the model ignores this.
    "Formatting rules:",
    "- Plain prose only. No Markdown of any kind: no headings (#), bold/italic (* or _),",
    "  lists, links, code, or block quotes.",
    "- Do not start with or repeat the person's name, relationship, or role as a",
    "  title or label line — those are already shown above the snapshot.",
    "",
    `Person: ${person.displayName} (${person.relationshipType}, closeness ${person.closenessLevel}).`,
  ];

  if (person.profileBlurb) {
    sections.push(`Profile note: ${person.profileBlurb}`);
  }

  sections.push(
    "",
    "Confirmed facts (approved memories):",
    approvedMemories.length > 0
      ? approvedMemories.map((memory) => `- ${memory.content}`).join("\n")
      : "- none",
    "",
    "Logged context (source records, phrase as 'you noted'):",
    sourceRecords.length > 0
      ? sourceRecords.map((sourceRecord) => `- ${sourceRecord.content}`).join("\n")
      : "- none",
  );

  return sections.join("\n");
}

/**
 * Deterministic, record-driven fingerprint of a snapshot's inputs. Built from
 * the person profile fields plus the ids and update times of every visible
 * record, so staleness can be detected by comparing fingerprints without
 * depending on a generator run (ADR 0009; staleness consumed in #13).
 */
export function computeSnapshotFingerprint(input: SnapshotInputPack): string {
  const { person } = input;
  const parts: string[] = [
    "person",
    person.id,
    person.displayName,
    person.relationshipType,
    String(person.closenessLevel),
    person.birthday ?? "",
    person.profileBlurb ?? "",
    person.updatedAt.toISOString(),
  ];

  // Include record content alongside id/updatedAt so a correction to a record's
  // text always flips the snapshot stale, even if the caller does not (or cannot,
  // within timestamp resolution) bump updatedAt (PRD #11; correction coverage #19).
  const addRecords = (
    label: string,
    records: Array<{ id: string; updatedAt: Date; content: string }>,
  ) => {
    parts.push(label);
    for (const record of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
      parts.push(record.id, record.updatedAt.toISOString(), record.content);
    }
  };

  addRecords("approved", input.approvedMemories);
  addRecords("sources", input.sourceRecords);
  addRecords("suggested", input.suggestedMemories);
  // Include follow-up status, due date, and reason so opening, snoozing,
  // completing, rescheduling, or re-wording a relevant follow-up flips the
  // snapshot stale and refreshes its compact reference (PRD #11).
  parts.push("followups");
  for (const followup of [...input.followups].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(followup.id, followup.status, followup.dueAt.toISOString(), followup.reason);
  }

  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
