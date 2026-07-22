CREATE TYPE "public"."saved_item_destination_kind" AS ENUM('general_action');--> statement-breakpoint
CREATE TYPE "public"."saved_item_event_kind" AS ENUM('created', 'edited', 'archived', 'reopened', 'resolved', 'promoted', 'visibility_changed', 'mutation_rejected');--> statement-breakpoint
CREATE TYPE "public"."saved_item_kind" AS ENUM('note', 'link', 'open_question');--> statement-breakpoint
CREATE TYPE "public"."saved_item_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."semantic_record_kind" ADD VALUE 'saved_item';--> statement-breakpoint
ALTER TYPE "public"."semantic_trust_level" ADD VALUE 'saved_context';--> statement-breakpoint
ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'saved_item' BEFORE 'asset';--> statement-breakpoint
CREATE TABLE "saved_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_item_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "saved_item_event_kind" NOT NULL,
	"actor_user_id" text,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_item_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_item_id" uuid NOT NULL,
	"destination_kind" "saved_item_destination_kind" NOT NULL,
	"destination_record_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" "saved_item_kind" NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"url" text,
	"status" "saved_item_status" DEFAULT 'active' NOT NULL,
	"bring_back_at" timestamp with time zone,
	"source_record_id" uuid NOT NULL,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"household_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"created_by_user_id" text,
	"last_actor_user_id" text,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", '') || ' ' || coalesce("url", ''))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_item_events" ADD CONSTRAINT "saved_item_events_saved_item_id_saved_items_id_fk" FOREIGN KEY ("saved_item_id") REFERENCES "public"."saved_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_item_events" ADD CONSTRAINT "saved_item_events_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_item_events" ADD CONSTRAINT "saved_item_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_item_outcomes" ADD CONSTRAINT "saved_item_outcomes_saved_item_id_saved_items_id_fk" FOREIGN KEY ("saved_item_id") REFERENCES "public"."saved_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_item_events_item_idx" ON "saved_item_events" USING btree ("saved_item_id","created_at");--> statement-breakpoint
CREATE INDEX "saved_item_events_owner_idx" ON "saved_item_events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_item_outcomes_idempotency_idx" ON "saved_item_outcomes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_item_outcomes_destination_idx" ON "saved_item_outcomes" USING btree ("saved_item_id","destination_kind","destination_record_id");--> statement-breakpoint
CREATE INDEX "saved_items_owner_status_idx" ON "saved_items" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "saved_items_owner_bring_back_idx" ON "saved_items" USING btree ("owner_user_id","bring_back_at");--> statement-breakpoint
CREATE INDEX "saved_items_source_record_idx" ON "saved_items" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "saved_items_household_scope_idx" ON "saved_items" USING btree ("household_id","scope");--> statement-breakpoint
CREATE INDEX "saved_items_search_vector_idx" ON "saved_items" USING gin ("search_vector");
