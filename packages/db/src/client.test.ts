import { describe, expect, it } from "vitest";
import { resolveDatabaseDriver } from "./client";

describe("production database driver selection", () => {
  it("uses the transaction-capable Postgres driver for Neon URLs by default", () => {
    expect(
      resolveDatabaseDriver({
        databaseUrl: "postgresql://example.neon.tech/tendnote",
      }),
    ).toBe("postgres");
  });

  it("rejects the transaction-incompatible Neon HTTP driver", () => {
    expect(() =>
      resolveDatabaseDriver({
        databaseUrl: "postgresql://example.neon.tech/tendnote",
        configuredDriver: "neon-http",
      }),
    ).toThrow(/does not support the transactions required by Tendnote/);
  });

  it("rejects unknown driver values instead of silently changing behavior", () => {
    expect(() =>
      resolveDatabaseDriver({
        databaseUrl: "postgresql://localhost/tendnote",
        configuredDriver: "surprise-driver",
      }),
    ).toThrow(/Unsupported DATABASE_DRIVER/);
  });
});
