ALTER TABLE "access_profiles" ADD COLUMN "first_run_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "integration_offer_closed_at" timestamp with time zone;--> statement-breakpoint
-- Accounts already admitted were admitted before the first run and its
-- integrations offer existed, so neither is owed to them (#639). An account not
-- yet admitted keeps both: its first run starts when it is.
UPDATE "access_profiles" SET "first_run_closed_at" = now(), "integration_offer_closed_at" = now() WHERE "status" = 'granted';
