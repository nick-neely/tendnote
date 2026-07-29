// @vitest-environment jsdom
import type { GlobalRecallResponse } from "@tendnote/domain/global-recall";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";
import { useGlobalRecall } from "./use-global-recall";

/**
 * The recall seam both search surfaces sit on. These assertions belong here rather
 * than duplicated in the phone flow's and the palette's suites: the debounce, the
 * two-character floor, the `matchKinds` shape, and the restricted-match gate are
 * one contract, and a surface that drifted from it would still pass its own tests.
 */

function emptyResponse(query: string): GlobalRecallResponse {
  return { query, results: [], limitations: [], hasMore: false };
}

const success = <T,>(view: T) => ({ ok: true as const, view });

/** Minimal surface over the hook: a query box plus a readout of what it returned. */
function RecallHarness({ search }: { search: Parameters<typeof useGlobalRecall>[0]["search"] }) {
  const [query, setQuery] = useState("");
  const recall = useGlobalRecall({ query, search });
  return (
    <div>
      <input aria-label="Query" onChange={(event) => setQuery(event.target.value)} value={query} />
      <button onClick={() => recall.setFamily("people")} type="button">
        Family people
      </button>
      <button onClick={() => recall.setFamily("all")} type="button">
        Family all
      </button>
      <button onClick={() => recall.setIncludeRestricted(true)} type="button">
        Reveal restricted
      </button>
      <button onClick={() => recall.setIncludeRestricted(false)} type="button">
        Hide restricted
      </button>
      <button onClick={() => recall.setMatchKind("exact")} type="button">
        Exact only
      </button>
      <button
        onClick={() => recall.restoreFilters({ family: "assets", includeRestricted: true })}
        type="button"
      >
        Restore assets
      </button>
      <button onClick={() => recall.restoreFilters({ includeRestricted: true })} type="button">
        Restore restricted without family
      </button>
      <p data-testid="state">
        {[
          `family:${recall.filters.family}`,
          `match:${recall.filters.matchKind}`,
          `restricted:${recall.filters.includeRestricted}`,
          `locked:${recall.restrictedLocked}`,
          `searchable:${recall.searchable}`,
          `loading:${recall.loading}`,
          `failed:${recall.failed}`,
          `exact:${recall.exact.length}`,
          `related:${recall.related.length}`,
        ].join(" ")}
      </p>
    </div>
  );
}

function state() {
  return screen.getByTestId("state").textContent ?? "";
}

describe("useGlobalRecall", () => {
  it("leaves the server alone until the query is worth asking about", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(success(emptyResponse("ma")));
    render(<RecallHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Query" }), "m");
    await waitFor(() => expect(state()).toContain("loading:false"));
    expect(search).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "Query" }), "a");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenLastCalledWith({
      query: "ma",
      family: "all",
      includeArchived: false,
      includeRestricted: false,
    });
  });

  it("omits matchKinds for 'all' and sends exactly one kind otherwise", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(success(emptyResponse("maya")));
    render(<RecallHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Query" }), "maya");
    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(search.mock.calls[0]?.[0]).not.toHaveProperty("matchKinds");

    await user.click(screen.getByRole("button", { name: "Exact only" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ matchKinds: ["exact"] as const }),
      ),
    );
  });

  it("gates restricted matches on a named family and re-locks them when widened", async () => {
    const user = userEvent.setup();
    render(<RecallHarness search={vi.fn()} />);

    expect(state()).toContain("locked:true");

    await user.click(screen.getByRole("button", { name: "Family people" }));
    expect(state()).toContain("locked:false");
    await user.click(screen.getByRole("button", { name: "Reveal restricted" }));
    expect(state()).toContain("restricted:true");

    // Widening back to every record puts restricted matches out of reach, so the
    // flag cannot survive - the schema would reject that pair outright.
    await user.click(screen.getByRole("button", { name: "Family all" }));
    expect(state()).toContain("restricted:false");
    expect(state()).toContain("locked:true");
  });

  it("re-applies saved filters under the same gate", async () => {
    const user = userEvent.setup();
    render(<RecallHarness search={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Restore assets" }));
    expect(state()).toContain("family:assets");
    expect(state()).toContain("restricted:true");

    await user.click(screen.getByRole("button", { name: "Family all" }));
    await user.click(screen.getByRole("button", { name: "Restore restricted without family" }));
    expect(state()).toContain("restricted:false");
  });

  it("splits the answer into exact and related matches", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(
      success({
        query: "filter",
        results: [
          recallResult({ id: "one", matchKind: "exact" }),
          recallResult({ id: "two", matchKind: "related" }),
          recallResult({ id: "three", matchKind: "related" }),
        ],
        limitations: [],
        hasMore: false,
      }),
    );
    render(<RecallHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Query" }), "filter");
    await waitFor(() => expect(state()).toContain("exact:1"));
    expect(state()).toContain("related:2");
  });

  /**
   * The floor is the seam's own predicate, not an approximation of it. Two
   * characters of punctuation, or two initials with a space between them, clear a
   * length check and are still rejected by the input schema - so gating on length
   * meant sending a query we knew would fail and then telling the owner their
   * search had failed.
   */
  it("holds a query the seam would reject rather than sending it", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(success(emptyResponse("ok")));
    render(<RecallHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Query" }), "!!");
    await waitFor(() => expect(state()).toContain("searchable:false"));
    expect(search).not.toHaveBeenCalled();
    expect(state()).toContain("failed:false");

    await user.clear(screen.getByRole("textbox", { name: "Query" }));
    await user.type(screen.getByRole("textbox", { name: "Query" }), "A B");
    await waitFor(() => expect(state()).toContain("searchable:false"));
    expect(search).not.toHaveBeenCalled();

    await user.clear(screen.getByRole("textbox", { name: "Query" }));
    await user.type(screen.getByRole("textbox", { name: "Query" }), "ok");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(state()).toContain("searchable:true");
  });

  /**
   * Un-gating restricted matches narrows a privacy boundary, and the replacement
   * search is a debounce plus a round trip away. The server is still the gate,
   * but the rows already on screen are the ones the owner has just asked to stop
   * seeing, so they go immediately rather than staying selectable until the next
   * answer lands.
   */
  it("drops restricted matches the moment the owner un-reveals them", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue(
      success({
        query: "filter",
        results: [
          recallResult({ id: "open", matchKind: "exact" }),
          recallResult({ id: "held", matchKind: "exact", sensitivity: "restricted" }),
        ],
        limitations: [],
        hasMore: false,
      }),
    );
    render(<RecallHarness search={search} />);

    await user.click(screen.getByRole("button", { name: "Family people" }));
    await user.click(screen.getByRole("button", { name: "Reveal restricted" }));
    await user.type(screen.getByRole("textbox", { name: "Query" }), "filter");
    await waitFor(() => expect(state()).toContain("exact:2"));

    await user.click(screen.getByRole("button", { name: "Hide restricted" }));
    expect(state()).toContain("exact:1");
  });

  it("reports a failed search instead of showing a stale answer", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockRejectedValue(new Error("offline"));
    render(<RecallHarness search={search} />);

    await user.type(screen.getByRole("textbox", { name: "Query" }), "filter");
    await waitFor(() => expect(state()).toContain("failed:true"));
    expect(state()).toContain("exact:0");
  });
});

function recallResult({
  id,
  matchKind,
  sensitivity = "normal",
}: {
  id: string;
  matchKind: "exact" | "related";
  sensitivity?: "normal" | "restricted";
}) {
  return {
    family: "saved_item" as const,
    canonical: { kind: "saved_item" as const, id },
    label: `Saved ${id}`,
    supportingText: "Replacement notes",
    lifecycle: "active",
    match: { kind: matchKind, reason: "Matched wording", excerpt: "filter" },
    trust: "saved_context" as const,
    sensitivity,
    visibility: { choice: "only_me" as const, label: "Only me" },
    grounding: [{ kind: "saved_item" as const, id }],
    href: `/saved-items#saved-item-${id}`,
    parent: null,
    details: { kind: "note" as const },
  };
}
