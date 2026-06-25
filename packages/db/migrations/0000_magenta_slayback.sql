CREATE TYPE "public"."confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."contact_method_type" AS ENUM('email', 'phone', 'social', 'other');--> statement-breakpoint
CREATE TYPE "public"."extraction_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."followup_status" AS ENUM('suggested', 'open', 'snoozed', 'completed', 'dismissed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('call', 'text', 'email', 'meeting', 'hangout', 'note');--> statement-breakpoint
CREATE TYPE "public"."memory_status" AS ENUM('suggested', 'approved', 'dismissed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."memory_type" AS ENUM('preference', 'life_event', 'gift_idea', 'boundary', 'context', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_draft_channel" AS ENUM('text', 'email', 'slack', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_draft_purpose" AS ENUM('birthday', 'thank_you', 'check_in', 'networking', 'other');--> statement-breakpoint
CREATE TYPE "public"."message_draft_status" AS ENUM('draft', 'approved', 'dismissed', 'sent_manually');--> statement-breakpoint
CREATE TYPE "public"."privacy_scope" AS ENUM('private', 'shared', 'household');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('friend', 'family', 'partner', 'colleague', 'professional', 'networking', 'neighbor', 'other');--> statement-breakpoint
CREATE TYPE "public"."sensitivity" AS ENUM('normal', 'sensitive', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."source_record_person_role" AS ENUM('primary', 'mentioned');--> statement-breakpoint
CREATE TYPE "public"."source_record_retention_policy" AS ENUM('retain', 'summarize_then_delete', 'delete_after_processing');--> statement-breakpoint
CREATE TYPE "public"."source_record_status" AS ENUM('pending_resolution', 'active', 'dismissed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('manual', 'agent', 'contact_import', 'calendar', 'gmail', 'seed');--> statement-breakpoint
CREATE TYPE "public"."unresolved_mention_status" AS ENUM('unresolved', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "contact_method_type" NOT NULL,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" "source_type" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_jobs" (
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
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "followup_status" DEFAULT 'open' NOT NULL,
	"cadence" text,
	"last_prompted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"interaction_type" "interaction_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"source" "source_type" DEFAULT 'manual' NOT NULL,
	"confidence" "confidence" DEFAULT 'medium' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"source_record_id" uuid NOT NULL,
	"memory_type" "memory_type" DEFAULT 'context' NOT NULL,
	"content" text NOT NULL,
	"status" "memory_status" DEFAULT 'suggested' NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'normal' NOT NULL,
	"confidence" "confidence" DEFAULT 'medium' NOT NULL,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"approved_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"channel" "message_draft_channel" DEFAULT 'text' NOT NULL,
	"purpose" "message_draft_purpose" DEFAULT 'other' NOT NULL,
	"body" text NOT NULL,
	"status" "message_draft_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"birthday" text,
	"relationship_type" "relationship_type" DEFAULT 'other' NOT NULL,
	"closeness_level" integer DEFAULT 3 NOT NULL,
	"profile_blurb" text,
	"source" "source_type" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_record_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "source_record_person_role" DEFAULT 'mentioned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"source_type" "source_type" DEFAULT 'manual' NOT NULL,
	"content" text NOT NULL,
	"raw_content" text,
	"retention_policy" "source_record_retention_policy" DEFAULT 'retain' NOT NULL,
	"status" "source_record_status" DEFAULT 'active' NOT NULL,
	"confidence" "confidence" DEFAULT 'medium' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'normal' NOT NULL,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unresolved_person_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"mention_text" text NOT NULL,
	"candidate_person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "unresolved_mention_status" DEFAULT 'unresolved' NOT NULL,
	"resolved_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_drafts" ADD CONSTRAINT "message_drafts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_people" ADD CONSTRAINT "source_record_people_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record_people" ADD CONSTRAINT "source_record_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_person_mentions" ADD CONSTRAINT "unresolved_person_mentions_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unresolved_person_mentions" ADD CONSTRAINT "unresolved_person_mentions_resolved_person_id_people_id_fk" FOREIGN KEY ("resolved_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_owner_user_id_idx" ON "audit_log" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "contact_methods_person_id_idx" ON "contact_methods" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_jobs_idempotency_key_idx" ON "extraction_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "extraction_jobs_source_record_id_idx" ON "extraction_jobs" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "extraction_jobs_status_run_after_idx" ON "extraction_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "followups_person_id_idx" ON "followups" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "followups_owner_due_idx" ON "followups" USING btree ("owner_user_id","due_at");--> statement-breakpoint
CREATE INDEX "interactions_person_id_idx" ON "interactions" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "interactions_owner_user_id_idx" ON "interactions" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "memories_person_id_idx" ON "memories" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "memories_owner_user_id_idx" ON "memories" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "memories_source_record_id_idx" ON "memories" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "memories_owner_status_idx" ON "memories" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "message_drafts_person_id_idx" ON "message_drafts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "message_drafts_owner_user_id_idx" ON "message_drafts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "people_owner_user_id_idx" ON "people" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "people_owner_display_name_idx" ON "people" USING btree ("owner_user_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_people_record_person_idx" ON "source_record_people" USING btree ("source_record_id","person_id");--> statement-breakpoint
CREATE INDEX "source_record_people_person_id_idx" ON "source_record_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "source_records_owner_user_id_idx" ON "source_records" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "source_records_owner_status_idx" ON "source_records" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "unresolved_person_mentions_source_record_id_idx" ON "unresolved_person_mentions" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "unresolved_person_mentions_status_idx" ON "unresolved_person_mentions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");