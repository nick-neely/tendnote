import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { AboutYouSurface } from "./about-you-surface";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
});

describe("About you browser contract", () => {
  it("keeps the editor reachable, named, focus-safe, and scroll-safe at 200% text", async () => {
    await page.viewport(390, 844);
    document.documentElement.style.fontSize = "200%";
    const createAction = vi.fn(async () => ({
      ok: false as const,
      error: "The service is temporarily unavailable. Try again.",
    }));
    const updateAction = vi.fn();
    const rendered = await renderInBrowser(
      <AboutYouSurface createAction={createAction} initialFacts={[]} updateAction={updateAction} />,
    );
    cleanups.push(rendered.unmount);

    expect(rendered.container.scrollWidth).toBeLessThanOrEqual(rendered.container.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await act(async () => {
      (await page.getByRole("button", { name: "Add a fact" }).element()).focus();
      await userEvent.keyboard("{Enter}");
    });
    await expect.element(page.getByRole("textbox", { name: "Fact" })).toHaveFocus();

    for (const control of [
      page.getByRole("combobox", { name: "Category" }),
      page.getByRole("combobox", { name: "Sensitivity" }),
      page.getByRole("textbox", { name: "Fact" }),
      page.getByRole("button", { name: "Save fact" }),
      page.getByRole("button", { name: "Cancel" }),
    ]) {
      const box = (await control.element()).getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await act(async () => {
      await userEvent.fill(
        page.getByRole("textbox", { name: "Fact" }),
        "Keep this editable draft while the service recovers.",
      );
      await userEvent.keyboard("{Tab}");
    });
    await expect.element(page.getByRole("button", { name: "Save fact" })).toHaveFocus();
    await act(async () => userEvent.keyboard("{Space}"));
    await expect.element(page.getByRole("alert")).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Fact" }))
      .toHaveValue("Keep this editable draft while the service recovers.");
    await expect.element(page.getByRole("textbox", { name: "Fact" })).toHaveFocus();
    expect(rendered.container.scrollWidth).toBeLessThanOrEqual(rendered.container.clientWidth);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it("keeps the focused destination inside the document at desktop width", async () => {
    await page.viewport(1280, 900);
    document.documentElement.style.fontSize = "200%";
    const rendered = await renderInBrowser(
      <main className="w-full px-6 py-6">
        <AboutYouSurface initialFacts={[]} />
      </main>,
    );
    cleanups.push(rendered.unmount);

    await expect.element(page.getByRole("heading", { name: "About you" })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(rendered.container.scrollWidth).toBeLessThanOrEqual(rendered.container.clientWidth);
  });
});
