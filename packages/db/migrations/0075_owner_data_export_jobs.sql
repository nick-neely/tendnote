CREATE TYPE "public"."owner_data_export_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'expired');--> statement-breakpoint
ALTER TYPE "public"."background_job_kind" ADD VALUE 'owner_data_export';--> statement-breakpoint
CREATE TABLE "owner_data_export_artifacts" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_data_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" "owner_data_export_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"artifact_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_data_export_artifacts" ADD CONSTRAINT "owner_data_export_artifacts_job_id_owner_data_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."owner_data_export_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_data_export_artifacts" ADD CONSTRAINT "owner_data_export_artifacts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_data_export_jobs" ADD CONSTRAINT "owner_data_export_jobs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_data_export_artifacts_owner_expiry_idx" ON "owner_data_export_artifacts" USING btree ("owner_user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_data_export_jobs_owner_idempotency_key_idx" ON "owner_data_export_jobs" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "owner_data_export_jobs_owner_created_idx" ON "owner_data_export_jobs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "owner_data_export_jobs_status_run_after_idx" ON "owner_data_export_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "owner_data_export_jobs_expiry_idx" ON "owner_data_export_jobs" USING btree ("status","artifact_expires_at");
