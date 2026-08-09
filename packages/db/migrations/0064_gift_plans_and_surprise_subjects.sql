CREATE TYPE "public"."gift_plan_event_kind" AS ENUM('created', 'edited', 'audience_changed', 'surprise_protected', 'surprise_lifted', 'idea_added', 'idea_edited', 'idea_removed', 'idea_claimed', 'idea_released', 'celebrated', 'archived', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."gift_plan_status" AS ENUM('active', 'celebrated', 'archived');--> statement-breakpoint
ALTER TYPE "public"."visibility_record_kind" ADD VALUE 'gift_plan';--> statement-breakpoint
CREATE TABLE "gift_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_plan_id" uuid NOT NULL,
	"contributor_user_id" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"url" text,
	"claimed_by_user_id" text,
	"claimed_at" timestamp with time zone,
	"last_actor_user_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_plan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_plan_id" uuid NOT NULL,
	"kind" "gift_plan_event_kind" NOT NULL,
	"actor_user_id" text,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"subject_name" text NOT NULL,
	"occasion" text NOT NULL,
	"occasion_on" timestamp with time zone,
	"subject_person_id" uuid,
	"surprise_subject_user_id" text,
	"status" "gift_plan_status" DEFAULT 'active' NOT NULL,
	"scope" "privacy_scope" DEFAULT 'private' NOT NULL,
	"household_id" uuid,
	"last_actor_user_id" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("subject_name", '') || ' ' || coalesce("occasion", ''))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD CONSTRAINT "gift_ideas_gift_plan_id_gift_plans_id_fk" FOREIGN KEY ("gift_plan_id") REFERENCES "public"."gift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD CONSTRAINT "gift_ideas_contributor_user_id_user_id_fk" FOREIGN KEY ("contributor_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD CONSTRAINT "gift_ideas_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_ideas" ADD CONSTRAINT "gift_ideas_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plan_events" ADD CONSTRAINT "gift_plan_events_gift_plan_id_gift_plans_id_fk" FOREIGN KEY ("gift_plan_id") REFERENCES "public"."gift_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plan_events" ADD CONSTRAINT "gift_plan_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plans" ADD CONSTRAINT "gift_plans_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plans" ADD CONSTRAINT "gift_plans_subject_person_id_people_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plans" ADD CONSTRAINT "gift_plans_surprise_subject_user_id_user_id_fk" FOREIGN KEY ("surprise_subject_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plans" ADD CONSTRAINT "gift_plans_household_id_household_workspaces_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_plans" ADD CONSTRAINT "gift_plans_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_ideas_plan_created_idx" ON "gift_ideas" USING btree ("gift_plan_id","created_at");--> statement-breakpoint
CREATE INDEX "gift_ideas_contributor_idx" ON "gift_ideas" USING btree ("contributor_user_id");--> statement-breakpoint
CREATE INDEX "gift_plan_events_plan_idx" ON "gift_plan_events" USING btree ("gift_plan_id","created_at");--> statement-breakpoint
CREATE INDEX "gift_plans_owner_status_idx" ON "gift_plans" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "gift_plans_household_scope_idx" ON "gift_plans" USING btree ("household_id","scope");--> statement-breakpoint
CREATE INDEX "gift_plans_surprise_subject_idx" ON "gift_plans" USING btree ("surprise_subject_user_id");--> statement-breakpoint
CREATE INDEX "gift_plans_search_vector_idx" ON "gift_plans" USING gin ("search_vector");