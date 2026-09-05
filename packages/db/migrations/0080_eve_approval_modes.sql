CREATE TYPE "public"."eve_approval_mode" AS ENUM('ask', 'trusted');--> statement-breakpoint
CREATE TABLE "eve_approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tier" text NOT NULL,
	"mode_at_decision" "eve_approval_mode" NOT NULL,
	"tainted" boolean NOT NULL,
	"outcome" text NOT NULL,
	"settled_outcome" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eve_session_tool_trusts" (
	"session_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eve_session_tool_trusts_pkey" PRIMARY KEY("session_id","tool_name")
);
--> statement-breakpoint
ALTER TABLE "access_profiles" ADD COLUMN "eve_approval_mode" "eve_approval_mode" DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE "eve_session_tool_trusts" ADD CONSTRAINT "eve_session_tool_trusts_session_id_eve_session_owners_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."eve_session_owners"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eve_session_tool_trusts" ADD CONSTRAINT "eve_session_tool_trusts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eve_approval_decisions_session_call_idx" ON "eve_approval_decisions" USING btree ("session_id","call_id");--> statement-breakpoint
CREATE INDEX "eve_session_tool_trusts_owner_user_id_idx" ON "eve_session_tool_trusts" USING btree ("owner_user_id");