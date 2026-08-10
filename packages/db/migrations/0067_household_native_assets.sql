CREATE TYPE "public"."asset_ownership" AS ENUM('member_owned', 'household_native');--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD COLUMN "ownership" "asset_ownership" DEFAULT 'member_owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD COLUMN "ownership" "asset_ownership" DEFAULT 'member_owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "ownership" "asset_ownership" DEFAULT 'member_owned' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "assets_household_ownership_idx" ON "assets" USING btree ("household_id","ownership");