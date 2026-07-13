CREATE TYPE "public"."asset_memory_status" AS ENUM('suggested', 'active', 'dismissed');--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'suggested';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'promoted';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'dismissed';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'linked_existing';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'memory_created';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'memory_suggested';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'memory_edited';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'memory_promoted';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'memory_dismissed';--> statement-breakpoint
ALTER TYPE "public"."asset_status" ADD VALUE 'suggested';--> statement-breakpoint
ALTER TYPE "public"."asset_status" ADD VALUE 'dismissed';--> statement-breakpoint
ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'asset_memory';--> statement-breakpoint
CREATE TABLE "asset_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" "asset_memory_status" DEFAULT 'suggested' NOT NULL,
	"label" text NOT NULL,
	"value_json" jsonb,
	"notes" text,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"household_id" uuid,
	"source_record_id" uuid,
	"review_group_id" uuid,
	"created_by_user_id" text,
	"last_actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_review_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_review_group_id_asset_review_groups_id_fk" FOREIGN KEY ("review_group_id") REFERENCES "public"."asset_review_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_review_groups" ADD CONSTRAINT "asset_review_groups_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_review_groups" ADD CONSTRAINT "asset_review_groups_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_review_groups" ADD CONSTRAINT "asset_review_groups_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_memories_asset_status_idx" ON "asset_memories" USING btree ("asset_id","status");--> statement-breakpoint
CREATE INDEX "asset_memories_owner_status_idx" ON "asset_memories" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "asset_memories_review_group_idx" ON "asset_memories" USING btree ("review_group_id");--> statement-breakpoint
CREATE INDEX "asset_review_groups_owner_idx" ON "asset_review_groups" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_review_groups_asset_idx" ON "asset_review_groups" USING btree ("asset_id");