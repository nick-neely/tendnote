// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/people/person-1",
  useRouter: () => ({ replace }),
}));

import { PersonDetailTabs } from "./person-detail-tabs";

describe("PersonDetailTabs deep links", () => {
  it("selects Memory and scrolls to one canonical Memory record", async () => {
    window.history.replaceState({}, "", "/people/person-1#memory-memory-1");
    replace.mockReset();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <PersonDetailTabs
        aside={null}
        capture={null}
        draftsCount={0}
        draftsPanel={<p>Drafts</p>}
        followupCount={0}
        followupsPanel={<p>Follow-Ups</p>}
        hasSnapshot
        header={<h1>Priya</h1>}
        initialTab="snapshot"
        memoryCount={0}
        memoryPanel={<article id="memory-memory-1">Matched memory</article>}
        reviewCount={0}
        reviewPanel={<p>Review</p>}
        snapshotPanel={<p>Snapshot</p>}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Memory" }).getAttribute("data-state")).toBe("active"),
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    // Only the selected pane is server-rendered, so a deep link into another one
    // has to ask the server for it - keeping the record hash so the link survives.
    expect(replace).toHaveBeenCalledWith("/people/person-1?tab=memory#memory-memory-1", {
      scroll: false,
    });
    window.history.replaceState({}, "", "/");
  });

  it("requests an inactive pane only after the owner activates its tab", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/person-1");
    replace.mockReset();

    render(
      <PersonDetailTabs
        aside={null}
        capture={null}
        draftsCount={0}
        draftsPanel={null}
        followupCount={0}
        followupsPanel={null}
        hasSnapshot
        header={null}
        initialTab="memory"
        memoryCount={0}
        memoryPanel={<p>Memory</p>}
        reviewCount={0}
        reviewPanel={null}
        snapshotPanel={null}
      />,
    );

    expect(replace).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Drafts" }));
    expect(replace).toHaveBeenCalledWith("/people/person-1?tab=drafts", { scroll: false });
  });
});

describe("PersonDetailTabs register", () => {
  it("carries every count on the tabs while the landing pane is open", () => {
    window.history.replaceState({}, "", "/people/person-1");

    render(
      <PersonDetailTabs
        aside={<p>Details</p>}
        capture={<p>Add a note</p>}
        draftsCount={4}
        draftsPanel={null}
        followupCount={2}
        followupsPanel={null}
        hasSnapshot
        header={null}
        initialTab="snapshot"
        memoryCount={1}
        memoryPanel={null}
        reviewCount={3}
        reviewPanel={null}
        snapshotPanel={<p>Snapshot</p>}
      />,
    );

    // Counts come from the cached person core, not the open pane, so the rail can
    // say where the work is from the landing tab.
    expect(screen.getByRole("tab", { name: "Snapshot" }).getAttribute("data-state")).toBe("active");
    expect(screen.getByRole("tab", { name: "Review, 3" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Memory, 1" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Follow-ups, 2" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Drafts, 4" })).toBeTruthy();
  });

  it("puts capture ahead of the ledger in reading order for mobile", () => {
    window.history.replaceState({}, "", "/people/person-1");

    render(
      <PersonDetailTabs
        aside={<p>Details</p>}
        capture={<p>Add a note</p>}
        draftsCount={0}
        draftsPanel={null}
        followupCount={0}
        followupsPanel={null}
        hasSnapshot
        header={null}
        initialTab="snapshot"
        memoryCount={0}
        memoryPanel={null}
        reviewCount={0}
        reviewPanel={null}
        snapshotPanel={<p>Snapshot pane</p>}
      />,
    );

    const capture = screen.getByText("Add a note");
    const panel = screen.getByText("Snapshot pane");

    // Single-column (mobile) order follows the DOM: capture, then the ledger. The
    // desktop rail placement is grid-only, so it cannot reorder this.
    expect(capture.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
