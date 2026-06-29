CREATE TABLE "calendar_event_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider_key" text NOT NULL,
	"capability_key" text NOT NULL,
	"calendar_id" text NOT NULL,
	"window_key" text NOT NULL,
	"events" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event_cache" ADD CONSTRAINT "calendar_event_cache_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_cache_owner_user_id_idx" ON "calendar_event_cache" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "calendar_event_cache_expires_at_idx" ON "calendar_event_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_cache_key_idx" ON "calendar_event_cache" USING btree ("owner_user_id","provider_key","capability_key","calendar_id","window_key");