// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { AssetSnapshotCard } from "@/components/asset-snapshot-card";
import { render, screen } from "@/test/dom";

describe("AssetSnapshotCard", () => {
  it("shows the summary and says out loud that it is generated, not truth", () => {
    render(
      <AssetSnapshotCard
        citationCount={3}
        status="fresh"
        summary="Refrigerator is an appliance you track."
      />,
    );

    expect(screen.getByText(/Refrigerator is an appliance you track/)).toBeTruthy();
    expect(screen.getByText(/the records below are the source of truth/i)).toBeTruthy();
  });

  it("says how many records the summary stands on", () => {
    render(<AssetSnapshotCard citationCount={3} status="rebuilt" summary="A summary." />);

    expect(screen.getByText(/Built from 3 records/)).toBeTruthy();
  });

  it("renders nothing when the snapshot is stale or missing — the records carry on", () => {
    const { container } = render(
      <AssetSnapshotCard citationCount={0} status="fallback" summary="stale prose" />,
    );

    // Degrading gracefully means the card quietly disappears: no stale prose, and no
    // error implying the profile itself is broken.
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/stale prose/)).toBeNull();
  });

  it("renders nothing when there is no summary at all", () => {
    const { container } = render(
      <AssetSnapshotCard citationCount={0} status="rebuilt" summary={null} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
