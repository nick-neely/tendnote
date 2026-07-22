import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  relationshipSemanticRecordKindSchema,
  relationshipSemanticTrustLevelSchema,
  semanticRecordKindSchema,
  semanticTrustLevelSchema,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { semanticRecordKind, semanticTrustLevel } from "../../schema";

const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0006_overconfident_squadron_supreme.sql"),
  "utf8",
);
const actionRetrievalMigration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0036_action_retrieval.sql"),
  "utf8",
);
const drizzleStore = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("semantic retrieval migration shape", () => {
  it("adds pgvector-backed relationship-context embedding storage", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(migration).toContain('CREATE TABLE "relationship_context_embeddings"');
    expect(migration).toContain('"embedding" vector NOT NULL');
    expect(migration).toContain('"embedding_model" text NOT NULL');
    expect(migration).toContain('"embedding_version" text NOT NULL');
    expect(migration).toContain('"embedding_dimensions" integer NOT NULL');
    expect(migration).toContain('"embedded_text" text NOT NULL');
    expect(migration).toContain('"content_fingerprint" text NOT NULL');
    expect(migration).toContain('"trust_level" "semantic_trust_level" NOT NULL');
    expect(migration).toContain('"sensitivity" "sensitivity" DEFAULT');
  });

  it("keeps one current row per owner, record, model, and version", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "relationship_context_embeddings_current_idx"',
    );
    expect(migration).toContain('"owner_user_id","record_kind","record_id"');
    expect(migration).toContain('"embedding_model","embedding_version"');
    expect(migration).toContain('CREATE INDEX "relationship_context_embeddings_owner_record_idx"');
    expect(migration).toContain('CREATE INDEX "relationship_context_embeddings_compat_idx"');
  });

  it("adds a Postgres-owned embedding job lifecycle", () => {
    expect(migration).toContain('CREATE TYPE "public"."embedding_job_status"');
    expect(migration).toContain("'pending', 'running', 'completed', 'failed', 'skipped'");
    expect(migration).toContain('CREATE TABLE "relationship_context_embedding_jobs"');
    expect(migration).toContain('"attempts" integer DEFAULT 0 NOT NULL');
    expect(migration).toContain('"idempotency_key" text NOT NULL');
    expect(migration).toContain('"run_after" timestamp with time zone DEFAULT now() NOT NULL');
    expect(migration).toContain('"claimed_at" timestamp with time zone');
    expect(migration).toContain('"completed_at" timestamp with time zone');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "relationship_context_embedding_jobs_idempotency_key_idx"',
    );
    expect(migration).toContain(
      'CREATE INDEX "relationship_context_embedding_jobs_status_run_after_idx"',
    );
  });

  it("keeps production mixed semantic retrieval policy in the SQL query", () => {
    expect(drizzleStore).toContain("union all");
    expect(drizzleStore).toContain("e.trust_level = 'confirmed_fact'");
    expect(drizzleStore).toContain("e.trust_level = 'logged_context'");
    expect(drizzleStore).toContain("from source_record_people filter_srp");
    expect(drizzleStore).toContain("visible_people.primary_display_name");
    expect(drizzleStore).toContain("filtered_person.id is not null");
    expect(drizzleStore).toContain("round(similarity::numeric, 4) desc");
    expect(drizzleStore).toContain("sr.sensitivity <> 'restricted'");
  });

  it("extends the record-kind and trust-level enums and adds the action search vector", () => {
    expect(actionRetrievalMigration).toContain(
      `ALTER TYPE "public"."semantic_record_kind" ADD VALUE 'general_action'`,
    );
    expect(actionRetrievalMigration).toContain(
      `ALTER TYPE "public"."semantic_trust_level" ADD VALUE 'action_item'`,
    );
    expect(actionRetrievalMigration).toContain('ADD COLUMN "search_vector" "tsvector"');
    expect(actionRetrievalMigration).toContain('"general_actions_search_vector_idx"');
  });

  it("keeps the general-action semantic retrieval policy in the SQL query", () => {
    expect(drizzleStore).toContain("inner join general_actions ga");
    expect(drizzleStore).toContain("e.trust_level = 'action_item'");
    // Durable statuses only for scope-visible reads; suggested is owner-only review.
    expect(drizzleStore).toContain("ga.status in ('open', 'deferred', 'paused')");
    expect(drizzleStore).toContain("ga.status = 'suggested'");
  });
});

/**
 * The semantic record kinds and trust levels, pinned exactly.
 *
 * This is a deliberate tripwire, not a tautology. Adding a kind here is adding something
 * to the embedding index — a retrieval and privacy surface — so it must be a conscious
 * edit to this list rather than something that slips in. In particular it forces any new
 * kind through the Calendar-boundary question the two Calendar suites ask (cached and
 * derived Calendar context is never embedded; it enters retrieval only after explicit
 * promotion, ADR-0079). Precedent: #184 added `general_action` by updating this list.
 */
describe("semantic record kinds", () => {
  const EXPECTED_KINDS = [
    "memory",
    "source_record",
    "general_action",
    // Phase 6 #204: Assets and their reviewed memories share the embedding pipeline, but
    // are retrieved through the typed Asset Search contract, not relationship retrieval.
    "asset",
    "asset_memory",
    // Phase 7 #265: Saved Items are indexed as owner-scoped saved context. They enter
    // Global Recall through its typed federation, not relationship retrieval.
    "saved_item",
  ];
  const EXPECTED_TRUST_LEVELS = [
    "confirmed_fact",
    "logged_context",
    "action_item",
    "asset_anchor",
    "asset_fact",
    "saved_context",
  ];

  it("embeds exactly these record kinds — adding one is a deliberate edit here", () => {
    expect(semanticRecordKind.enumValues).toEqual(EXPECTED_KINDS);
  });

  it("carries exactly these trust registers", () => {
    expect(semanticTrustLevel.enumValues).toEqual(EXPECTED_TRUST_LEVELS);
  });

  it("keeps the domain schema and the Postgres enum in lockstep", () => {
    expect(semanticRecordKindSchema.options).toEqual(semanticRecordKind.enumValues);
    expect(semanticTrustLevelSchema.options).toEqual(semanticTrustLevel.enumValues);
  });

  /**
   * Relationship retrieval reads a *narrowed* fork of these enums: an Asset is embedded in
   * the same table but is not relationship context, so a relationship search can neither
   * request nor return one (#204). The fork is only safe while it stays a strict subset —
   * otherwise it could silently drift into claiming a kind the index cannot produce.
   */
  it("keeps the relationship-retrieval enums a strict subset of what is embedded", () => {
    for (const kind of relationshipSemanticRecordKindSchema.options) {
      expect(semanticRecordKindSchema.options).toContain(kind);
    }
    for (const trust of relationshipSemanticTrustLevelSchema.options) {
      expect(semanticTrustLevelSchema.options).toContain(trust);
    }
  });

  it("keeps Assets out of relationship retrieval", () => {
    expect(relationshipSemanticRecordKindSchema.options).not.toContain("asset");
    expect(relationshipSemanticRecordKindSchema.options).not.toContain("asset_memory");
    expect(relationshipSemanticRecordKindSchema.options).not.toContain("saved_item");
  });
});
