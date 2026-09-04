import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { DraftEditor } from "./draft-editor";
import { SidebarProvider, useSidebar } from "./ui/sidebar";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());

function FoldState() {
  const { state } = useSidebar();
  return <output aria-label="Sidebar state">{state}</output>;
}

it("bolds draft text without folding the sidebar", async () => {
  const onSave = vi.fn();
  const rendered = await renderInBrowser(
    <SidebarProvider>
      <FoldState />
      <DraftEditor markdown="Hello Jordan" onSave={onSave} onCancel={vi.fn()} />
    </SidebarProvider>,
  );
  cleanup = rendered.unmount;
  const editor = page.getByLabelText("Edit draft message");
  await editor.click();
  await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
  await userEvent.keyboard("{ControlOrMeta>}b{/ControlOrMeta}");
  await expect.element(page.getByLabelText("Sidebar state")).toHaveTextContent("expanded");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(onSave).toHaveBeenCalledWith("**Hello Jordan**");
});
