import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
