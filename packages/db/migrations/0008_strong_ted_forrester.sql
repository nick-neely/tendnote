CREATE TYPE "public"."brief_cadence" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."brief_generation_reason" AS ENUM('scheduled', 'manual', 'regenerated');--> statement-breakpoint
CREATE TYPE "public"."brief_item_kind" AS ENUM('due_followup', 'birthday', 'review_item', 'recent_context', 'semantic_context', 'suggested_followup');--> statement-breakpoint
CREATE TYPE "public"."brief_item_status" AS ENUM('active', 'dismissed', 'snoozed', 'acted_on');--> statement-breakpoint
CREATE TYPE "public"."brief_item_trust_level" AS ENUM('active_reminder', 'stored_profile_data', 'logged_context', 'confirmed_fact', 'tentative');--> statement-breakpoint
CREATE TABLE "brief_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "brief_item_kind" NOT NULL,
	"person_id" uuid,
	"person_display_name" text,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"due_at" timestamp with time zone,
	"source_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trust_level" "brief_item_trust_level" NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'normal' NOT NULL,
	"rank" integer NOT NULL,
	"status" "brief_item_status" DEFAULT 'active' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"cadence" "brief_cadence" NOT NULL,
	"local_date" text NOT NULL,
	"generation_reason" "brief_generation_reason" NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"summary" text,
	"summary_provenance" jsonb,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brief_items" ADD CONSTRAINT "brief_items_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_items" ADD CONSTRAINT "brief_items_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_items" ADD CONSTRAINT "brief_items_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brief_items_brief_id_idx" ON "brief_items" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "brief_items_owner_status_idx" ON "brief_items" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "briefs_owner_date_cadence_current_idx" ON "briefs" USING btree ("owner_user_id","local_date","cadence") WHERE "briefs"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "briefs_owner_cadence_idx" ON "briefs" USING btree ("owner_user_id","cadence");