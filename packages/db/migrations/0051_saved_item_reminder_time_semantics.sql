ALTER TABLE "saved_items" ADD COLUMN "bring_back_time_semantics" text DEFAULT 'date_only' NOT NULL;--> statement-breakpoint
UPDATE "saved_items" SET "bring_back_time_semantics" = 'instant' WHERE "bring_back_at" IS NOT NULL;
