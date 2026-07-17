import type {
  ContactImportApplyResult,
  ContactImportPreviewCandidate,
} from "@tendnote/db/queries/contacts-import-preview";
import { describe, expect, it } from "vitest";
import {
  bulkConfirmPlan,
  canConfirm,
  isStale,
  matchesQuery,
  NOTHING_IMPORTED_NOTE,
  nextStaleIds,
  orderIndexOf,
  plural,
  primaryContact,
  reconcileApply,
  reviewStateOrder,
  singleConfirmPlan,
  sortByOrder,
  withoutRows,
  withReinserted,
} from "./review-model";

type Candidate = ContactImportPreviewCandidate;

function candidate(overrides: Partial<Candidate> & { id: string }): Candidate {
  return {
    displayName: `Person ${overrides.id}`,
    providerContactId: `people/${overrides.id}`,
    emails: [],
    phones: [],
    birthday: null,
    priority: "useful_email",
    score: 10,
    reasons: [],
    reviewState: "individual_review",
    safeBulkEligible: false,
    decisions: {
      targets: [],
      targetChoiceRequired: false,
      canCreatePerson: true,
      birthdayChoiceRequired: false,
      resolvable: true,
    },
    fingerprint: `fp-${overrides.id}`,
    matchSignals: [],
    advisoryMatches: [],
    conflicts: [],
    matchedPerson: null,
    ...overrides,
  } as Candidate;
}

function applyResult(overrides: Partial<ContactImportApplyResult> = {}): ContactImportApplyResult {
  return {
    importedCount: 0,
    createdPeople: 0,
    updatedPeople: 0,
    addedContactMethods: 0,
    addedBirthdays: 0,
    candidates: [],
    notImported: [],
    undoAvailable: false,
    ...overrides,
  };
}

/** An entry in `result.candidates`: a candidate the workflow actually imported. */
function imported(
  candidateId: string,
  createdPerson = false,
): ContactImportApplyResult["candidates"][number] {
  return {
    candidateId,
    providerContactId: `people/${candidateId}`,
    personId: `person-${candidateId}`,
    displayName: `Person ${candidateId}`,
    createdPerson,
    addedEmails: [],
    addedPhones: [],
    addedBirthday: null,
    skipped: [],
  };
}

describe("the session working set", () => {
  const seed = [candidate({ id: "a" }), candidate({ id: "b" }), candidate({ id: "c" })];
  const order = orderIndexOf(seed);

  it("returns re-added rows to their original position rather than the end", () => {
    const remaining = withoutRows(seed, ["b"]);
    expect(remaining.map((row) => row.id)).toEqual(["a", "c"]);

    const restored = withReinserted(remaining, [seed[1] as Candidate], order);
    expect(restored.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves the set untouched when every row is already present", () => {
    // Identity matters: a no-op reinsert must not churn React state.
    expect(withReinserted(seed, [seed[0] as Candidate], order)).toBe(seed);
  });

  it("orders unknown rows first rather than dropping them", () => {
    const stranger = candidate({ id: "z" });
    expect(sortByOrder([seed[2] as Candidate, stranger], order).map((row) => row.id)).toEqual([
      "z",
      "c",
    ]);
  });
});

describe("canConfirm", () => {
  it("refuses while a confirm is in flight or when nothing is selected", () => {
    expect(canConfirm(false, [candidate({ id: "a" })])).toBe(true);
    expect(canConfirm(true, [candidate({ id: "a" })])).toBe(false);
    expect(canConfirm(false, [])).toBe(false);
  });
});

describe("reconcileApply", () => {
  const confirmed = [candidate({ id: "a" }), candidate({ id: "b" }), candidate({ id: "c" })];

  it("splits the confirmed rows by what the workflow actually did", () => {
    const reconciliation = reconcileApply(
      confirmed,
      applyResult({
        importedCount: 1,
        candidates: [imported("a", true)],
        notImported: [
          { candidateId: "b", reason: "stale" },
          { candidateId: "c", reason: "ineligible" },
        ],
      }),
    );

    expect(reconciliation.importedRowIds).toEqual(["a"]);
    expect(reconciliation.staleRowIds).toEqual(["b"]);
    // Every refused row comes back, whatever the reason.
    expect(reconciliation.notImported.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("reports nothing to undo when the whole batch landed", () => {
    const reconciliation = reconcileApply(
      confirmed,
      applyResult({
        importedCount: 3,
        candidates: confirmed.map((row) => imported(row.id)),
      }),
    );

    expect(reconciliation.notImported).toEqual([]);
    expect(reconciliation.staleRowIds).toEqual([]);
  });
});

describe("nextStaleIds", () => {
  it("marks drifted rows and clears the marker from rows that later landed", () => {
    const next = nextStaleIds(new Set(["old", "fixed"]), {
      notImported: [],
      staleRowIds: ["fresh"],
      importedRowIds: ["fixed"],
    });

    expect([...next].sort()).toEqual(["fresh", "old"]);
  });
});

describe("singleConfirmPlan", () => {
  const person = candidate({ id: "a", displayName: "Mara Chen" });

  it("distinguishes an added person from an updated one", () => {
    expect(
      singleConfirmPlan(
        person,
        applyResult({
          importedCount: 1,
          candidates: [imported("a", true)],
        }),
        [],
      ),
    ).toEqual({ tone: "success", message: "Added Mara Chen" });

    expect(
      singleConfirmPlan(
        person,
        applyResult({
          importedCount: 1,
          candidates: [imported("a")],
        }),
        [],
      ),
    ).toEqual({ tone: "success", message: "Updated Mara Chen" });
  });

  it("says nothing for a drifted row, because drift speaks for itself", () => {
    // Stale gets one canonical toast plus a persistent row marker; a second
    // per-row error would double-report the same fact.
    expect(
      singleConfirmPlan(
        person,
        applyResult({ notImported: [{ candidateId: "a", reason: "stale" }] }),
        [person],
      ),
    ).toBeNull();
  });

  it("reports a non-stale refusal against the person by name", () => {
    expect(
      singleConfirmPlan(
        person,
        applyResult({ notImported: [{ candidateId: "a", reason: "ineligible" }] }),
        [person],
      ),
    ).toEqual({ tone: "error", message: "Couldn't import Mara Chen." });
  });

  it("reports a refusal even when the workflow refused silently", () => {
    // Accepted the call, imported nothing, listed nothing: still not a success.
    expect(singleConfirmPlan(person, applyResult(), [])).toEqual({
      tone: "error",
      message: "Couldn't import Mara Chen.",
    });
  });
});

describe("bulkConfirmPlan", () => {
  it("summarizes only what actually landed", () => {
    expect(
      bulkConfirmPlan(
        applyResult({
          importedCount: 3,
          createdPeople: 2,
          updatedPeople: 1,
          addedContactMethods: 4,
        }),
      ),
    ).toEqual({
      tone: "success",
      message: "Confirmed 3 contacts",
      description: "2 added · 1 updated · 4 contact methods",
    });
  });

  it("omits detail parts that contributed nothing", () => {
    expect(bulkConfirmPlan(applyResult({ importedCount: 1, createdPeople: 1 }))).toEqual({
      tone: "success",
      message: "Confirmed 1 contact",
      description: "1 added",
    });
  });

  it("carries no description when nothing is worth detailing", () => {
    const plan = bulkConfirmPlan(applyResult({ importedCount: 1 }));
    expect(plan).toEqual({ tone: "success", message: "Confirmed 1 contact" });
    expect(plan).not.toHaveProperty("description");
  });

  it("stays quiet when an empty result is entirely drift", () => {
    // runConfirm already raised the one stale toast; this path must not add a
    // contradicting "no contacts were imported".
    expect(
      bulkConfirmPlan(applyResult({ notImported: [{ candidateId: "a", reason: "stale" }] })),
    ).toBeNull();
  });

  it("reports an empty result that was not drift", () => {
    expect(bulkConfirmPlan(applyResult())).toEqual({
      tone: "info",
      message: NOTHING_IMPORTED_NOTE,
    });
  });
});

describe("isStale", () => {
  it("is scoped to the candidate asked about", () => {
    const result = applyResult({
      notImported: [{ candidateId: "a", reason: "stale" }],
    });

    expect(isStale(result, "a")).toBe(true);
    expect(isStale(result, "b")).toBe(false);
  });
});

describe("reviewStateOrder", () => {
  it("surfaces the rows needing work ahead of the safe ones", () => {
    const states: Candidate["reviewState"][] = [
      "safe_recommendation",
      "weak_match",
      "conflict",
      "advisory_match",
    ];

    expect([...states].sort((a, b) => reviewStateOrder(a) - reviewStateOrder(b))).toEqual([
      "conflict",
      "advisory_match",
      "weak_match",
      "safe_recommendation",
    ]);
  });
});

describe("matchesQuery", () => {
  const row = candidate({
    id: "a",
    displayName: "Mara Chen",
    emails: ["mchen@example.com"],
    phones: ["+1 555 0100"],
    matchedPerson: { id: "person-mara", displayName: "Mara C" },
  });

  it("matches name, matched person, email, and phone, case-insensitively", () => {
    expect(matchesQuery(row, "mara")).toBe(true);
    expect(matchesQuery(row, "MARA C")).toBe(true);
    expect(matchesQuery(row, "example.com")).toBe(true);
    expect(matchesQuery(row, "555")).toBe(true);
    expect(matchesQuery(row, "nobody")).toBe(false);
  });

  it("keeps every row for a blank or whitespace-only query", () => {
    expect(matchesQuery(row, "")).toBe(true);
    expect(matchesQuery(row, "   ")).toBe(true);
  });
});

describe("primaryContact", () => {
  it("prefers email, falls back to phone, then says so plainly", () => {
    expect(primaryContact(candidate({ id: "a", emails: ["a@b.c"], phones: ["555"] }))).toBe(
      "a@b.c",
    );
    expect(primaryContact(candidate({ id: "a", phones: ["555"] }))).toBe("555");
    expect(primaryContact(candidate({ id: "a" }))).toBe("No email or phone");
  });
});

describe("plural", () => {
  it("uses the singular only for exactly one", () => {
    expect(plural(1, "contact", "contacts")).toBe("contact");
    expect(plural(0, "contact", "contacts")).toBe("contacts");
    expect(plural(2, "contact", "contacts")).toBe("contacts");
  });
});
