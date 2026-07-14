ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'action_proposed';--> statement-breakpoint
ALTER TABLE "general_action_assets" ADD COLUMN "asset_memory_id" uuid;--> statement-breakpoint
ALTER TABLE "general_action_assets" ADD CONSTRAINT "general_action_assets_asset_memory_id_asset_memories_id_fk" FOREIGN KEY ("asset_memory_id") REFERENCES "public"."asset_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_action_assets_asset_memory_idx" ON "general_action_assets" USING btree ("asset_memory_id");