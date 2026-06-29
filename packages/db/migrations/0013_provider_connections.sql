CREATE TYPE "public"."provider_connection_status" AS ENUM('ready', 'pending', 'connected', 'revoked', 'error', 'unavailable');--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"capability_key" text NOT NULL,
	"status" "provider_connection_status" DEFAULT 'ready' NOT NULL,
	"display_identity" text,
	"authorized_scopes" jsonb,
	"connected_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_connections_owner_user_id_idx" ON "provider_connections" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_owner_capability_idx" ON "provider_connections" USING btree ("owner_user_id","provider_key","capability_key");