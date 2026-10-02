CREATE TYPE "public"."cost_category" AS ENUM('interactive', 'background', 'web_search');--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"model_id" text NOT NULL,
	"cost_category" "cost_category" NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_ledger_pkey" PRIMARY KEY("user_id","day","model_id","cost_category")
);
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_ledger_day_idx" ON "usage_ledger" USING btree ("day");