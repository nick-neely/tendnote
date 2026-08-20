ALTER TYPE "public"."access_source" ADD VALUE 'self_hosted_bootstrap' BEFORE 'manual_grant';--> statement-breakpoint
ALTER TYPE "public"."access_source" ADD VALUE 'household_invitation' BEFORE 'manual_grant';
