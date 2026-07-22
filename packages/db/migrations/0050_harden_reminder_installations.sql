ALTER TYPE "public"."reminder_opt_in_status" ADD VALUE 'disabled';--> statement-breakpoint
ALTER TABLE "reminder_installations" ALTER COLUMN "endpoint" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_installations" ALTER COLUMN "p256dh" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_installations" ALTER COLUMN "auth" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder_installations" ADD COLUMN "label" text DEFAULT 'Browser installation' NOT NULL;