ALTER TYPE "public"."semantic_record_kind" ADD VALUE 'asset';--> statement-breakpoint
ALTER TYPE "public"."semantic_record_kind" ADD VALUE 'asset_memory';--> statement-breakpoint
ALTER TYPE "public"."semantic_trust_level" ADD VALUE 'asset_anchor';--> statement-breakpoint
ALTER TYPE "public"."semantic_trust_level" ADD VALUE 'asset_fact';--> statement-breakpoint
CREATE TABLE "asset_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"supporting_references" jsonb DEFAULT '{"assetIds":[],"assetMemoryIds":[],"assetEvidenceIds":[],"relatedAssetLinkIds":[],"assetPersonLinkIds":[],"generalActionIds":[]}'::jsonb NOT NULL,
	"generator_version" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("label", '') || ' ' || coalesce("file_name", '') || ' ' || coalesce("captured_text", '') || ' ' || coalesce("money_json"->>'amount', ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("label", '') || ' ' || coalesce("notes", '') || ' ' || coalesce("value_json"->>'text', '') || ' ' || coalesce("value_json"->>'date', '') || ' ' || coalesce("value_json"->>'amount', ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", ''))) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_snapshots" ADD CONSTRAINT "asset_snapshots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_snapshots_owner_asset_idx" ON "asset_snapshots" USING btree ("owner_user_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_snapshots_asset_idx" ON "asset_snapshots" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_evidence_search_vector_idx" ON "asset_evidence" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "asset_memories_search_vector_idx" ON "asset_memories" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "assets_search_vector_idx" ON "assets" USING gin ("search_vector");