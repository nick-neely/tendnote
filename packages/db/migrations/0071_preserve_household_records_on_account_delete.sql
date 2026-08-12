ALTER TABLE "asset_evidence" DROP CONSTRAINT "asset_evidence_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_evidence_files" DROP CONSTRAINT "asset_evidence_files_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_memories" DROP CONSTRAINT "asset_memories_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_audit_events" DROP CONSTRAINT "asset_audit_events_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "context_facts" DROP CONSTRAINT "context_facts_creator_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "context_facts" DROP CONSTRAINT "context_facts_last_actor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "general_action_events" DROP CONSTRAINT "general_action_events_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "general_actions" DROP CONSTRAINT "general_actions_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_calendar_connections" DROP CONSTRAINT "household_calendar_connections_designated_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_event_plan_links" DROP CONSTRAINT "household_event_plan_links_linked_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_event_plans" DROP CONSTRAINT "household_event_plans_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_event_plans" DROP CONSTRAINT "household_event_plans_last_actor_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_invitations" DROP CONSTRAINT "household_invitations_invited_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_memberships" DROP CONSTRAINT "household_memberships_invited_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "household_workspaces" DROP CONSTRAINT "household_workspaces_owner_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "person_references" DROP CONSTRAINT "person_references_created_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "context_facts" ALTER COLUMN "creator_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "context_facts" ALTER COLUMN "last_actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_calendar_connections" ALTER COLUMN "designated_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_event_plan_links" ALTER COLUMN "linked_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_event_plans" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_event_plans" ALTER COLUMN "last_actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_invitations" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_memberships" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "household_workspaces" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "person_references" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_creator_user_id_user_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_facts" ADD CONSTRAINT "context_facts_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_calendar_connections" ADD CONSTRAINT "household_calendar_connections_designated_by_user_id_user_id_fk" FOREIGN KEY ("designated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plan_links" ADD CONSTRAINT "household_event_plan_links_linked_by_user_id_user_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plans" ADD CONSTRAINT "household_event_plans_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_event_plans" ADD CONSTRAINT "household_event_plans_last_actor_user_id_user_id_fk" FOREIGN KEY ("last_actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_workspaces" ADD CONSTRAINT "household_workspaces_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_references" ADD CONSTRAINT "person_references_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_ownership_check" CHECK ((
    ("asset_evidence"."ownership" = 'member_owned' and "asset_evidence"."owner_user_id" is not null)
    or (
      "asset_evidence"."ownership" = 'household_native'
      and "asset_evidence"."household_id" is not null
      and "asset_evidence"."scope" = 'household'
    )
  ));--> statement-breakpoint
ALTER TABLE "asset_memories" ADD CONSTRAINT "asset_memories_ownership_check" CHECK ((
    ("asset_memories"."ownership" = 'member_owned' and "asset_memories"."owner_user_id" is not null)
    or (
      "asset_memories"."ownership" = 'household_native'
      and "asset_memories"."household_id" is not null
      and "asset_memories"."scope" = 'household'
    )
  ));--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_ownership_check" CHECK ((
    ("assets"."ownership" = 'member_owned' and "assets"."owner_user_id" is not null)
    or (
      "assets"."ownership" = 'household_native'
      and "assets"."household_id" is not null
      and "assets"."scope" = 'household'
    )
  ));--> statement-breakpoint
ALTER TABLE "general_actions" ADD CONSTRAINT "general_actions_ownership_check" CHECK ((
    ("general_actions"."ownership" = 'member_owned' and "general_actions"."owner_user_id" is not null)
    or (
      "general_actions"."ownership" = 'household_native'
      and "general_actions"."household_id" is not null
      and "general_actions"."scope" = 'household'
    )
  ));--> statement-breakpoint
CREATE FUNCTION "tendnote_require_member_owned_user"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."ownership" = 'member_owned'
    AND NOT EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW."owner_user_id")
  THEN
    RAISE EXCEPTION 'member-owned record owner must reference an existing user'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "general_actions_member_owner_exists"
BEFORE INSERT OR UPDATE OF "owner_user_id", "ownership" ON "general_actions"
FOR EACH ROW EXECUTE FUNCTION "tendnote_require_member_owned_user"();--> statement-breakpoint
CREATE TRIGGER "assets_member_owner_exists"
BEFORE INSERT OR UPDATE OF "owner_user_id", "ownership" ON "assets"
FOR EACH ROW EXECUTE FUNCTION "tendnote_require_member_owned_user"();--> statement-breakpoint
CREATE TRIGGER "asset_memories_member_owner_exists"
BEFORE INSERT OR UPDATE OF "owner_user_id", "ownership" ON "asset_memories"
FOR EACH ROW EXECUTE FUNCTION "tendnote_require_member_owned_user"();--> statement-breakpoint
CREATE TRIGGER "asset_evidence_member_owner_exists"
BEFORE INSERT OR UPDATE OF "owner_user_id", "ownership" ON "asset_evidence"
FOR EACH ROW EXECUTE FUNCTION "tendnote_require_member_owned_user"();--> statement-breakpoint
CREATE FUNCTION "tendnote_account_deletion_replacement"(
  target_household_id uuid,
  deleting_user_id text
) RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT "user_id"
  FROM "household_memberships"
  WHERE "household_id" = target_household_id
    AND "status" = 'active'
    AND "user_id" <> deleting_user_id
  ORDER BY "user_id"
  LIMIT 1
$$;--> statement-breakpoint
CREATE FUNCTION "tendnote_prepare_user_delete"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sole_household record;
  transition_at timestamptz := now();
BEGIN
  -- Serialize admission, role changes, and deletion against the same workspace
  -- row governance uses. The decision below cannot go stale before the user
  -- deletion commits because this trigger runs inside that deletion statement.
  PERFORM workspace."id"
  FROM "household_workspaces" workspace
  JOIN "household_memberships" membership ON membership."household_id" = workspace."id"
  WHERE membership."user_id" = OLD."id" AND membership."status" = 'active'
  FOR UPDATE OF workspace;

  IF EXISTS (
    SELECT 1
    FROM "household_memberships" deleting_membership
    WHERE deleting_membership."user_id" = OLD."id"
      AND deleting_membership."status" = 'active'
      AND deleting_membership."role" = 'owner'
      AND (SELECT count(*) FROM "household_memberships" members
           WHERE members."household_id" = deleting_membership."household_id"
             AND members."status" = 'active') > 1
      AND (SELECT count(*) FROM "household_memberships" owners
           WHERE owners."household_id" = deleting_membership."household_id"
             AND owners."status" = 'active'
             AND owners."role" = 'owner') = 1
  ) THEN
    RAISE EXCEPTION 'another active household owner is required before account deletion'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR sole_household IN
  SELECT deleting_membership."household_id" AS id
  FROM "household_memberships" deleting_membership
  WHERE deleting_membership."user_id" = OLD."id"
    AND deleting_membership."status" = 'active'
    AND (SELECT count(*) FROM "household_memberships" members
         WHERE members."household_id" = deleting_membership."household_id"
           AND members."status" = 'active') = 1
  LOOP

  -- A sole member's account deletion is the unanimous one-owner dissolution.
  -- Perform the same access-ending cleanup as explicit dissolution inside this
  -- deletion transaction. The workspace and household-native records survive
  -- for recovery, but no invitation, share, reminder, provider cache, or active
  -- membership may describe a Household that has already ended.
    UPDATE "household_invitations"
    SET "state" = CASE
          WHEN "expires_at" > transition_at THEN 'canceled'::household_invitation_state
          ELSE 'expired'::household_invitation_state
        END,
        "resolved_at" = transition_at,
        "updated_at" = transition_at
    WHERE "household_id" = sole_household.id
      AND "state" = 'pending';

    DELETE FROM "household_record_shares"
    WHERE "household_id" = sole_household.id;

    DELETE FROM "household_dissolution_confirmations"
    WHERE "household_id" = sole_household.id;

    DELETE FROM "reminder_schedules"
    WHERE "record_id" IN (
      SELECT "id" FROM "general_actions"
      WHERE "household_id" = sole_household.id
    );

    DELETE FROM "household_calendar_event_cache"
    WHERE "connection_id" IN (
      SELECT "id" FROM "household_calendar_connections"
      WHERE "household_id" = sole_household.id
        AND "status" = 'connected'
    );

    UPDATE "household_calendar_connections"
    SET "status" = 'disconnected',
        "disconnected_at" = transition_at,
        "disconnected_reason" = 'household_dissolved',
        "updated_at" = transition_at
    WHERE "household_id" = sole_household.id
      AND "status" = 'connected';

    UPDATE "household_memberships"
    SET "status" = 'removed',
        "removed_at" = transition_at,
        "pending_role" = NULL,
        "pending_role_offered_by_user_id" = NULL,
        "pending_role_offered_at" = NULL,
        "updated_at" = transition_at
    WHERE "household_id" = sole_household.id
      AND "status" = 'active';

    UPDATE "household_workspaces"
    SET "status" = 'dissolved',
        "dissolved_at" = transition_at,
        "updated_at" = transition_at
    WHERE "id" = sole_household.id;

    INSERT INTO "audit_log" (
      "owner_user_id", "action", "entity_type", "entity_id", "metadata_json"
    ) VALUES (
      OLD."id",
      'household.dissolve',
      'household',
      sole_household.id::text,
      jsonb_build_object(
        'householdId', sole_household.id,
        'transition', 'account_deletion',
        'recovery', 'support-only'
      )
    );
  END LOOP;

  UPDATE "general_actions" record
  SET "owner_user_id" = "tendnote_account_deletion_replacement"(record."household_id", OLD."id")
  WHERE record."owner_user_id" = OLD."id"
    AND record."ownership" = 'household_native'
    AND "tendnote_account_deletion_replacement"(record."household_id", OLD."id") IS NOT NULL;

  UPDATE "general_action_events" event
  SET "owner_user_id" = action."owner_user_id"
  FROM "general_actions" action
  WHERE event."general_action_id" = action."id"
    AND event."owner_user_id" = OLD."id"
    AND action."ownership" = 'household_native';

  UPDATE "assets" record
  SET "owner_user_id" = "tendnote_account_deletion_replacement"(record."household_id", OLD."id")
  WHERE record."owner_user_id" = OLD."id"
    AND record."ownership" = 'household_native'
    AND "tendnote_account_deletion_replacement"(record."household_id", OLD."id") IS NOT NULL;

  UPDATE "asset_audit_events" event
  SET "owner_user_id" = asset."owner_user_id"
  FROM "assets" asset
  WHERE event."asset_id" = asset."id"
    AND event."owner_user_id" = OLD."id"
    AND asset."ownership" = 'household_native';

  UPDATE "asset_memories" record
  SET "owner_user_id" = "tendnote_account_deletion_replacement"(record."household_id", OLD."id")
  WHERE record."owner_user_id" = OLD."id"
    AND record."ownership" = 'household_native'
    AND "tendnote_account_deletion_replacement"(record."household_id", OLD."id") IS NOT NULL;

  UPDATE "asset_evidence" record
  SET "owner_user_id" = "tendnote_account_deletion_replacement"(record."household_id", OLD."id")
  WHERE record."owner_user_id" = OLD."id"
    AND record."ownership" = 'household_native'
    AND "tendnote_account_deletion_replacement"(record."household_id", OLD."id") IS NOT NULL;

  UPDATE "asset_evidence_files" file
  SET "owner_user_id" = evidence."owner_user_id"
  FROM "asset_evidence" evidence
  WHERE file."evidence_id" = evidence."id"
    AND file."owner_user_id" = OLD."id"
    AND evidence."ownership" = 'household_native';

  DELETE FROM "asset_evidence" record
  WHERE record."owner_user_id" = OLD."id" AND record."ownership" = 'member_owned';
  DELETE FROM "asset_memories" record
  WHERE record."owner_user_id" = OLD."id" AND record."ownership" = 'member_owned';
  DELETE FROM "assets" record
  WHERE record."owner_user_id" = OLD."id" AND record."ownership" = 'member_owned';
  DELETE FROM "general_actions" record
  WHERE record."owner_user_id" = OLD."id" AND record."ownership" = 'member_owned';

  RETURN OLD;
END
$$;--> statement-breakpoint
CREATE TRIGGER "prepare_household_account_deletion"
BEFORE DELETE ON "user"
FOR EACH ROW
EXECUTE FUNCTION "tendnote_prepare_user_delete"();
