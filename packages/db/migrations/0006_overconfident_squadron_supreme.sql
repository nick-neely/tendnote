CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."embedding_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."semantic_record_kind" AS ENUM('memory', 'source_record');--> statement-breakpoint
CREATE TYPE "public"."semantic_trust_level" AS ENUM('confirmed_fact', 'logged_context');--> statement-breakpoint
CREATE TABLE "relationship_context_embedding_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"record_kind" "semantic_record_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"status" "embedding_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" text NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_context_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"person_id" uuid,
	"record_kind" "semantic_record_kind" NOT NULL,
	"record_id" uuid NOT NULL,
	"embedding" vector NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_version" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"embedded_text" text NOT NULL,
	"content_fingerprint" text NOT NULL,
	"trust_level" "semantic_trust_level" NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'normal' NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "relationship_context_embedding_jobs" ADD CONSTRAINT "relationship_context_embedding_jobs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_context_embeddings" ADD CONSTRAINT "relationship_context_embeddings_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_context_embeddings" ADD CONSTRAINT "relationship_context_embeddings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_context_embedding_jobs_idempotency_key_idx" ON "relationship_context_embedding_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "relationship_context_embedding_jobs_owner_record_idx" ON "relationship_context_embedding_jobs" USING btree ("owner_user_id","record_kind","record_id");--> statement-breakpoint
CREATE INDEX "relationship_context_embedding_jobs_status_run_after_idx" ON "relationship_context_embedding_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_context_embeddings_current_idx" ON "relationship_context_embeddings" USING btree ("owner_user_id","record_kind","record_id","embedding_model","embedding_version");--> statement-breakpoint
CREATE INDEX "relationship_context_embeddings_owner_record_idx" ON "relationship_context_embeddings" USING btree ("owner_user_id","record_kind","record_id");--> statement-breakpoint
CREATE INDEX "relationship_context_embeddings_owner_person_idx" ON "relationship_context_embeddings" USING btree ("owner_user_id","person_id");--> statement-breakpoint
CREATE INDEX "relationship_context_embeddings_compat_idx" ON "relationship_context_embeddings" USING btree ("owner_user_id","embedding_model","embedding_version","embedding_dimensions");
