ALTER TABLE "context_facts" ADD COLUMN "normalized_content" text;--> statement-breakpoint
UPDATE "context_facts"
SET "normalized_content" = trim(regexp_replace(lower("content"), '[^[:alnum:]]+', ' ', 'g'));--> statement-breakpoint
ALTER TABLE "context_facts" ALTER COLUMN "normalized_content" SET NOT NULL;--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "subject_kind", "subject_user_id", "subject_household_id", "category", "sensitivity", "normalized_content"
		ORDER BY "updated_at" DESC, "id" DESC
	) AS "rank"
	FROM "context_facts"
	WHERE "lifecycle" = 'active'
)
UPDATE "context_facts" AS fact
SET "lifecycle" = 'archived', "archived_at" = COALESCE(fact."archived_at", fact."updated_at")
FROM ranked
WHERE fact."id" = ranked."id" AND ranked."rank" > 1;--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "subject_kind", "subject_user_id", "subject_household_id", "category"
		ORDER BY "updated_at" DESC, "id" DESC
	) AS "rank"
	FROM "context_facts"
	WHERE "lifecycle" = 'active' AND "category" IN ('background', 'work', 'location')
)
UPDATE "context_facts" AS fact
SET "lifecycle" = 'archived', "archived_at" = COALESCE(fact."archived_at", fact."updated_at")
FROM ranked
WHERE fact."id" = ranked."id" AND ranked."rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "context_facts_active_self_identity_idx" ON "context_facts" USING btree ("subject_user_id","category","sensitivity","normalized_content") WHERE "context_facts"."subject_kind" = 'self' AND "context_facts"."lifecycle" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "context_facts_active_household_identity_idx" ON "context_facts" USING btree ("subject_household_id","category","sensitivity","normalized_content") WHERE "context_facts"."subject_kind" = 'household' AND "context_facts"."lifecycle" = 'active';
