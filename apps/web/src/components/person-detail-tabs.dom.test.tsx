// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test/dom";
import { PersonDetailTabs } from "./person-detail-tabs";

describe("PersonDetailTabs deep links", () => {
  it("selects Memory and scrolls to one canonical Memory record", async () => {
    window.history.replaceState({}, "", "/people/person-1#memory-memory-1");
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <PersonDetailTabs
        aside={null}
        draftsCount={0}
        draftsPanel={<p>Drafts</p>}
        followupCount={0}
        followupsPanel={<p>Follow-Ups</p>}
        hasSnapshot
        header={<h1>Priya</h1>}
        initialTab="snapshot"
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
    window.history.replaceState({}, "", "/");
  });
});
