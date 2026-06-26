import {
  type ContextSnapshot,
  collectCompactFollowups,
  collectSnapshotReferences,
  computeSnapshotFingerprint,
  generateDeterministicSnapshot,
  type SnapshotInputPack,
  type SnapshotProse,
  selectSnapshotFollowups,
} from "@tendnote/domain";
import { createPersonContext, type PersonContextResult } from "../person-context";
import type { PersonContextSnapshotStore } from "./types";

export type GetPersonContextSnapshotInput = {
  ownerUserId: string;
  personId: string;
  // When the user directly asked about this person/topic, the returned `context`
  // is loaded through live retrieval that may include restricted records (ADR
  // 0058). This never changes the cached snapshot, which is always built from
  // proactive (restricted-free) context, so restricted material is fetched live
  // rather than baked into the cached profile card (ADR 0009, PRD #11).
  directlyRequested?: boolean;
};

/**
 * How the snapshot in a read result was produced:
 * - `fresh` — an existing snapshot whose inputs were unchanged was reused;
 * - `rebuilt` — a missing or stale snapshot was regenerated and persisted;
 * - `fallback` — no usable snapshot (unknown person or generation failed), so
 *   consumers should ground on `context` (the Phase 1A relational context).
 */
export type SnapshotReadStatus = "fresh" | "rebuilt" | "fallback";

export type PersonContextSnapshotResult = {
  status: SnapshotReadStatus;
  // The current cached snapshot, or null when the person is unknown or a rebuild
  // failed without a prior snapshot to fall back to.
  snapshot: ContextSnapshot | null;
  // Phase 1A trust-aware relational context. Always returned so the snapshot
  // stays a context-shaping cache rather than a correctness dependency, and so
  // consumers can fetch supporting records before specific claims (PRD #11).
  context: PersonContextResult;
};

/**
 * A snapshot generator turns the trusted input pack into prose plus the version
 * tag identifying what produced it. Injectable so the deterministic generator
 * (default) can be swapped for an LLM adapter (#14) without changing freshness,
 * policy, persistence, references, or owner scoping. The generator owns wording
 * only (ADR 0009, PRD #11).
 */
export type SnapshotGenerator = (
  input: SnapshotInputPack,
) => SnapshotProse | Promise<SnapshotProse>;

export type CreatePersonContextSnapshotOptions = {
  generator?: SnapshotGenerator;
};

function isSnapshotFresh(snapshot: ContextSnapshot, fingerprint: string): boolean {
  // A previously failed snapshot is never fresh, so the next read retries it.
  return !snapshot.failureReason && snapshot.inputFingerprint === fingerprint;
}

/**
 * Shared snapshot-backed person context read path (PRD #11). Both web and Eve call
 * this seam instead of assembling snapshot context themselves, so generation,
 * policy filtering, freshness, and owner scoping stay in one place.
 *
 * Freshness is deterministic and record-driven: the read recomputes a fingerprint
 * over the trust-filtered inputs and reuses the cached snapshot only when it
 * matches. Missing or stale snapshots are rebuilt through the injected generator.
 * If generation fails, the read fails open to the Phase 1A relational context and
 * records the failure on the snapshot row, so a cache failure never blocks
 * profile or assistant retrieval.
 */
export function createPersonContextSnapshot(
  store: PersonContextSnapshotStore,
  options: CreatePersonContextSnapshotOptions = {},
) {
  const personContext = createPersonContext(store);
  const generate = options.generator ?? generateDeterministicSnapshot;

  return {
    async getPersonContextSnapshot(
      input: GetPersonContextSnapshotInput,
    ): Promise<PersonContextSnapshotResult> {
      // The snapshot is always built from proactive context (no `directlyRequested`),
      // so restricted content is never baked into the cached card (ADR 0058, PRD #11).
      const proactiveContext = await personContext.getPersonContext({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
      });

      // The returned context is grounding for consumers. When the user directly
      // asked, it is re-read live so restricted records can surface through
      // retrieval — separate from, and never written into, the snapshot cache
      // (ADR 0009: fetch restricted via live retrieval, not the cached card).
      const context = input.directlyRequested
        ? await personContext.getPersonContext({
            ownerUserId: input.ownerUserId,
            personId: input.personId,
            directlyRequested: true,
          })
        : proactiveContext;

      if (!proactiveContext.person) {
        return { status: "fallback", snapshot: null, context };
      }

      // Relational `context` above is the must-have result. Everything below is
      // the best-effort snapshot cache: reading the prior row, gathering
      // follow-ups, generating prose, and persisting are all wrapped so ANY
      // failure — including a missing snapshots table/column on an unmigrated
      // dev DB — degrades to the relational context instead of failing the whole
      // read. A cache failure must never block assistant or profile retrieval
      // (ADR 0009, PRD #11).
      let existing: ContextSnapshot | null = null;
      try {
        existing = await store.getContextSnapshot(input);

        // Follow-ups join the pack as compact relationship context: active
        // reminders plus recently completed ones. Their lifecycle stays owned by
        // follow-up records — the snapshot only reflects their current state (#16).
        const followups = selectSnapshotFollowups(
          await store.listFollowupsForPerson({
            ownerUserId: input.ownerUserId,
            personId: input.personId,
          }),
        );

        const pack: SnapshotInputPack = {
          person: proactiveContext.person,
          approvedMemories: proactiveContext.approvedMemories,
          sourceRecords: proactiveContext.sourceRecords,
          suggestedMemories: proactiveContext.suggestedMemories,
          followups,
        };
        const fingerprint = computeSnapshotFingerprint(pack);

        if (existing && isSnapshotFresh(existing, fingerprint)) {
          return { status: "fresh", snapshot: existing, context };
        }

        const prose = await generate(pack);
        const snapshot = await store.upsertContextSnapshot({
          ownerUserId: input.ownerUserId,
          personId: input.personId,
          summary: prose.summary,
          // References are record-level and owned by the builder, never by the
          // generator/model, so grounding cannot drift with prose (PRD #11).
          supportingReferences: collectSnapshotReferences(pack),
          // Compact follow-up context (id, status, due date, reason) — not a
          // reminder feed; lifecycle stays in follow-up records (#16).
          followups: collectCompactFollowups(pack),
          // The generator declares its own version, so provenance reflects the
          // real producer even when an adapter falls back internally (#14).
          generatorVersion: prose.generatorVersion,
          inputFingerprint: fingerprint,
          generatedAt: new Date(),
          failureReason: null,
        });

        return { status: "rebuilt", snapshot, context };
      } catch (error) {
        const failureReason =
          error instanceof Error ? error.message : "snapshot read or generation failed";
        const failed = await recordFailure(store, existing, input, failureReason);

        return { status: "fallback", snapshot: failed ?? existing, context };
      }
    },
  };
}

/**
 * Best-effort failure marker. Preserves the prior snapshot's prose and keeps its
 * (now stale) fingerprint so the next read retries the rebuild, while recording
 * why generation failed for diagnosis. A write failure here must not break the
 * fail-open path, so it is swallowed.
 */
async function recordFailure(
  store: PersonContextSnapshotStore,
  existing: ContextSnapshot | null,
  input: GetPersonContextSnapshotInput,
  failureReason: string,
): Promise<ContextSnapshot | null> {
  if (!existing) {
    return null;
  }

  try {
    return await store.upsertContextSnapshot({
      ownerUserId: input.ownerUserId,
      personId: input.personId,
      summary: existing.summary,
      supportingReferences: existing.supportingReferences,
      followups: existing.followups,
      generatorVersion: existing.generatorVersion,
      inputFingerprint: existing.inputFingerprint,
      generatedAt: new Date(),
      failureReason,
    });
  } catch {
    return null;
  }
}
