ALTER TABLE "access_profiles" ADD COLUMN "usage_period_anchor" date;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "cost_micro_usd" bigint DEFAULT 0 NOT NULL;