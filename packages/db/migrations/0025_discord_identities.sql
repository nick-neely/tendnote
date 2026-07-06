CREATE TABLE "discord_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"display_identity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_identities" ADD CONSTRAINT "discord_identities_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discord_identities_owner_user_id_idx" ON "discord_identities" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_identities_discord_user_id_idx" ON "discord_identities" USING btree ("discord_user_id");
