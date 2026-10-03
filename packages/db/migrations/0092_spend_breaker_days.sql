CREATE TABLE "spend_breaker_days" (
	"day" date PRIMARY KEY NOT NULL,
	"admitted_accounts" integer NOT NULL,
	"ceiling_micro_usd" bigint NOT NULL,
	"background_shed_at" timestamp with time zone,
	"scheduled_shed_at" timestamp with time zone,
	"interactive_shed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
