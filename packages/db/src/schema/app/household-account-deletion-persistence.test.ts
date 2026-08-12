import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { assetEvidence, assetEvidenceFiles } from "./asset-evidence";
import { assetMemories } from "./asset-memories";
import { assetAuditEvents, assets } from "./assets";
import { generalActionAssets } from "./general-action-assets";
import { generalActionEvents, generalActions } from "./general-actions";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../migrations/0071_preserve_household_records_on_account_delete.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("household account-deletion persistence", () => {
  it.each([
    generalActions,
    generalActionEvents,
    assets,
    assetAuditEvents,
    assetMemories,
    assetEvidence,
    assetEvidenceFiles,
  ])("keeps $name operational owner keys non-null and detached from user FKs", (table) => {
    const config = getTableConfig(table);
    const owner = config.columns.find((column) => column.name === "owner_user_id");
    const foreignKey = config.foreignKeys.find(
      (candidate) => candidate.reference().columns[0]?.name === "owner_user_id",
    );

    expect(owner?.notNull).toBe(true);
    expect(foreignKey).toBeUndefined();
  });

  it("reassigns household-native operational keys before the user cascade", () => {
    expect(migration).toContain('CREATE TRIGGER "prepare_household_account_deletion"');
    for (const table of ["general_actions", "assets", "asset_memories", "asset_evidence"]) {
      expect(migration).toContain(`UPDATE "${table}" record`);
      expect(migration).toContain(`record."ownership" = 'household_native'`);
    }
    expect(migration).toContain('UPDATE "general_action_events" event');
    expect(migration).toContain('UPDATE "asset_audit_events" event');
    expect(migration).toContain('UPDATE "asset_evidence_files" file');
  });

  it("deletes member-owned roots explicitly while preserving sole-member household roots", () => {
    for (const table of ["general_actions", "assets", "asset_memories", "asset_evidence"]) {
      expect(migration).toContain(`DELETE FROM "${table}" record`);
      expect(migration).toContain(`record."ownership" = 'member_owned'`);
    }
    expect(migration).not.toContain('event."action_id"');
    expect(migration).toContain('event."general_action_id"');
  });

  it("keeps detached member-owned keys foreign-key strict without rejecting opaque household keys", () => {
    expect(migration).toContain('CREATE FUNCTION "tendnote_require_member_owned_user"');
    expect(migration).toContain("NEW.\"ownership\" = 'member_owned'");
    expect(migration).toContain('FROM "user" WHERE "id" = NEW."owner_user_id"');
    expect(migration).toContain("ERRCODE = 'foreign_key_violation'");
    for (const table of ["general_actions", "assets", "asset_memories", "asset_evidence"]) {
      expect(migration).toContain(`CREATE TRIGGER "${table}_member_owner_exists"`);
      expect(migration).toContain(`ON "${table}"`);
    }
  });

  it("refuses to strand a multi-member household without an owner", () => {
    expect(migration).toContain(
      "another active household owner is required before account deletion",
    );
    expect(migration).toContain("ERRCODE = 'check_violation'");
  });

  it("locks governance and dissolves a sole member atomically with user deletion", () => {
    expect(migration).toContain("FOR UPDATE OF workspace");
    expect(migration).toContain('UPDATE "household_workspaces"');
    expect(migration).toContain("SET \"status\" = 'dissolved'");
    expect(migration).toContain("'transition', 'account_deletion'");
  });

  it("dissolves every sole-member workspace even if legacy data contains more than one", () => {
    expect(migration).toContain("FOR sole_household IN");
    expect(migration).toContain("END LOOP;");
    expect(migration).not.toContain("INTO sole_household_id");
  });

  it("performs the complete access-ending cleanup for sole-member dissolution", () => {
    expect(migration).toContain('UPDATE "household_invitations"');
    expect(migration).toContain("'canceled'::household_invitation_state");
    expect(migration).toContain('DELETE FROM "household_record_shares"');
    expect(migration).toContain('DELETE FROM "household_dissolution_confirmations"');
    expect(migration).toContain('DELETE FROM "reminder_schedules"');
    expect(migration).toContain('DELETE FROM "household_calendar_event_cache"');
    expect(migration).toContain('UPDATE "household_calendar_connections"');
    expect(migration).toContain("'household_dissolved'");
    expect(migration).toContain('UPDATE "household_memberships"');
    expect(migration).toContain('INSERT INTO "audit_log"');
  });

  it("scrubs workspace and retained provenance", () => {
    for (const constraint of [
      "household_workspaces_owner_user_id_user_id_fk",
      "household_event_plans_created_by_user_id_user_id_fk",
      "household_event_plan_links_linked_by_user_id_user_id_fk",
      "context_facts_creator_user_id_user_id_fk",
      "general_action_assets_owner_user_id_user_id_fk",
      "person_references_created_by_user_id_user_id_fk",
    ]) {
      expect(migration).toMatch(
        new RegExp(`ADD CONSTRAINT "${constraint}"[^;]+ON DELETE set null`),
      );
    }

    const generalActionAssetConfig = getTableConfig(generalActionAssets);
    const creator = generalActionAssetConfig.columns.find(
      (column) => column.name === "owner_user_id",
    );
    const creatorForeignKey = generalActionAssetConfig.foreignKeys.find(
      (candidate) => candidate.reference().columns[0]?.name === "owner_user_id",
    );
    expect(creator?.notNull).toBe(false);
    expect(creatorForeignKey?.onDelete).toBe("set null");
  });
});
