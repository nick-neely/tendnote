ALTER TYPE "public"."general_action_event_kind" ADD VALUE 'paused';--> statement-breakpoint
ALTER TYPE "public"."general_action_event_kind" ADD VALUE 'resumed';--> statement-breakpoint
ALTER TYPE "public"."general_action_status" ADD VALUE 'paused';--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "recurrence" jsonb;