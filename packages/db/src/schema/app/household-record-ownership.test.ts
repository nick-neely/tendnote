import {
  assetOwnershipSchema,
  generalActionOwnershipSchema,
  HOUSEHOLD_RECORD_OWNERSHIP_VALUES,
  savedItemOwnershipSchema,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { assetOwnership, generalActionOwnership, householdRecordOwnership } from "./enums";

describe("household record ownership vocabulary", () => {
  it("shares values while retaining family-specific PostgreSQL enum names", () => {
    for (const schema of [
      savedItemOwnershipSchema,
      generalActionOwnershipSchema,
      assetOwnershipSchema,
    ]) {
      expect(schema.options).toEqual(HOUSEHOLD_RECORD_OWNERSHIP_VALUES);
    }

    const databaseEnums = [householdRecordOwnership, generalActionOwnership, assetOwnership];
    for (const databaseEnum of databaseEnums) {
      expect(databaseEnum.enumValues).toEqual(HOUSEHOLD_RECORD_OWNERSHIP_VALUES);
    }
    expect(databaseEnums.map((databaseEnum) => databaseEnum.enumName)).toEqual([
      "household_record_ownership",
      "general_action_ownership",
      "asset_ownership",
    ]);
  });
});
