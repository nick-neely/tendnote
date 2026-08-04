CREATE TYPE "public"."context_fact_import_provider" AS ENUM('chatgpt', 'claude', 'gemini');--> statement-breakpoint
CREATE TYPE "public"."context_fact_import_source" AS ENUM('block', 'extraction');--> statement-breakpoint
CREATE TABLE "context_fact_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider" "context_fact_import_provider" NOT NULL,
	"source" "context_fact_import_source" NOT NULL,
	"text_length" integer NOT NULL,
	"candidate_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_fact_imports_text_length_check" CHECK ("context_fact_imports"."text_length" between 1 and 16000),
	CONSTRAINT "context_fact_imports_candidate_count_check" CHECK ("context_fact_imports"."candidate_count" between 0 and 24)
);
--> statement-breakpoint
ALTER TABLE "context_fact_imports" ADD CONSTRAINT "context_fact_imports_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "context_fact_imports_owner_created_idx" ON "context_fact_imports" USING btree ("owner_user_id","created_at");