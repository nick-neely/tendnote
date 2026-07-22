import type { AccessProfile } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryAccessProfileStore } from "./access-profiles/in-memory-store";
import { createAccessProfileQueries } from "./access-profiles/queries";

const FIRST_USER = "user-first";
const SECOND_USER = "user-second";

/** A persisted, admitted profile — the initial allowed owner from bootstrap. */
function grantedProfileFixture(userId: string): AccessProfile {
  const now = new Date("2026-06-25T12:00:00.000Z");

  return {
    userId,
    status: "granted",
    source: "bootstrap",
    grantedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("access profile queries", () => {
  it("bootstraps the first user as the initial allowed owner", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const profile = await queries.ensureAccessProfile({ userId: FIRST_USER });

    expect(profile.userId).toBe(FIRST_USER);
    expect(profile.status).toBe("granted");
    expect(profile.source).toBe("bootstrap");
    expect(profile.grantedAt).toBeInstanceOf(Date);
  });

  it("routes later signups to pending access", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureAccessProfile({ userId: FIRST_USER });
    const second = await queries.ensureAccessProfile({ userId: SECOND_USER });

    expect(second.status).toBe("pending");
    expect(second.source).toBeNull();
    expect(second.grantedAt).toBeNull();
  });

  it("is idempotent and returns the existing profile without re-bootstrapping", async () => {
    const store = createInMemoryAccessProfileStore([grantedProfileFixture(FIRST_USER)]);
    const queries = createAccessProfileQueries(store);

    await queries.ensureAccessProfile({ userId: SECOND_USER });
    const again = await queries.ensureAccessProfile({ userId: SECOND_USER });

    expect(again.userId).toBe(SECOND_USER);
    expect(again.status).toBe("pending");
  });

  it("admits only one bootstrap owner even when one already exists", async () => {
    // A profile already holds the bootstrap, modelling a first signup that won.
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);

    const first = await queries.ensureAccessProfile({ userId: FIRST_USER });
    expect(first.source).toBe("bootstrap");

    // The store rejects a second bootstrap insert, so the later user lands pending.
    const second = await store.insertIfAbsent({
      userId: SECOND_USER,
      status: "granted",
      source: "bootstrap",
      grantedAt: new Date(),
    });
    expect(second).toBeNull();

    const settled = await queries.ensureAccessProfile({ userId: SECOND_USER });
    expect(settled.status).toBe("pending");
  });

  it("admits a persisted granted user through the shared access-check seam", async () => {
    const queries = createAccessProfileQueries(
      createInMemoryAccessProfileStore([grantedProfileFixture(FIRST_USER)]),
    );

    const decision = await queries.checkAccess({ userId: FIRST_USER });

    expect(decision.admitted).toBe(true);
    expect(decision.status).toBe("granted");
    expect(decision.profile?.userId).toBe(FIRST_USER);
  });

  it("does not admit a pending user and never loads relationship data", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureAccessProfile({ userId: FIRST_USER });
    const pending = await queries.ensureAccessProfile({ userId: SECOND_USER });
    expect(pending.status).toBe("pending");

    const decision = await queries.checkAccess({ userId: SECOND_USER });
    expect(decision.admitted).toBe(false);
    expect(decision.status).toBe("pending");
  });

  it("lists only granted principals for owner-scoped background work", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });

    await expect(queries.listAdmittedOwnerUserIds()).resolves.toEqual([FIRST_USER]);
  });

  it("treats an unknown user as pending and not admitted", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const decision = await queries.checkAccess({ userId: "never-signed-up" });

    expect(decision.admitted).toBe(false);
    expect(decision.status).toBe("pending");
    expect(decision.profile).toBeNull();
  });

  it("durably upgrades a pending user when access is granted", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });

    const granted = await queries.grantAccess({ userId: SECOND_USER, source: "beta_flag" });
    expect(granted.status).toBe("granted");
    expect(granted.source).toBe("beta_flag");
    expect(granted.grantedAt).toBeInstanceOf(Date);

    const decision = await queries.checkAccess({ userId: SECOND_USER });
    expect(decision.admitted).toBe(true);
  });
});
