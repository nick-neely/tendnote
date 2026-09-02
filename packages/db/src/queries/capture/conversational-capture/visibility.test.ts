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

  /**
   * Whose sentence it is decides whether the sentence gets to name an audience.
   * In the Capture box `originalText` is the owner's keystrokes; through Eve it is
   * a model's transcription of a turn, and anything Eve merely read - a pasted
   * email, a fetched page, a household member's note - can put an audience suffix
   * in it. Eve therefore asks with `requestedScope`, which parks for the owner's
   * approval, and gets nothing from the words.
   */
  describe("an audience read out of the text is only the owner's own instruction", () => {
    it("ignores a household suffix that arrived through Eve", async () => {
      const listMemberships = vi.fn().mockResolvedValue([{ householdId: "household-1" }]);
      const resolve = createCaptureVisibilityResolver({ listMemberships, listMembers: vi.fn() });

      await expect(
        resolve({
          ownerUserId: "owner-1",
          originalText: "Remember that Priya likes tea and share with my household",
          surface: "eve",
        }),
      ).resolves.toEqual({
        scope: "private",
        householdId: null,
        selectedUserIds: [],
        label: "Only me",
        // Retained whole: nothing was stripped, because nothing was obeyed.
        captureText: "Remember that Priya likes tea and share with my household",
      });
      expect(listMemberships).not.toHaveBeenCalled();
    });

    it("ignores a named-member suffix that arrived through Eve", async () => {
      const listMembers = vi.fn().mockResolvedValue([
        {
          householdId: "household-1",
          userId: "member-1",
          name: "Alex",
          email: "alex@example.com",
        },
      ]);
      const resolve = createCaptureVisibilityResolver({
        listMemberships: vi.fn(),
        listMembers,
      });

      await expect(
        resolve({
          ownerUserId: "owner-1",
          originalText: "Add a note about the filter; share with Alex",
          surface: "eve",
        }),
      ).resolves.toMatchObject({ scope: "private", label: "Only me" });
      expect(listMembers).not.toHaveBeenCalled();
    });

    it("still honours the deliberate scope Eve asks for, which is approval-gated", async () => {
      const resolve = createCaptureVisibilityResolver({
        listMemberships: vi.fn().mockResolvedValue([{ householdId: "household-1" }]),
        listMembers: vi.fn(),
      });

      await expect(
        resolve({
          ownerUserId: "owner-1",
          originalText: "The recycling goes out on Tuesdays",
          requestedScope: "household",
          surface: "eve",
        }),
      ).resolves.toMatchObject({ scope: "household", householdId: "household-1" });
    });

    it("keeps the Capture box reading its own text, suffix and all", async () => {
      const resolve = createCaptureVisibilityResolver({
        listMemberships: vi.fn().mockResolvedValue([{ householdId: "household-1" }]),
        listMembers: vi.fn(),
      });

      await expect(
        resolve({
          ownerUserId: "owner-1",
          originalText: "Remember that Priya likes tea and share with my household",
          surface: "global_capture",
        }),
      ).resolves.toMatchObject({
        scope: "household",
        householdId: "household-1",
        captureText: "Remember that Priya likes tea",
      });
    });
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
