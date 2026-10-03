ALTER TABLE "stripe_subscriptions" ADD COLUMN "past_due_invoice_id" text;--> statement-breakpoint
ALTER TABLE "stripe_subscriptions" ADD COLUMN "past_due_since" timestamp with time zone;