import { describe, expect, it } from "vitest";
import type { ContextFactView } from "./context-facts";
import {
  buildHouseholdContextBoard,
  buildHouseholdContextReconciliation,
  type HouseholdContextActorIdentity,
  householdContextActorLabel,
  householdContextAttributionLine,
  householdContextAudienceWarning,
  householdContextReconcileHeading,
  householdContextRelativeTime,
} from "./household-context";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const HOUSEHOLD_ID = "house-1";

const IDENTITIES: HouseholdContextActorIdentity[] = [
  { userId: "mara", name: "Mara", isActiveMember: true },
  { userId: "alex", name: "Alex", isActiveMember: true },
  { userId: "sam", name: "Sam", isActiveMember: false },
];

function householdFact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  const at = overrides.updatedAt ?? NOW;
  return {
    id: "fact-1",
    subject: { kind: "household", householdId: HOUSEHOLD_ID },
    category: "location",
    content: "We're in the Lents neighbourhood.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "account", origin: "direct" },
    reviewedAt: at,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    trust: "untrusted_data",
    authority: "none",
    visibility: "household",
    actorAttribution: { creatorUserId: "mara", lastActorUserId: "mara" },
    ...overrides,
  };
}

describe("householdContextAudienceWarning", () => {
  it("stays quiet for a normal fact so the warning that matters is not worn out", () => {
    expect(householdContextAudienceWarning("normal")).toBeNull();
  });

  it("repeats whole-household visibility for sensitive and restricted facts", () => {
    expect(householdContextAudienceWarning("sensitive")).toContain(
      "Everyone in the household will be able to read this",
    );
    expect(householdContextAudienceWarning("restricted")).toContain(
      "Eve never raises it on its own",
    );
  });
});

describe("householdContextActorLabel", () => {
  it("names the reader as themselves", () => {
    expect(
      householdContextActorLabel({ userId: "mara", viewerUserId: "mara", identities: IDENTITIES }),
    ).toBe("you");
  });

  it("names an active member plainly", () => {
    expect(
      householdContextActorLabel({ userId: "alex", viewerUserId: "mara", identities: IDENTITIES }),
    ).toBe("Alex");
  });

  it("keeps a departed member's name and marks their standing as ended", () => {
    expect(
      householdContextActorLabel({ userId: "sam", viewerUserId: "mara", identities: IDENTITIES }),
    ).toBe("Sam · former member");
  });

  it("never renders a raw user id for an actor nobody can name", () => {
    const label = householdContextActorLabel({
      userId: "ghost-user-id",
      viewerUserId: "mara",
      identities: IDENTITIES,
    });
    expect(label).toBe("someone who's left");
    expect(label).not.toContain("ghost-user-id");
  });
});

describe("householdContextRelativeTime", () => {
  it("reads as elapsed time up to a week and as a date after it", () => {
    expect(householdContextRelativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
    expect(householdContextRelativeTime(new Date(NOW.getTime() - 60_000), NOW)).toBe(
      "a minute ago",
    );
    expect(householdContextRelativeTime(new Date(NOW.getTime() - 7_200_000), NOW)).toBe(
      "2 hours ago",
    );
    expect(householdContextRelativeTime(new Date(NOW.getTime() - 86_400_000), NOW)).toBe(
      "yesterday",
    );
    expect(householdContextRelativeTime(new Date(NOW.getTime() - 3 * 86_400_000), NOW)).toBe(
      "3 days ago",
    );
    expect(householdContextRelativeTime(new Date("2026-01-04T00:00:00.000Z"), NOW)).toBe(
      "Jan 4, 2026",
    );
  });
});

describe("householdContextAttributionLine", () => {
  it("credits the creator while a fact is untouched", () => {
    expect(
      householdContextAttributionLine({
        fact: householdFact(),
        viewerUserId: "alex",
        identities: IDENTITIES,
        now: NOW,
      }),
    ).toBe("Added by Mara · just now");
  });

  it("credits the last actor once someone has corrected it", () => {
    expect(
      householdContextAttributionLine({
        fact: householdFact({
          createdAt: new Date(NOW.getTime() - 86_400_000),
          updatedAt: new Date(NOW.getTime() - 7_200_000),
          actorAttribution: { creatorUserId: "mara", lastActorUserId: "alex" },
        }),
        viewerUserId: "mara",
        identities: IDENTITIES,
        now: NOW,
      }),
    ).toBe("Updated by Alex · 2 hours ago");
  });

  it("has nothing to say about a fact with no household attribution", () => {
    expect(
      householdContextAttributionLine({
        fact: householdFact({ actorAttribution: null }),
        viewerUserId: "mara",
        identities: IDENTITIES,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("buildHouseholdContextReconciliation", () => {
  const draft = {
    category: "location" as const,
    content: "We moved to Sellwood.",
    sensitivity: "normal" as const,
  };
  const current = {
    contextFactId: "fact-1",
    category: "location" as const,
    content: "We're in the Lents neighbourhood.",
    sensitivity: "normal" as const,
    lifecycle: "active" as const,
    updatedAt: NOW,
    lastActorUserId: "alex",
  };

  it("preserves the member's draft and offers all three ways on", () => {
    const reconciliation = buildHouseholdContextReconciliation({ draft, current });
    expect(reconciliation.draft).toEqual(draft);
    expect(reconciliation.current.content).toBe(current.content);
    expect(reconciliation.choices).toEqual(["keep_current", "revise", "replace"]);
    expect(reconciliation.draftDiffers).toBe(true);
  });

  it("withholds replace when the current statement has been archived instead", () => {
    const reconciliation = buildHouseholdContextReconciliation({
      draft,
      current: { ...current, lifecycle: "archived" },
    });
    expect(reconciliation.choices).toEqual(["keep_current", "revise"]);
  });

  it("reports a draft that only re-states the current wording", () => {
    expect(
      buildHouseholdContextReconciliation({
        draft: { ...draft, content: `  ${current.content}  ` },
        current,
      }).draftDiffers,
    ).toBe(false);
  });

  it("names the actor in the heading rather than 'another member'", () => {
    const reconciliation = buildHouseholdContextReconciliation({ draft, current });
    expect(
      householdContextReconcileHeading({
        reconciliation,
        viewerUserId: "mara",
        identities: IDENTITIES,
      }),
    ).toBe("Alex changed this while you were writing");
    expect(
      householdContextReconcileHeading({
        reconciliation: buildHouseholdContextReconciliation({
          draft,
          current: { ...current, lifecycle: "archived" },
        }),
        viewerUserId: "mara",
        identities: IDENTITIES,
      }),
    ).toBe("Alex archived this while you were writing");
  });
});

describe("buildHouseholdContextBoard", () => {
  const facts: ContextFactView[] = [
    householdFact({ id: "a", category: "other", content: "Bins go out Tuesday." }),
    householdFact({ id: "b", category: "composition", content: "Two adults, one cat." }),
    householdFact({ id: "c", category: "location" }),
    householdFact({
      id: "d",
      category: "preference",
      content: "No calls after nine.",
      sensitivity: "restricted",
    }),
    householdFact({
      id: "e",
      category: "constraint",
      content: "One car between us.",
      lifecycle: "archived",
      archivedAt: NOW,
    }),
    {
      ...householdFact({ id: "f" }),
      subject: { kind: "self" },
    },
  ];

  it("groups active facts in the household reading order and drops empty categories", () => {
    const board = buildHouseholdContextBoard({ facts });
    expect(board.groups.map((group) => group.category)).toEqual([
      "composition",
      "location",
      "preference",
      "other",
    ]);
    expect(board.activeCount).toBe(4);
  });

  it("keeps restricted facts on the direct management surface", () => {
    const board = buildHouseholdContextBoard({ facts });
    expect(board.groups.flatMap((group) => group.facts).map((fact) => fact.id)).toContain("d");
  });

  it("holds archived facts apart and never counts them as current", () => {
    const board = buildHouseholdContextBoard({ facts });
    expect(board.archived.map((fact) => fact.id)).toEqual(["e"]);
    expect(board.groups.flatMap((group) => group.facts).map((fact) => fact.id)).not.toContain("e");
  });

  it("ignores another subject's facts entirely", () => {
    const board = buildHouseholdContextBoard({ facts });
    expect(board.groups.flatMap((group) => group.facts).map((fact) => fact.id)).not.toContain("f");
  });

  it("summarises a bounded subset in category order rather than by recency", () => {
    const board = buildHouseholdContextBoard({ facts, summaryLimit: 2 });
    expect(board.summary.map((fact) => fact.id)).toEqual(["b", "c"]);
  });
});
