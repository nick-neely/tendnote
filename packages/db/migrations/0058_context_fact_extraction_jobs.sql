CREATE TYPE "public"."context_fact_extraction_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'dead_lettered');--> statement-breakpoint
ALTER TYPE "public"."background_job_kind" ADD VALUE 'context_fact_extraction' BEFORE 'reminder_push';--> statement-breakpoint
CREATE TABLE "context_fact_extraction_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"message" text NOT NULL,
	"status" "context_fact_extraction_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_fact_extraction_jobs_message_length_check" CHECK (char_length(btrim("context_fact_extraction_jobs"."message")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "context_fact_extraction_jobs" ADD CONSTRAINT "context_fact_extraction_jobs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_fact_extraction_jobs_idempotency_key_idx" ON "context_fact_extraction_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "context_fact_extraction_jobs_owner_status_idx" ON "context_fact_extraction_jobs" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "context_fact_extraction_jobs_status_run_after_idx" ON "context_fact_extraction_jobs" USING btree ("status","run_after");