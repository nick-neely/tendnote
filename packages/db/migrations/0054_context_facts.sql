CREATE TYPE "public"."context_fact_category" AS ENUM('background', 'work', 'location', 'interest', 'preference', 'constraint', 'composition', 'other');--> statement-breakpoint
CREATE TYPE "public"."context_fact_lifecycle" AS ENUM('suggested', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."context_fact_subject" AS ENUM('self', 'household');--> statement-breakpoint
CREATE TABLE "context_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" "context_fact_subject" NOT NULL,
	"subject_user_id" text,
	"subject_household_id" uuid,
	"category" "context_fact_category" NOT NULL,
	"content" text NOT NULL,
	"lifecycle" "context_fact_lifecycle" DEFAULT 'suggested' NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'normal' NOT NULL,
	"provenance_json" jsonb NOT NULL,
	"suggestion_evidence" text,
	"creator_user_id" text NOT NULL,
	"last_actor_user_id" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_facts_exactly_one_subject_check" CHECK ((
        ("context_facts"."subject_kind" = 'self' AND "context_facts"."subject_user_id" IS NOT NULL AND "context_facts"."subject_household_id" IS NULL)
        OR
        ("context_facts"."subject_kind" = 'household' AND "context_facts"."subject_user_id" IS NULL AND "context_facts"."subject_household_id" IS NOT NULL)
      )),
	CONSTRAINT "context_facts_composition_household_check" CHECK ("context_facts"."category" <> 'composition' OR "context_facts"."subject_kind" = 'household'),
	CONSTRAINT "context_facts_content_length_check" CHECK (char_length(btrim("context_facts"."content")) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_subject_user_id_user_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_subject_household_id_household_workspaces_id_fk" FOREIGN KEY ("subject_household_id") REFERENCES "public"."household_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_facts_subject_user_lifecycle_idx" ON "context_facts" USING btree ("subject_user_id","lifecycle","updated_at");--> statement-breakpoint
CREATE INDEX "context_facts_subject_household_lifecycle_idx" ON "context_facts" USING btree ("subject_household_id","lifecycle","updated_at");