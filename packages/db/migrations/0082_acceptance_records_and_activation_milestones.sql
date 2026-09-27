CREATE TYPE "public"."activation_milestone" AS ENUM('first_person_created', 'first_memory_confirmed', 'first_followup_scheduled', 'first_grounded_eve_answer', 'first_value_reached');--> statement-breakpoint
CREATE TYPE "public"."legal_document_key" AS ENUM('terms_of_service', 'privacy_policy');--> statement-breakpoint
CREATE TABLE "acceptance_records" (
	"user_id" text NOT NULL,
	"document_key" "legal_document_key" NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptance_records_pkey" PRIMARY KEY("user_id","document_key","version")
);
--> statement-breakpoint
CREATE TABLE "activation_milestones" (
	"user_id" text NOT NULL,
	"milestone" "activation_milestone" NOT NULL,
	"reached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_milestones_pkey" PRIMARY KEY("user_id","milestone")
);
--> statement-breakpoint
ALTER TABLE "acceptance_records" ADD CONSTRAINT "acceptance_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_milestones" ADD CONSTRAINT "activation_milestones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;