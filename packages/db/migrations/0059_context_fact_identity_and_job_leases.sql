ALTER TABLE "context_fact_extraction_jobs" DROP CONSTRAINT "context_fact_extraction_jobs_message_length_check";--> statement-breakpoint
DROP INDEX "context_facts_active_self_identity_idx";--> statement-breakpoint
DROP INDEX "context_facts_active_household_identity_idx";--> statement-breakpoint
ALTER TABLE "context_fact_extraction_jobs" ALTER COLUMN "message" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "context_fact_extraction_jobs" ADD COLUMN "claim_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "context_facts_active_self_identity_idx" ON "context_facts" USING btree ("subject_user_id","category","normalized_content") WHERE "context_facts"."subject_kind" = 'self' AND "context_facts"."lifecycle" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "context_facts_active_household_identity_idx" ON "context_facts" USING btree ("subject_household_id","category","normalized_content") WHERE "context_facts"."subject_kind" = 'household' AND "context_facts"."lifecycle" = 'active';--> statement-breakpoint
ALTER TABLE "context_fact_extraction_jobs" ADD CONSTRAINT "context_fact_extraction_jobs_message_length_check" CHECK ("context_fact_extraction_jobs"."message" IS NULL OR char_length(btrim("context_fact_extraction_jobs"."message")) between 1 and 2000);
