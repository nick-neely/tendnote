CREATE TYPE "public"."reminder_record_kind" AS ENUM('general_action', 'follow_up', 'routine', 'saved_item');--> statement-breakpoint
DROP INDEX "reminder_schedules_owner_action_idx";--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ALTER COLUMN "general_action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ALTER COLUMN "general_action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ALTER COLUMN "general_action_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD COLUMN "record_kind" "reminder_record_kind" DEFAULT 'general_action' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ADD COLUMN "record_kind" "reminder_record_kind" DEFAULT 'general_action' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD COLUMN "record_kind" "reminder_record_kind" DEFAULT 'general_action' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ADD COLUMN "record_id" uuid;--> statement-breakpoint
UPDATE "reminder_delivery_jobs" SET "record_id" = "general_action_id" WHERE "record_id" IS NULL;--> statement-breakpoint
UPDATE "reminder_occurrence_intents" SET "record_id" = "general_action_id" WHERE "record_id" IS NULL;--> statement-breakpoint
UPDATE "reminder_schedules" SET "record_id" = "general_action_id" WHERE "record_id" IS NULL;--> statement-breakpoint
ALTER TABLE "reminder_delivery_jobs" ALTER COLUMN "record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_occurrence_intents" ALTER COLUMN "record_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_schedules" ALTER COLUMN "record_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_schedules_owner_record_idx" ON "reminder_schedules" USING btree ("owner_user_id","record_kind","record_id");
