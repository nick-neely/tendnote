import { describe, expect, it, vi } from "vitest";
import { resolveScheduledOwnerUserIds } from "../agent/lib/schedule-owners";

describe("scheduled workflow owner resolution", () => {
  it("uses admitted owners in production and never falls back to the local demo owner", async () => {
    const listAdmittedOwnerUserIds = vi.fn().mockResolvedValue(["owner-1", "owner-2"]);

    await expect(
      resolveScheduledOwnerUserIds({
        env: { NODE_ENV: "production", TENDNOTE_DEV_OWNER_USER_ID: "demo-user" },
        listAdmittedOwnerUserIds,
      }),
    ).resolves.toEqual(["owner-1", "owner-2"]);
    expect(listAdmittedOwnerUserIds).toHaveBeenCalledOnce();
  });

  it("keeps the configurable demo owner for local development", async () => {
    const listAdmittedOwnerUserIds = vi.fn();

    await expect(
      resolveScheduledOwnerUserIds({
        env: { NODE_ENV: "development", TENDNOTE_DEV_OWNER_USER_ID: "local-owner" },
        listAdmittedOwnerUserIds,
      }),
    ).resolves.toEqual(["local-owner"]);
    expect(listAdmittedOwnerUserIds).not.toHaveBeenCalled();
  });
});
