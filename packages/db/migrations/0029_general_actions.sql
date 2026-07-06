CREATE TYPE "public"."general_action_event_kind" AS ENUM('created', 'edited', 'completed', 'reopened', 'deferred', 'dismissed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."general_action_status" AS ENUM('open', 'deferred', 'completed', 'dismissed', 'archived');--> statement-breakpoint
CREATE TABLE "general_action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"general_action_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "general_action_event_kind" NOT NULL,
	"actor_user_id" text,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "general_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "general_action_status" DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone,
	"defer_until" timestamp with time zone,
	"source_record_id" uuid,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"household_id" uuid,
	"created_by_user_id" text,
	"last_actor_user_id" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "general_action_events" ADD CONSTRAINT "general_action_events_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_action_events" ADD CONSTRAINT "general_action_events_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_action_events" ADD CONSTRAINT "general_action_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_action_events_action_idx" ON "general_action_events" USING btree ("general_action_id","created_at");--> statement-breakpoint
CREATE INDEX "general_action_events_owner_idx" ON "general_action_events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "general_actions_owner_status_idx" ON "general_actions" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "general_actions_owner_due_idx" ON "general_actions" USING btree ("owner_user_id","due_at");--> statement-breakpoint
CREATE INDEX "general_actions_household_scope_idx" ON "general_actions" USING btree ("household_id","scope");