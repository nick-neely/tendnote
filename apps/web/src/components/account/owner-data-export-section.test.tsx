// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/dom";
import { OwnerDataExportSection } from "./owner-data-export-section";

const requestOwnerDataExportAction = vi.hoisted(() => vi.fn());

vi.mock("@/app/actions/owner-data-export", () => ({ requestOwnerDataExportAction }));

const baseJob = {
  id: "job-1",
  ownerUserId: "owner-1",
  status: "pending" as const,
  attempts: 0,
  lastError: null,
  idempotencyKey: "request-1",
  runAfter: new Date("2026-08-19T12:00:00.000Z"),
  claimedAt: null,
  claimToken: null,
  completedAt: null,
  artifactExpiresAt: null,
  createdAt: new Date("2026-08-19T12:00:00.000Z"),
  updatedAt: new Date("2026-08-19T12:00:00.000Z"),
};

describe("Account data export interaction", () => {
  afterEach(() => {
    requestOwnerDataExportAction.mockReset();
  });

  it("keeps queued work truthful and exposes a download only after completion", async () => {
    const user = userEvent.setup();
    requestOwnerDataExportAction.mockResolvedValue({
      ok: true,
      view: { ...baseJob, status: "completed", artifactExpiresAt: new Date("2026-08-20") },
    });
    render(<OwnerDataExportSection initialJob={null} />);

    expect(screen.getByText("Not requested")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Request export" }));
    expect(await screen.findByText("Ready to download")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download ZIP" }).getAttribute("href")).toBe(
      "/api/account/data-export/job-1",
    );
  });

  it("renders a queued job as waiting rather than complete", () => {
    render(<OwnerDataExportSection initialJob={baseJob} />);
    expect(screen.getByText("Waiting to start")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download ZIP" })).toBeNull();
  });

  it.each([
    ["running", "Preparing your export"],
    ["failed", "Couldn't prepare the export yet"],
    ["expired", "Expired — request a new export"],
  ] as const)("shows the truthful %s state", (status, label) => {
    render(<OwnerDataExportSection initialJob={{ ...baseJob, status }} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download ZIP" })).toBeNull();
  });
});
