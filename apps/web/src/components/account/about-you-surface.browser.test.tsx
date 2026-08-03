import type { ContextFactView } from "@tendnote/domain";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { AboutYouSurface } from "./about-you-surface";

const cleanups: Array<() => Promise<void>> = [];

const FACT_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-02T12:00:00.000Z");

function fact(overrides: Partial<ContextFactView> = {}): ContextFactView {
  return {
    id: FACT_ID,
    subject: { kind: "self" },
    category: "work",
    content: "I run a software consultancy.",
    lifecycle: "active",
    sensitivity: "normal",
    provenance: { channel: "account", origin: "direct" },
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
      await userEvent.selectOptions(
        page.getByRole("combobox", { name: "Sensitivity" }),
        "sensitive",
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
    expect(createAction).toHaveBeenCalledWith({
      category: "background",
      content: "Keep this editable draft while the service recovers.",
      sensitivity: "sensitive",
    });
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

  it("edits the authoritative fact and keeps sensitivity independent from private visibility", async () => {
    await page.viewport(390, 844);
    const returned = fact({
      category: "preference",
      content: "The authoritative replacement.",
      sensitivity: "restricted",
      updatedAt: new Date("2026-08-02T12:02:00.000Z"),
    });
    const updateAction = vi.fn(async () => ({
      ok: true as const,
      view: { fact: returned, decision: "updated" as const },
    }));
    const rendered = await renderInBrowser(
      <AboutYouSurface initialFacts={[fact()]} updateAction={updateAction} />,
    );
    cleanups.push(rendered.unmount);

    await click(page.getByRole("button", { name: "Edit Work fact" }));
    await act(async () => {
      await userEvent.fill(page.getByRole("textbox", { name: "Fact" }), "A client draft");
      await userEvent.selectOptions(page.getByRole("combobox", { name: "Category" }), "preference");
      await userEvent.selectOptions(
        page.getByRole("combobox", { name: "Sensitivity" }),
        "restricted",
      );
    });
    await click(page.getByRole("button", { name: "Save changes" }));

    await expect.element(page.getByText(returned.content)).toBeVisible();
    expect(updateAction).toHaveBeenCalledWith({
      contextFactId: FACT_ID,
      expectedUpdatedAt: NOW.toISOString(),
      category: "preference",
      content: "A client draft",
      sensitivity: "restricted",
    });
    await expect.element(page.getByText(/Restricted · Added in Account/)).toBeVisible();
    expect(page.getByRole("combobox", { name: /visibility/i }).query()).toBeNull();
  });

  it("archives with an authoritative Undo and restores the returned active view", async () => {
    await page.viewport(390, 844);
    const archived = fact({
      lifecycle: "archived",
      archivedAt: new Date("2026-08-02T12:03:00.000Z"),
      updatedAt: new Date("2026-08-02T12:03:00.000Z"),
    });
    const restored = fact({
      updatedAt: new Date("2026-08-02T12:04:00.000Z"),
    });
    const archiveAction = vi.fn(async () => ({
      ok: true as const,
      view: { fact: archived, decision: "archived" as const },
    }));
    const restoreAction = vi.fn(async () => ({
      ok: true as const,
      view: { fact: restored, decision: "restored" as const },
    }));
    const deleteAction = vi.fn();
    const rendered = await renderInBrowser(
      <AboutYouSurface
        archiveAction={archiveAction}
        deleteAction={deleteAction}
        initialFacts={[fact()]}
        restoreAction={restoreAction}
      />,
    );
    cleanups.push(rendered.unmount);

    await click(page.getByRole("button", { name: "Archive" }));
    await expect.element(page.getByRole("button", { name: "Undo archive" })).toBeVisible();
    expect(archiveAction).toHaveBeenCalledWith({
      contextFactId: FACT_ID,
      expectedUpdatedAt: NOW.toISOString(),
    });

    await click(page.getByRole("button", { name: "Undo archive" }));
    await expect.element(page.getByRole("button", { name: "Archive" })).toBeVisible();
    expect(restoreAction).toHaveBeenCalledWith({
      contextFactId: FACT_ID,
      expectedArchivedAt: archived.archivedAt?.toISOString(),
    });
    await expect.element(page.getByRole("status")).toHaveTextContent("Fact restored.");
  });

  it("restores through progressive disclosure and requires confirmation for permanent deletion", async () => {
    await page.viewport(390, 844);
    const archived = fact({
      lifecycle: "archived",
      archivedAt: new Date("2026-08-02T12:03:00.000Z"),
    });
    const restored = fact({ updatedAt: new Date("2026-08-02T12:04:00.000Z") });
    const restoreAction = vi.fn(async () => ({
      ok: true as const,
      view: { fact: restored, decision: "restored" as const },
    }));
    const deleteAction = vi.fn(async () => ({
      ok: true as const,
      view: { deletedContextFactId: FACT_ID },
    }));
    const rendered = await renderInBrowser(
      <AboutYouSurface
        deleteAction={deleteAction}
        initialFacts={[archived]}
        restoreAction={restoreAction}
      />,
    );
    cleanups.push(rendered.unmount);

    expect(page.getByText(archived.content).query()).toBeNull();
    await click(page.getByRole("button", { name: "Show archived facts (1)" }));
    await expect.element(page.getByText(archived.content)).toBeVisible();
    await click(page.getByRole("button", { name: "Restore" }));
    await expect.element(page.getByText(restored.content)).toBeVisible();
    expect(restoreAction).toHaveBeenCalledWith({
      contextFactId: FACT_ID,
      expectedArchivedAt: archived.archivedAt?.toISOString(),
    });

    await click(page.getByRole("button", { name: "Delete permanently" }));
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    await expect
      .element(
        page
          .getByRole("alertdialog")
          .getByRole("heading", { name: "Delete this fact permanently?" }),
      )
      .toBeVisible();
    await click(page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently" }));
    await expect.element(page.getByText("Nothing about you yet.")).toBeVisible();
    expect(deleteAction).toHaveBeenCalledWith({ contextFactId: FACT_ID });
  });

  it("rolls back a stale archive intent, keeps the fact active, and restores focus", async () => {
    await page.viewport(390, 844);
    const archiveAction = vi.fn(async () => ({
      ok: false as const,
      error: "That fact changed elsewhere. Refresh the page and try again.",
    }));
    const rendered = await renderInBrowser(
      <AboutYouSurface archiveAction={archiveAction} initialFacts={[fact()]} />,
    );
    cleanups.push(rendered.unmount);

    const archive = page.getByRole("button", { name: "Archive" });
    await click(archive);
    await expect.element(page.getByRole("alert")).toHaveTextContent("changed elsewhere");
    await expect.element(page.getByRole("button", { name: "Archive" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Archive" })).toHaveFocus();
    expect(archiveAction).toHaveBeenCalledTimes(1);
  });
});
