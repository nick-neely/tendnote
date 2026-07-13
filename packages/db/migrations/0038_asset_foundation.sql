CREATE TYPE "public"."asset_audit_event_kind" AS ENUM('created', 'edited', 'archived', 'restored');--> statement-breakpoint
CREATE TYPE "public"."asset_audit_source" AS ENUM('user', 'assistant', 'system');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('item', 'appliance', 'vehicle', 'subscription', 'service', 'property');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'asset';--> statement-breakpoint
CREATE TABLE "asset_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "asset_audit_event_kind" NOT NULL,
	"actor_user_id" text,
	"source" "asset_audit_source" NOT NULL,
	"scope" "privacy_scope" NOT NULL,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"status" "asset_status" DEFAULT 'active' NOT NULL,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"household_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by_user_id" text,
	"last_actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_audit_events" ADD CONSTRAINT "asset_audit_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_events" ADD CONSTRAINT "asset_audit_events_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_audit_events" ADD CONSTRAINT "asset_audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_audit_events_asset_idx" ON "asset_audit_events" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_audit_events_owner_idx" ON "asset_audit_events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "assets_owner_status_idx" ON "assets" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "assets_owner_kind_idx" ON "assets" USING btree ("owner_user_id","kind");--> statement-breakpoint
CREATE INDEX "assets_household_scope_idx" ON "assets" USING btree ("household_id","scope");