import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";
import type { GeneralActionView } from "@/lib/general-action-view";
import type { SuggestedGeneralActionReviewView } from "@/lib/suggested-general-action-review-view";

// vitest hoists `vi.mock` factories above imports, so this standard mock boilerplate
// cannot be shared without fragile dynamic-import gymnastics that obscure the idiom.
// fallow-ignore-next-line code-duplication
vi.mock("@/app/actions/suggested-general-actions", () => ({
  acceptSuggestedGeneralActionAction: vi.fn(),
  dismissSuggestedGeneralActionAction: vi.fn(),
  editSuggestedGeneralActionAction: vi.fn(),
  ignoreSuggestedGeneralActionAction: vi.fn(),
  restoreDismissedSuggestedGeneralActionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { SuggestedGeneralActionReviewCard } from "./suggested-general-action-review";

function actionView(overrides: Partial<GeneralActionView> = {}): GeneralActionView {
  return generalActionViewFixture({
    title: "Replace the refrigerator water filter",
    notes: "Model MWF",
    assetHints: [{ label: "fridge water filter" }],
    status: "suggested",
    recurrence: { interval: 6, unit: "month" },
    isRoutine: true,
    recurrenceLabel: "Every 6 months",
    scope: "household",
    visibilityLabel: "Home",
    ownerUserId: "user-1",
    areaId: "area-1",
    dueAtISO: "2026-08-01T00:00:00.000Z",
    dueAtDate: "2026-08-01",
    surfaceState: "upcoming",
    surfaceLabel: "Due Aug 1",
    ...overrides,
  });
}

function view(
  overrides: Partial<SuggestedGeneralActionReviewView> = {},
): SuggestedGeneralActionReviewView {
  return {
    component: {
      type: "suggested_general_action_review",
      generalActionId: "11111111-1111-1111-1111-111111111111",
      sourceRecordId: "22222222-2222-2222-2222-222222222222",
    },
    action: actionView(overrides.action),
    areaName: "Home",
    source: {
      id: "22222222-2222-2222-2222-222222222222",
      content: "Fridge filter is due — replace it every 6 months.",
      sourceType: "manual",
      capturedAt: "2026-06-27T00:00:00.000Z",
    },
    ...overrides,
  };
}

describe("SuggestedGeneralActionReviewCard", () => {
  it("renders a proposal with its editable metadata, grounding, and all four review actions", () => {
    const html = renderToStaticMarkup(
      <SuggestedGeneralActionReviewCard onResolve={() => {}} review={view()} />,
    );

    expect(html).toContain("Suggested action");
    expect(html).toContain("Replace the refrigerator water filter");
    expect(html).toContain("Model MWF");
    // Timing, recurrence, Area, scope, and asset hint all read at a glance.
    expect(html).toContain("Due Aug 1");
    expect(html).toContain("Every 6 months");
    expect(html).toContain("Home");
    expect(html).toContain("fridge water filter");
    // Source grounding makes the proposal trustworthy.
    expect(html).toContain("From manual note");
    expect(html).toContain("Fridge filter is due");
    // Accept, Edit, Dismiss, and Ignore are all present (ADR 0152).
    expect(html).toContain("Accept");
    expect(html).toContain("Edit");
    expect(html).toContain("Dismiss");
    expect(html).toContain("Ignore");
    // The card names its own destination (a Routine here) and discloses what the two
    // set-asides do, so a proposal is never resolved blind.
    expect(html).toContain("Accept adds this routine to your Actions");
    expect(html).toContain("Dismiss keeps it in Resolved");
    expect(html).toContain("Ignore clears it");
    // The review controls are grouped and labeled for assistive tech.
    expect(html).toContain('role="group"');
    // Raw ids are never shown.
    expect(html).not.toContain("11111111-1111-1111-1111-111111111111");
    expect(html).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("shows a linked person as context and omits a scope chip for a private proposal", () => {
    const html = renderToStaticMarkup(
      <SuggestedGeneralActionReviewCard
        onResolve={() => {}}
        review={view({
          action: actionView({
            scope: "private",
            visibilityLabel: "Only me",
            linkedPeople: [{ id: "p1", displayName: "Mara" }],
          }),
          areaName: null,
        })}
      />,
    );

    expect(html).toContain("Mara");
    // Private is the bare default — no audience chip, no "Only me" noise.
    expect(html).not.toContain("Only me");
  });
});
