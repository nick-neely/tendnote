CREATE TYPE "public"."background_job_delivery_status" AS ENUM('pending', 'published', 'publish_failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."background_job_kind" AS ENUM('extraction', 'embedding');--> statement-breakpoint
CREATE TABLE "background_job_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"job_kind" "background_job_kind" NOT NULL,
	"job_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"status" "background_job_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "background_job_deliveries" ADD CONSTRAINT "background_job_deliveries_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_job_deliveries_job_topic_idx" ON "background_job_deliveries" USING btree ("job_kind","job_id","topic");--> statement-breakpoint
CREATE INDEX "background_job_deliveries_status_next_attempt_idx" ON "background_job_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "background_job_deliveries_owner_status_idx" ON "background_job_deliveries" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "background_job_deliveries_job_idx" ON "background_job_deliveries" USING btree ("job_kind","job_id");