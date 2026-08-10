// @vitest-environment jsdom
import type { Memory } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";

// The ledger's sharing control defaults to the real server action, so the
// server-only module is stood in for before the section is imported.
vi.mock("@/app/actions/relationship-shares", () => ({
  setRelationshipShareAudienceAction: vi.fn(),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { MemoriesSection } = await import("@/components/person-ledger-records");

const AT = new Date("2026-07-24T12:00:00.000Z");

function memory(overrides: Partial<Memory> & Pick<Memory, "id" | "content">): Memory {
  return {
    personId: "person-1",
    ownerUserId: "owner-1",
    sourceRecordId: "source-1",
    memoryType: "context",
    status: "approved",
    importance: 3,
    sensitivity: "normal",
    confidence: "medium",
    scope: "private",
    householdId: null,
    approvedAt: AT,
    dismissedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as Memory;
}

const CONFIRMED = memory({ id: "memory-1", content: "Moving to Denver in August" });
const RESTRICTED = [
  memory({ id: "memory-2", content: "Between jobs right now", sensitivity: "restricted" }),
  memory({ id: "memory-3", content: "Seeing a counselor on Thursdays", sensitivity: "restricted" }),
];

function renderSection() {
  return render(<MemoriesSection memories={[CONFIRMED]} restrictedMemories={RESTRICTED} />);
}

describe("MemoriesSection restricted reveal", () => {
  it("names and counts the held-back memories without showing any of them", () => {
    renderSection();

    expect(screen.getByRole("button", { name: "Restricted (2)" })).toBeTruthy();
    expect(
      screen.getByText("Kept out of suggestions and drafts unless you ask for them."),
    ).toBeTruthy();
    // Closed on arrival: the count is the only thing a shoulder can read.
    expect(screen.queryByText("Between jobs right now")).toBeNull();
    expect(screen.queryByText("Seeing a counselor on Thursdays")).toBeNull();
    // The confirmed list is untouched by the reveal above or below it.
    expect(screen.getByText("Moving to Denver in August")).toBeTruthy();
  });

  it("reveals the rows with a Restricted marker on each", async () => {
    renderSection();

    await userEvent.click(screen.getByRole("button", { name: "Restricted (2)" }));

    expect(screen.getByText("Between jobs right now")).toBeTruthy();
    expect(screen.getByText("Seeing a counselor on Thursdays")).toBeTruthy();
    // The marker is a word, not a color, and it rides every revealed row.
    expect(screen.getAllByText("Restricted")).toHaveLength(2);
    // Revealed rows keep the ledger's record anchor, so a deep link into one
    // still lands on it once it is open.
    expect(document.getElementById("memory-memory-2")).toBeTruthy();
  });

  it("starts closed again on the next visit", async () => {
    const first = renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Restricted (2)" }));
    expect(screen.getByText("Between jobs right now")).toBeTruthy();

    // Nothing about a reveal is persisted - not in the URL, not in storage - so
    // re-rendering the page is the same as arriving at it fresh.
    first.unmount();
    renderSection();

    expect(screen.queryByText("Between jobs right now")).toBeNull();
    expect(screen.getByRole("button", { name: "Restricted (2)" })).toBeTruthy();
  });

  it("offers no reveal when nothing is held back", () => {
    render(<MemoriesSection memories={[CONFIRMED]} />);

    expect(screen.queryByRole("button", { name: /Restricted/ })).toBeNull();
    expect(screen.getByText("Moving to Denver in August")).toBeTruthy();
  });

  it("still offers the reveal when the confirmed ledger is empty", () => {
    render(<MemoriesSection memories={[]} restrictedMemories={RESTRICTED} />);

    expect(screen.getByText(/No confirmed memories yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restricted (2)" })).toBeTruthy();
  });
});

describe("MemoriesSection sharing", () => {
  const SHARING = {
    members: [{ userId: "member-2", name: "Jon", email: "jon@example.com" }],
    audiences: { "memory-1": ["member-2"] },
    householdName: "Rivera House",
  };

  it("leaves a solo ledger exactly as it was", () => {
    render(<MemoriesSection memories={[CONFIRMED]} />);
    expect(screen.queryByRole("button", { name: "Visibility" })).toBeNull();
  });

  it("offers the control on a confirmed memory once there is a household", () => {
    render(<MemoriesSection memories={[CONFIRMED]} sharing={SHARING} />);

    expect(screen.getByRole("button", { name: "Visibility" })).toBeTruthy();
    // Private is the default and stays unannounced: a ledger does not need to
    // say "not shared" once per row.
    expect(screen.queryByText(/Shared with/)).toBeNull();
  });

  it("states the audience on a memory that is actually shared", () => {
    const shared = memory({
      id: "memory-1",
      content: "Moving to Denver in August",
      scope: "shared",
      householdId: "household-1",
    });
    render(<MemoriesSection memories={[shared]} sharing={SHARING} />);

    expect(screen.getByText("Shared with 1 person")).toBeTruthy();
  });

  /**
   * Sensitivity and visibility are independent. A restricted memory the owner
   * chose to share is still theirs to re-address, so the control follows it
   * behind the reveal rather than disappearing there.
   */
  it("keeps the control on revealed restricted rows", async () => {
    render(
      <MemoriesSection memories={[CONFIRMED]} restrictedMemories={RESTRICTED} sharing={SHARING} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Restricted (2)" }));

    expect(screen.getAllByRole("button", { name: "Visibility" })).toHaveLength(3);
  });
});
