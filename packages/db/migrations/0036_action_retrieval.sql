ALTER TYPE "public"."semantic_record_kind" ADD VALUE 'general_action';--> statement-breakpoint
ALTER TYPE "public"."semantic_trust_level" ADD VALUE 'action_item';--> statement-breakpoint
ALTER TABLE "general_actions" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("notes", ''))) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "general_actions_search_vector_idx" ON "general_actions" USING gin ("search_vector");
