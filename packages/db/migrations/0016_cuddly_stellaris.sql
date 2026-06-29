CREATE TYPE "public"."calendar_suggestion_status" AS ENUM('suggested', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "calendar_suggested_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"shape" text NOT NULL,
	"person_id" uuid,
	"person_display_name" text,
	"match_kind" text NOT NULL,
	"tentative" boolean DEFAULT false NOT NULL,
	"unresolved_attendee" text,
	"reason" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "calendar_suggestion_status" DEFAULT 'suggested' NOT NULL,
	"accepted_followup_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_suggested_followups" ADD CONSTRAINT "calendar_suggested_followups_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_suggested_followups" ADD CONSTRAINT "calendar_suggested_followups_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_suggested_followups_owner_idx" ON "calendar_suggested_followups" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "calendar_suggested_followups_owner_status_idx" ON "calendar_suggested_followups" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_suggested_followups_owner_dedupe_idx" ON "calendar_suggested_followups" USING btree ("owner_user_id","dedupe_key");