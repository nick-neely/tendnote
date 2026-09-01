CREATE TABLE "eve_session_owners" (
	"session_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eve_session_owners" ADD CONSTRAINT "eve_session_owners_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eve_session_owners_owner_user_id_idx" ON "eve_session_owners" USING btree ("owner_user_id");