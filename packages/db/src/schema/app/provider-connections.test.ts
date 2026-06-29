import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { providerConnections } from "./provider-connections";

describe("provider_connections schema shape", () => {
  const columns = getTableColumns(providerConnections);
  const columnNames = Object.values(columns).map((c) => c.name);

  it("is keyed by owner + generic provider/capability keys", () => {
    expect(columnNames).toEqual(
      expect.arrayContaining(["owner_user_id", "provider_key", "capability_key", "status"]),
    );
  });

  it("stores only non-secret lifecycle state", () => {
    expect(new Set(columnNames)).toEqual(
      new Set([
        "id",
        "owner_user_id",
        "provider_key",
        "capability_key",
        "status",
        "display_identity",
        "authorized_scopes",
        "connected_at",
        "revoked_at",
        "last_error_at",
        "last_error_message",
        "revocation_reason",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("has no token, cursor, or raw-provider-payload columns", () => {
    const joined = columnNames.join(" ");
    for (const forbidden of [
      "token",
      "refresh",
      "cursor",
      "watermark",
      "payload",
      "calendar",
      "gmail",
      "contacts",
      "secret",
    ]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  it("enforces one connection per owner + provider capability", () => {
    const { indexes } = getTableConfig(providerConnections);
    const unique = indexes.find((i) => i.config.unique);
    expect(unique?.config.columns.map((c) => ("name" in c ? c.name : undefined))).toEqual([
      "owner_user_id",
      "provider_key",
      "capability_key",
    ]);
  });

  it("does not introduce a workspace/product-context column", () => {
    const joined = columnNames.join(" ");
    for (const forbidden of ["workspace", "tenant", "context_id", "scope_id"]) {
      expect(joined).not.toContain(forbidden);
    }
  });
});
