CREATE TABLE "action_extraction_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"status" "extraction_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_extraction_jobs" ADD CONSTRAINT "action_extraction_jobs_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_extraction_jobs_idempotency_key_idx" ON "action_extraction_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "action_extraction_jobs_source_record_id_idx" ON "action_extraction_jobs" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "action_extraction_jobs_status_run_after_idx" ON "action_extraction_jobs" USING btree ("status","run_after");