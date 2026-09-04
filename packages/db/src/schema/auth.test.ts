import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { account } from "./auth";

const issuerMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/0079_better_auth_account_issuer.sql", import.meta.url)),
  "utf8",
);

describe("Better Auth account schema contract", () => {
  it("scopes account identities by required issuer and account id", () => {
    const columns = getTableColumns(account);
    expect(columns.issuer?.notNull).toBe(true);

    const { indexes } = getTableConfig(account);
    const issuerIdentity = indexes.find(
      (candidate) => candidate.config.name === "account_issuer_account_id_idx",
    );

    expect(issuerIdentity?.config.unique).toBe(true);
    expect(
      issuerIdentity?.config.columns.map((column) => ("name" in column ? column.name : undefined)),
    ).toEqual(["issuer", "account_id"]);
  });

  it("backfills existing accounts before enforcing the issuer identity key", () => {
    const addColumn = issuerMigration.indexOf('ADD COLUMN "issuer" text;');
    const backfill = issuerMigration.indexOf('UPDATE "account"');
    const rejectUnknown = issuerMigration.indexOf("unsupported Better Auth provider_id");
    const requireIssuer = issuerMigration.indexOf('ALTER COLUMN "issuer" SET NOT NULL');
    const uniqueIdentity = issuerMigration.indexOf(
      'CREATE UNIQUE INDEX "account_issuer_account_id_idx"',
    );

    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(addColumn);
    expect(issuerMigration).toContain("'local:credential'");
    expect(issuerMigration).toContain("'https://accounts.google.com'");
    expect(issuerMigration).toContain("'local:oauth:' || \"provider_id\"");
    expect(rejectUnknown).toBeGreaterThan(backfill);
    expect(requireIssuer).toBeGreaterThan(rejectUnknown);
    expect(uniqueIdentity).toBeGreaterThan(requireIssuer);
  });
});
