-- Drizzle runs pending migrations in one transaction. An immutable helper lets
-- this index be created after the enum additions without evaluating a newly
-- added enum literal before that transaction commits.
CREATE FUNCTION "public"."is_self_hosted_bootstrap_access_source"("value" "public"."access_source")
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$ SELECT "value"::text = 'self_hosted_bootstrap' $$;--> statement-breakpoint
CREATE UNIQUE INDEX "access_profiles_single_self_hosted_bootstrap_idx" ON "access_profiles" USING btree ("source") WHERE "public"."is_self_hosted_bootstrap_access_source"("access_profiles"."source");
