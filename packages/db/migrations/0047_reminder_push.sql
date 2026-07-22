CREATE TYPE "public"."reminder_delivery_job_status" AS ENUM('pending', 'running', 'completed', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reminder_delivery_outcome" AS ENUM('accepted', 'transient_failure', 'terminal_endpoint', 'suppressed_stale', 'suppressed_revoked', 'suppressed_ineligible');--> statement-breakpoint
CREATE TYPE "public"."reminder_installation_status" AS ENUM('enabled', 'disabled', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."reminder_occurrence_status" AS ENUM('pending_installation', 'pending', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."reminder_opt_in_status" AS ENUM('offered', 'postponed', 'denied', 'registered');--> statement-breakpoint
CREATE TYPE "public"."reminder_preview_mode" AS ENUM('generic', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."reminder_schedule_kind" AS ENUM('exact', 'relative');--> statement-breakpoint
ALTER TYPE "public"."background_job_kind" ADD VALUE 'reminder_push';--> statement-breakpoint
CREATE TABLE "reminder_delivery_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"general_action_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"occurrence_intent_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"occurrence_key" text NOT NULL,
	"intended_at" timestamp with time zone NOT NULL,
	"fresh_until" timestamp with time zone NOT NULL,
	"status" "reminder_delivery_job_status" DEFAULT 'pending' NOT NULL,
	"outcome" "reminder_delivery_outcome",
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"client_installation_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"expiration_time" bigint,
	"status" "reminder_installation_status" DEFAULT 'enabled' NOT NULL,
	"preview_mode" "reminder_preview_mode" DEFAULT 'generic' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_occurrence_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"general_action_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"occurrence_key" text NOT NULL,
	"intended_at" timestamp with time zone NOT NULL,
	"fresh_until" timestamp with time zone NOT NULL,
	"status" "reminder_occurrence_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_opt_in_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"client_installation_id" text NOT NULL,
	"state" "reminder_opt_in_status" NOT NULL,
	"offered_at" timestamp with time zone NOT NULL,
	"invite_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"general_action_id" uuid NOT NULL,
	"kind" "reminder_schedule_kind" NOT NULL,
	"local_time" text,
	"lead_minutes" integer,
	"time_zone" text NOT NULL,
	"occurrence_key" text NOT NULL,
	"intended_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD CONSTRAINT "reminder_delivery_jobs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD CONSTRAINT "reminder_delivery_jobs_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD CONSTRAINT "reminder_delivery_jobs_schedule_id_reminder_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."reminder_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD CONSTRAINT "reminder_delivery_jobs_occurrence_intent_id_reminder_occurrence_intents_id_fk" FOREIGN KEY ("occurrence_intent_id") REFERENCES "public"."reminder_occurrence_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD CONSTRAINT "reminder_delivery_jobs_installation_id_reminder_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."reminder_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_installations" ADD CONSTRAINT "reminder_installations_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ADD CONSTRAINT "reminder_occurrence_intents_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ADD CONSTRAINT "reminder_occurrence_intents_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ADD CONSTRAINT "reminder_occurrence_intents_schedule_id_reminder_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."reminder_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_opt_in_states" ADD CONSTRAINT "reminder_opt_in_states_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_general_action_id_general_actions_id_fk" FOREIGN KEY ("general_action_id") REFERENCES "public"."general_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_delivery_jobs_occurrence_installation_idx" ON "reminder_delivery_jobs" USING btree ("owner_user_id","occurrence_key","installation_id");--> statement-breakpoint
CREATE INDEX "reminder_delivery_jobs_due_idx" ON "reminder_delivery_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "reminder_delivery_jobs_owner_idx" ON "reminder_delivery_jobs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_installations_owner_client_idx" ON "reminder_installations" USING btree ("owner_user_id","client_installation_id");--> statement-breakpoint
CREATE INDEX "reminder_installations_owner_status_idx" ON "reminder_installations" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_occurrence_intents_schedule_occurrence_idx" ON "reminder_occurrence_intents" USING btree ("schedule_id","occurrence_key","intended_at");--> statement-breakpoint
CREATE INDEX "reminder_occurrence_intents_owner_status_idx" ON "reminder_occurrence_intents" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_opt_in_states_owner_installation_idx" ON "reminder_opt_in_states" USING btree ("owner_user_id","client_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_schedules_owner_action_idx" ON "reminder_schedules" USING btree ("owner_user_id","general_action_id");--> statement-breakpoint
CREATE INDEX "reminder_schedules_owner_intended_idx" ON "reminder_schedules" USING btree ("owner_user_id","intended_at");