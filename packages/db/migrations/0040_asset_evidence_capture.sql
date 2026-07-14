CREATE TYPE "public"."asset_evidence_kind" AS ENUM('receipt', 'photo', 'manual', 'warranty', 'link', 'note');--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'evidence_added';--> statement-breakpoint
ALTER TYPE "public"."asset_audit_event_kind" ADD VALUE 'evidence_removed';--> statement-breakpoint
ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'asset_evidence';--> statement-breakpoint
CREATE TABLE "asset_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "asset_evidence_kind" NOT NULL,
	"label" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"url" text,
	"captured_text" text,
	"money_json" jsonb,
	"purchased_on" date,
	"renews_on" date,
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
CREATE TABLE "asset_evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_review_group_id_asset_review_groups_id_fk" FOREIGN KEY ("review_group_id") REFERENCES "public"."asset_review_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_files" ADD CONSTRAINT "asset_evidence_files_evidence_id_asset_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."asset_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence_files" ADD CONSTRAINT "asset_evidence_files_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_evidence_asset_idx" ON "asset_evidence" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "asset_evidence_owner_idx" ON "asset_evidence" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "asset_evidence_review_group_idx" ON "asset_evidence" USING btree ("review_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_evidence_files_evidence_idx" ON "asset_evidence_files" USING btree ("evidence_id");