import { describe, expect, it, vi } from "vitest";
import { webSearchPause } from "../agent/lib/web-search-pause";

const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } } as const;

/** What the model gets back if it calls the bound `web_search` anyway. */
async function runWithheld(tools: Awaited<ReturnType<typeof webSearchPause>>) {
  const tool = tools?.web_search as { execute: (...args: unknown[]) => unknown } | undefined;
  return tool?.execute({}, {});
}

describe("webSearchPause", () => {
  it("leaves web search alone below the ceiling", async () => {
    await expect(webSearchPause("owner-1", async () => ({ state: "normal" }))).resolves.toBeNull();
  });

  it("withholds web search at the ceiling until the Usage Period resets", async () => {
    const read = vi.fn(async () => paused);

    const tools = await webSearchPause("owner-1", read);

    expect(read).toHaveBeenCalledWith("owner-1");
    expect(Object.keys(tools ?? {})).toEqual(["web_search"]);
    await expect(runWithheld(tools)).resolves.toEqual({
      performed: false,
      tool: "web_search",
      message: expect.stringContaining("Resets on November 15."),
    });
  });

  it("withholds web search when the usage read fails, rather than search past the ceiling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tools = await webSearchPause("owner-1", async () => {
      throw new Error("database unavailable");
    });

    await expect(runWithheld(tools)).resolves.toMatchObject({ performed: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads nothing for a session with no principal, which the mode gate already restricts", async () => {
    const read = vi.fn(async () => paused);

    await expect(webSearchPause(null, read)).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
