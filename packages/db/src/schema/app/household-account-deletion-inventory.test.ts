import { HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS } from "@tendnote/domain";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { user } from "../auth";
import { assetEvidence, assetEvidenceFiles } from "./asset-evidence";
import { assetLinks, assetPersonLinks } from "./asset-links";
import { assetMemories } from "./asset-memories";
import { assetReviewGroups } from "./asset-review-groups";
import { assetSnapshots } from "./asset-snapshots";
import { assetAuditEvents, assets } from "./assets";
import { auditLog } from "./audit-log";
import { contextFacts } from "./context-facts";
import { generalActionAssets } from "./general-action-assets";
import { generalActionEvents, generalActionOfferDeclines, generalActions } from "./general-actions";
import { householdCalendarConnections } from "./household-calendar";
import { householdEventPlanLinks, householdEventPlans } from "./household-event-plans";
import { householdInvitations } from "./household-invitations";
import {
  householdDissolutionConfirmations,
  householdMemberships,
  householdRecordShares,
  householdWorkspaces,
} from "./households";
import { personReferences } from "./person-references";
import { savedItemEvents, savedItems } from "./saved-items";

const HOUSEHOLD_ACCOUNT_DELETION_TABLES: PgTable[] = [
  householdWorkspaces,
  householdMemberships,
  householdDissolutionConfirmations,
  householdRecordShares,
  householdInvitations,
  auditLog,
  savedItems,
  savedItemEvents,
  generalActions,
  generalActionEvents,
  generalActionOfferDeclines,
  assets,
  assetAuditEvents,
  assetMemories,
  assetEvidence,
  assetEvidenceFiles,
  assetLinks,
  assetPersonLinks,
  assetSnapshots,
  assetReviewGroups,
  contextFacts,
  householdEventPlans,
  householdEventPlanLinks,
  householdCalendarConnections,
  personReferences,
  generalActionAssets,
];

const OPERATIONAL_MEMBER_KEYS = [
  "general_actions.owner_user_id",
  "general_action_events.owner_user_id",
  "assets.owner_user_id",
  "asset_audit_events.owner_user_id",
  "asset_memories.owner_user_id",
  "asset_evidence.owner_user_id",
  "asset_evidence_files.owner_user_id",
];

describe("the household account-deletion foreign-key inventory", () => {
  it("classifies every user foreign key on the affected schema graph", () => {
    const foreignKeys = HOUSEHOLD_ACCOUNT_DELETION_TABLES.flatMap((table) => {
      const config = getTableConfig(table);
      return config.foreignKeys.flatMap((foreignKey) => {
        const reference = foreignKey.reference();
        return reference.foreignTable === user
          ? reference.columns.map((column) => `${config.name}.${column.name}`)
          : [];
      });
    });
    const actual = [...new Set([...foreignKeys, ...OPERATIONAL_MEMBER_KEYS])].sort();
    const classified = HOUSEHOLD_ACCOUNT_DELETION_FOREIGN_KEYS.map(
      ({ table, column }) => `${table}.${column}`,
    ).sort();

    expect(classified).toEqual(actual);
  });
});
