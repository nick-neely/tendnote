CREATE TABLE "operator_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"alerted_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operator_alerts_open_condition_idx" ON "operator_alerts" USING btree ("condition") WHERE "operator_alerts"."cleared_at" is null;