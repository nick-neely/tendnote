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

  it("requests an inactive pane only after the owner activates its tab", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/people/person-1");
    replace.mockReset();

    render(
      <PersonDetailTabs
        aside={null}
        draftsCount={0}
        draftsPanel={null}
        followupCount={0}
        followupsPanel={null}
        hasSnapshot
        header={null}
        initialTab="memory"
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
