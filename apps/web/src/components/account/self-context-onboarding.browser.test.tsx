import type { ContextFactView } from "@tendnote/domain";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { SelfContextOnboarding } from "./self-context-onboarding";

const cleanups: Array<() => Promise<void>> = [];
const NOW = new Date("2026-08-02T12:00:00.000Z");
let nextFactId = 1;

function fact(
  category: ContextFactView["category"],
  content: string,
  overrides: Partial<ContextFactView> = {},
): ContextFactView {
  return {
    id: `00000000-0000-4000-8000-${String(nextFactId++).padStart(12, "0")}`,
    subject: { kind: "self" },
    category,
    content,
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "onboarding", origin: "direct" },
    reviewedAt: NOW,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    trust: "untrusted_data",
    authority: "none",
    visibility: "private",
    ...overrides,
  };
}

async function click(control: ReturnType<typeof page.getByRole>) {
  await act(async () => {
    await userEvent.click(control);
  });
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  nextFactId = 1;
});

describe("Self Context onboarding browser contract", () => {
  it("supports full completion across all four optional prompt groups", async () => {
    await page.viewport(390, 844);
    const createAction = vi.fn(async ({ category, content, sensitivity }) => ({
      ok: true as const,
      view: {
        fact: fact(category, content, { sensitivity }),
        decision: "created" as const,
      },
    }));
    const completeAction = vi.fn(async () => ({
      ok: true as const,
      view: { status: "completed" as const, reminderAt: null },
    }));
    const rendered = await renderInBrowser(
      <SelfContextOnboarding
        createAction={createAction}
        completeAction={completeAction}
        initialFacts={[]}
      />,
    );
    cleanups.push(rendered.unmount);

    for (const [index, answer] of [
      "I run a software consultancy.",
      "I am based in Chicago.",
      "I enjoy trail running.",
      "I prefer concise answers.",
    ].entries()) {
      await act(async () => {
        await userEvent.fill(page.getByRole("textbox", { name: "Fact" }), answer);
      });
      await click(page.getByRole("button", { name: "Save and continue" }));
      if (index < 3) {
        await expect.element(page.getByRole("textbox", { name: "Fact" })).toBeVisible();
      }
    }

    await expect.element(page.getByRole("heading", { name: "You’re in control" })).toBeVisible();
    await click(page.getByRole("button", { name: "Finish setup" }));
    expect(createAction).toHaveBeenCalledTimes(4);
    expect(completeAction).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole("status")).toHaveTextContent("complete");
  });

  it("allows individual skips and partial completion", async () => {
    await page.viewport(390, 844);
    const createAction = vi.fn(async ({ category, content, sensitivity }) => ({
      ok: true as const,
      view: { fact: fact(category, content, { sensitivity }), decision: "created" as const },
    }));
    const completeAction = vi.fn(async () => ({
      ok: true as const,
      view: { status: "completed" as const, reminderAt: null },
    }));
    const rendered = await renderInBrowser(
      <SelfContextOnboarding
        createAction={createAction}
        completeAction={completeAction}
        initialFacts={[]}
      />,
    );
    cleanups.push(rendered.unmount);

    await click(page.getByRole("button", { name: "Skip this question" }));
    await act(async () => {
      await userEvent.fill(page.getByRole("textbox", { name: "Fact" }), "I am based in Chicago.");
    });
    await click(page.getByRole("button", { name: "Save and continue" }));
    await click(page.getByRole("button", { name: "Skip this question" }));
    await click(page.getByRole("button", { name: "Skip this question" }));
    await expect.element(page.getByRole("heading", { name: "You’re in control" })).toBeVisible();

    await click(page.getByRole("button", { name: "Finish setup" }));
    expect(createAction).toHaveBeenCalledTimes(1);
    expect(completeAction).toHaveBeenCalledTimes(1);
  });

  it("allows an empty completion without requiring a fact", async () => {
    await page.viewport(390, 844);
    const completeAction = vi.fn(async () => ({
      ok: true as const,
      view: { status: "completed" as const, reminderAt: null },
    }));
    const rendered = await renderInBrowser(
      <SelfContextOnboarding completeAction={completeAction} initialFacts={[]} />,
    );
    cleanups.push(rendered.unmount);

    await click(page.getByRole("button", { name: "Finish setup" }));
    expect(completeAction).toHaveBeenCalledTimes(1);
    expect(page.getByRole("heading", { name: "Help Eve understand you" }).query()).not.toBeNull();
  });

  it("supports whole-flow skip, one reload-equivalent resume, and failure recovery without losing input", async () => {
    await page.viewport(390, 844);
    const createAction = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: "The service is temporarily unavailable. Try again.",
      })
      .mockImplementation(async ({ category, content, sensitivity }) => ({
        ok: true as const,
        view: { fact: fact(category, content, { sensitivity }), decision: "created" as const },
      }));
    const rendered = await renderInBrowser(
      <SelfContextOnboarding createAction={createAction} initialFacts={[]} />,
    );
    cleanups.push(rendered.unmount);

    const draft = "Keep this answer while the service recovers.";
    await act(async () => {
      await userEvent.fill(page.getByRole("textbox", { name: "Fact" }), draft);
    });
    await click(page.getByRole("button", { name: "Save and continue" }));
    await expect.element(page.getByRole("alert")).toHaveTextContent("temporarily unavailable");
    await expect.element(page.getByRole("textbox", { name: "Fact" })).toHaveValue(draft);
    await expect.element(page.getByRole("textbox", { name: "Fact" })).toHaveFocus();

    await click(page.getByRole("button", { name: "Try again" }));
    await expect
      .element(page.getByRole("heading", { name: /Where are you generally based/ }))
      .toBeVisible();

    await rendered.unmount();
    cleanups.pop();
    const resumed = await renderInBrowser(
      <SelfContextOnboarding initialFacts={[fact("work", "I run a software consultancy.")]} />,
    );
    cleanups.push(resumed.unmount);
    await expect
      .element(page.getByRole("heading", { name: /Where are you generally based/ }))
      .toBeVisible();
    await resumed.unmount();
    cleanups.pop();

    const dismissAction = vi.fn(async () => ({
      ok: true as const,
      view: { status: "dismissed" as const, reminderAt: null },
    }));
    const skipped = await renderInBrowser(
      <SelfContextOnboarding dismissAction={dismissAction} initialFacts={[]} />,
    );
    cleanups.push(skipped.unmount);
    await click(page.getByRole("button", { name: "Skip entire setup" }));
    expect(dismissAction).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole("status")).toHaveTextContent("skipped");
  });

  it("keeps all setup controls reachable at 200% text with no horizontal overflow", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const rendered = await renderInBrowser(<SelfContextOnboarding initialFacts={[]} />);
    cleanups.push(rendered.unmount);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    for (const control of [
      page.getByRole("combobox", { name: "Category" }),
      page.getByRole("combobox", { name: "Sensitivity" }),
      page.getByRole("textbox", { name: "Fact" }),
      page.getByRole("button", { name: "Save and continue" }),
      page.getByRole("button", { name: "Skip this question" }),
      page.getByRole("button", { name: "Finish setup" }),
      page.getByRole("button", { name: "Skip entire setup" }),
    ]) {
      const box = (await control.element()).getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await click(page.getByRole("button", { name: "Skip this question" }));
    expect(page.getByText(/street address/i).query()).not.toBeNull();
  });
});
