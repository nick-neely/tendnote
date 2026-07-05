CREATE TYPE "public"."discord_target_kind" AS ENUM('channel', 'dm');--> statement-breakpoint
CREATE TABLE "discord_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"target_kind" "discord_target_kind",
	"target_channel_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"scopes" jsonb,
	"permissions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_installs" ADD CONSTRAINT "discord_installs_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_installs_owner_guild_idx" ON "discord_installs" USING btree ("owner_user_id","guild_id");--> statement-breakpoint
CREATE INDEX "discord_installs_owner_user_id_idx" ON "discord_installs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "discord_installs_guild_id_idx" ON "discord_installs" USING btree ("guild_id");