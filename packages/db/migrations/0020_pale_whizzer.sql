CREATE TYPE "public"."phase3_scheduled_workflow" AS ENUM('morning_agenda', 'post_meeting_aftercare', 'weekly_relationship_review', 'birthday_gift_planning');--> statement-breakpoint
CREATE TYPE "public"."proactive_delivery_channel" AS ENUM('discord');--> statement-breakpoint
CREATE TYPE "public"."proactive_delivery_status" AS ENUM('sent', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scheduled_artifact_kind" AS ENUM('morning_agenda', 'post_meeting_aftercare', 'weekly_relationship_review', 'birthday_gift_planning', 'brief');--> statement-breakpoint
CREATE TABLE "scheduled_workflow_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"workflow" "phase3_scheduled_workflow" NOT NULL,
	"channel" "proactive_delivery_channel" NOT NULL,
	"artifact_kind" "scheduled_artifact_kind" NOT NULL,
	"artifact_id" text NOT NULL,
	"target_id" text,
	"status" "proactive_delivery_status" NOT NULL,
	"reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_workflow_delivery_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"workflow" "phase3_scheduled_workflow" NOT NULL,
	"channel" "proactive_delivery_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"target_id" text NOT NULL,
	"allow_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_workflow_delivery_attempts" ADD CONSTRAINT "scheduled_workflow_delivery_attempts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_workflow_delivery_settings" ADD CONSTRAINT "scheduled_workflow_delivery_settings_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_workflow_delivery_attempts_owner_workflow_idx" ON "scheduled_workflow_delivery_attempts" USING btree ("owner_user_id","workflow");--> statement-breakpoint
CREATE INDEX "scheduled_workflow_delivery_attempts_artifact_idx" ON "scheduled_workflow_delivery_attempts" USING btree ("artifact_kind","artifact_id");--> statement-breakpoint
CREATE INDEX "scheduled_workflow_delivery_attempts_status_idx" ON "scheduled_workflow_delivery_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_workflow_delivery_settings_owner_workflow_channel_idx" ON "scheduled_workflow_delivery_settings" USING btree ("owner_user_id","workflow","channel");--> statement-breakpoint
CREATE INDEX "scheduled_workflow_delivery_settings_owner_idx" ON "scheduled_workflow_delivery_settings" USING btree ("owner_user_id");