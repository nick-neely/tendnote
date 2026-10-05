CREATE TYPE "public"."access_pending_reason" AS ENUM('beta_ended');--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "pending_reason" "access_pending_reason";--> statement-breakpoint
-- The Beta Sunset (#612): this release opens Checkout, so every remaining beta
-- grant ends here and its account waits in the pending area, Unpaid, with its
-- data intact and no retention clock. Every other source, including the
-- operator's own `manual_grant`, is left alone.
UPDATE "access_profiles" SET "status" = 'pending', "source" = NULL, "granted_at" = NULL, "retention_deadline" = NULL, "pending_reason" = 'beta_ended', "updated_at" = now() WHERE "source" = 'beta_flag';
