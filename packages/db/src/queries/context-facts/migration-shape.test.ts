import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  contextFactCategorySchema,
  contextFactLifecycleSchema,
  contextFactSubjectSchema,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { contextFactCategory, contextFactLifecycle, contextFactSubject } from "../../schema";

const migration = readFileSync(
  join(import.meta.dirname, "../../../migrations/0054_context_facts.sql"),
  "utf8",
);
const journal = readFileSync(
  join(import.meta.dirname, "../../../migrations/meta/_journal.json"),
  "utf8",
);
const drizzleStore = readFileSync(join(import.meta.dirname, "drizzle-store.ts"), "utf8");

describe("Context Fact persistence contract", () => {
  it("keeps the domain enums and Postgres enums in lockstep", () => {
    expect(contextFactCategorySchema.options).toEqual(contextFactCategory.enumValues);
    expect(contextFactLifecycleSchema.options).toEqual(contextFactLifecycle.enumValues);
    expect(contextFactSubjectSchema.options.map((option) => option.shape.kind.value)).toEqual(
      contextFactSubject.enumValues,
    );
  });

  it("uses the descriptive migration tag and persists the complete foundation shape", () => {
    expect(journal).toContain('"tag": "0054_context_facts"');
    expect(migration).toContain('CREATE TABLE "context_facts"');
    expect(migration).toContain('"subject_kind" "context_fact_subject" NOT NULL');
    expect(migration).toContain('"subject_user_id" text');
    expect(migration).toContain('"subject_household_id" uuid');
    expect(migration).toContain('"category" "context_fact_category" NOT NULL');
    expect(migration).toContain(
      '"lifecycle" "context_fact_lifecycle" DEFAULT \'suggested\' NOT NULL',
    );
    expect(migration).toContain('"sensitivity" "sensitivity" DEFAULT \'normal\' NOT NULL');
    expect(migration).toContain('"provenance_json" jsonb NOT NULL');
    expect(migration).toContain('"creator_user_id" text NOT NULL');
    expect(migration).toContain('"last_actor_user_id" text NOT NULL');
    expect(migration).toContain('"reviewed_at" timestamp with time zone');
    expect(migration).toContain('"archived_at" timestamp with time zone');
    expect(migration).toContain("context_facts_exactly_one_subject_check");
    expect(migration).toContain("context_facts_composition_household_check");
    expect(migration).toContain("context_facts_content_length_check");
  });

  it("keeps the Drizzle store fail-closed and mirrors the owner/household filters", () => {
    expect(drizzleStore).toContain("isPersistedContextFactId");
    expect(drizzleStore).toContain("subjectWhere");
    expect(drizzleStore).toContain("subjectUserId");
    expect(drizzleStore).toContain("householdIds");
    expect(drizzleStore).toContain("eq(auditLog.ownerUserId, input.ownerUserId)");
    expect(drizzleStore).toContain("contextFactSchema.parse");
    expect(drizzleStore).toContain("persistContextFactSchema.parse");
  });
});
