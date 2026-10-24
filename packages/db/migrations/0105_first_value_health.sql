CREATE TABLE "first_value_health" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_alerts" ADD COLUMN "first_value_context" jsonb;