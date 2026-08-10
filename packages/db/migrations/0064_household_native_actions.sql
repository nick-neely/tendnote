CREATE TYPE "public"."general_action_ownership" AS ENUM('member_owned', 'household_native');--> statement-breakpoint
ALTER TYPE "public"."general_action_event_kind" ADD VALUE 'responsibility_changed';--> statement-breakpoint
ALTER TYPE "public"."general_action_event_kind" ADD VALUE 'handed_to_household';--> statement-breakpoint
CREATE TABLE "general_action_reminder_offer_declines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"general_action_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"declined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "ownership" "general_action_ownership" DEFAULT 'member_owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "responsibility_holder_user_id" text;--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "occurrence_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "general_action_reminder_offer_declines" ADD CONSTRAINT "general_action_reminder_offer_declines_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_action_reminder_offer_declines" ADD CONSTRAINT "general_action_reminder_offer_declines_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "general_action_reminder_offer_declines_action_user_idx" ON "general_action_reminder_offer_declines" USING btree ("general_action_id","user_id");--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_responsibility_holder_user_id_user_id_fk" FOREIGN KEY ("responsibility_holder_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_actions_household_ownership_idx" ON "general_actions" USING btree ("household_id","ownership");--> statement-breakpoint
CREATE INDEX "general_actions_responsibility_holder_idx" ON "general_actions" USING btree ("responsibility_holder_user_id");