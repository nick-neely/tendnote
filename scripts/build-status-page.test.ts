import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStatusPage, parseNoticeSource, renderStatusPage } from "./build-status-page.mjs";

const repoRoot = join(import.meta.dirname, "..");

describe("status page", () => {
  it("keeps the committed notice source publishable", () => {
    const source = JSON.parse(readFileSync(join(repoRoot, "status/notice.json"), "utf8"));

    expect(() => parseNoticeSource(source)).not.toThrow();
  });

  it("says there is nothing to report when no notice is posted", () => {
    expect(renderStatusPage(null)).toContain("No current notices");
  });

  it("renders a posted notice as escaped text with its update time", () => {
    const html = renderStatusPage(
      parseNoticeSource({
        notice: { message: "Reminders <b>late</b> & retrying", updatedAt: "2026-10-01T15:00:00Z" },
      }),
    );

    expect(html).toContain("Reminders &lt;b&gt;late&lt;/b&gt; &amp; retrying");
    expect(html).toContain('datetime="2026-10-01T15:00:00.000Z"');
    expect(html).toContain("2026-10-01 15:00:00 UTC");
  });

  it.each([
    [{}, /"notice" key/],
    [{ notice: "down" }, /null or an object/],
    [{ notice: { message: " ", updatedAt: "2026-10-01T15:00:00Z" } }, /non-empty/],
    [{ notice: { message: "x".repeat(501), updatedAt: "2026-10-01T15:00:00Z" } }, /at most 500/],
    [{ notice: { message: "Down", updatedAt: "yesterday" } }, /ISO 8601/],
  ])("refuses a malformed source %j", (source, error) => {
    expect(() => parseNoticeSource(source)).toThrow(error);
  });

  it("publishes the page and the notice the in-app banner reads", () => {
    const outDir = mkdtempSync(join(tmpdir(), "status-page-"));
    try {
      buildStatusPage(outDir, {
        notice: { message: "Sign-in is slow.", updatedAt: "2026-10-01T15:00:00Z" },
      });

      expect(readFileSync(join(outDir, "index.html"), "utf8")).toContain("Sign-in is slow.");
      expect(JSON.parse(readFileSync(join(outDir, "notice.json"), "utf8"))).toEqual({
        notice: { message: "Sign-in is slow.", updatedAt: "2026-10-01T15:00:00.000Z" },
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
