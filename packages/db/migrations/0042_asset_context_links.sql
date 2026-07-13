CREATE TYPE "public"."asset_link_relation" AS ENUM('fits', 'uses', 'part_of', 'replaces', 'covers', 'stored_with');--> statement-breakpoint
CREATE TYPE "public"."asset_link_status" AS ENUM('suggested', 'active', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."asset_person_relation" AS ENUM('recommended', 'borrowed', 'uses', 'stores', 'services', 'knows_about');--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'link_added';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'link_suggested';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'link_promoted';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'link_dismissed';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'link_removed';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'person_link_added';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'person_link_removed';--> statement-breakpoint
CREATE TABLE "asset_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"from_asset_id" uuid NOT NULL,
	"to_asset_id" uuid NOT NULL,
	"relation" "asset_link_relation" NOT NULL,
	"status" "asset_link_status" DEFAULT 'suggested' NOT NULL,
	"source_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_person_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"relation" "asset_person_relation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_from_asset_id_assets_id_fk" FOREIGN KEY ("from_asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_to_asset_id_assets_id_fk" FOREIGN KEY ("to_asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_person_links" ADD CONSTRAINT "asset_person_links_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_person_links" ADD CONSTRAINT "asset_person_links_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_person_links" ADD CONSTRAINT "asset_person_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_links_owner_from_to_relation_idx" ON "asset_links" USING btree ("owner_user_id","from_asset_id","to_asset_id","relation");--> statement-breakpoint
CREATE INDEX "asset_links_from_asset_idx" ON "asset_links" USING btree ("from_asset_id");--> statement-breakpoint
CREATE INDEX "asset_links_to_asset_idx" ON "asset_links" USING btree ("to_asset_id");--> statement-breakpoint
CREATE INDEX "asset_links_owner_status_idx" ON "asset_links" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_person_links_owner_asset_person_relation_idx" ON "asset_person_links" USING btree ("owner_user_id","asset_id","person_id","relation");--> statement-breakpoint
CREATE INDEX "asset_person_links_asset_idx" ON "asset_person_links" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_person_links_person_idx" ON "asset_person_links" USING btree ("person_id");