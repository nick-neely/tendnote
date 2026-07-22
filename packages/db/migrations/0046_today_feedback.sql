CREATE TYPE "public"."today_feedback_kind" AS ENUM('later', 'not_today');--> statement-breakpoint
CREATE TABLE "today_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"candidate_identity" text NOT NULL,
	"reason_key" text NOT NULL,
	"kind" "today_feedback_kind" NOT NULL,
	"local_date" date NOT NULL,
	"suppress_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "today_feedback" ADD CONSTRAINT "today_feedback_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "today_feedback_candidate_reason_kind_idx" ON "today_feedback" USING btree ("owner_user_id","candidate_identity","reason_key","kind");--> statement-breakpoint
CREATE INDEX "today_feedback_owner_local_date_idx" ON "today_feedback" USING btree ("owner_user_id","local_date");--> statement-breakpoint
CREATE INDEX "today_feedback_owner_suppress_until_idx" ON "today_feedback" USING btree ("owner_user_id","suppress_until");
