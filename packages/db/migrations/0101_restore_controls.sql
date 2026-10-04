CREATE TABLE "outbound_pause" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"paused_at" timestamp with time zone NOT NULL,
	CONSTRAINT "outbound_pause_singleton" CHECK ("outbound_pause"."singleton")
);
--> statement-breakpoint
CREATE TABLE "restored_email_fences" (
	"digest" text PRIMARY KEY NOT NULL,
	"fenced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "restored_email_fences_fenced_at_idx" ON "restored_email_fences" USING btree ("fenced_at");