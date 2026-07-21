import { describe, expect, it, vi } from "vitest";
import { createCaptureVisibilityResolver } from "./visibility";

describe("Capture visibility", () => {
  it("keeps Capture private when no audience is explicit or inherited", async () => {
    const resolve = createCaptureVisibilityResolver({
      listMemberships: vi.fn(),
      listMembers: vi.fn(),
    });

    await expect(
      resolve({ ownerUserId: "owner-1", originalText: "Remember that Priya likes tea" }),
    ).resolves.toEqual({
      scope: "private",
      householdId: null,
      selectedUserIds: [],
      label: "Only me",
      captureText: "Remember that Priya likes tea",
    });
  });

  it("strips and resolves an explicitly named household audience", async () => {
    const resolve = createCaptureVisibilityResolver({
      listMemberships: vi.fn().mockResolvedValue([{ householdId: "household-1" }]),
      listMembers: vi.fn(),
    });

    await expect(
      resolve({
        ownerUserId: "owner-1",
        originalText: "Remember that Priya likes tea and share with my household",
      }),
    ).resolves.toEqual({
      scope: "household",
      householdId: "household-1",
      selectedUserIds: [],
      label: "Household",
      captureText: "Remember that Priya likes tea",
    });
  });

  it("resolves one explicitly named active member and rejects an unknown audience", async () => {
    const resolve = createCaptureVisibilityResolver({
      listMemberships: vi.fn(),
      listMembers: vi.fn().mockResolvedValue([
        {
          householdId: "household-1",
          userId: "member-1",
          name: "Alex",
          email: "alex@example.com",
        },
      ]),
    });

    await expect(
      resolve({
        ownerUserId: "owner-1",
        originalText: "Add a note about the filter; share with Alex",
      }),
    ).resolves.toMatchObject({
      scope: "shared",
      householdId: "household-1",
      selectedUserIds: ["member-1"],
      label: "Alex",
      captureText: "Add a note about the filter",
    });
    await expect(
      resolve({
        ownerUserId: "owner-1",
        originalText: "Add a note about the filter; share with Nobody",
      }),
    ).rejects.toThrow("No active household member matches Nobody.");
  });

  it("inherits an already shared surface without changing the retained wording", async () => {
    const resolve = createCaptureVisibilityResolver({
      listMemberships: vi.fn(),
      listMembers: vi.fn(),
    });

    await expect(
      resolve({
        ownerUserId: "owner-1",
        originalText: "I need to order the filter",
        contextVisibility: {
          scope: "shared",
          householdId: "household-1",
          selectedUserIds: ["member-1"],
          label: "Alex",
        },
      }),
    ).resolves.toMatchObject({
      scope: "shared",
      selectedUserIds: ["member-1"],
      captureText: "I need to order the filter",
    });
  });
});
