CREATE TYPE "public"."self_context_onboarding_status" AS ENUM('not_started', 'dismissed', 'completed');--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "self_context_onboarding_status" "self_context_onboarding_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "self_context_onboarding_reminder_at" timestamp with time zone;