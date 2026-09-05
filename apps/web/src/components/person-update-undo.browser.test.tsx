import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { ChatPersonUpdateCard } from "./chat-person-update-card";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => cleanup?.());
it("keeps a multi-field chat update readable and keyboard-undoable on mobile", async () => {
  const update = {
    target: {
      personId: "11111111-1111-4111-8111-111111111111",
      updateId: "22222222-2222-4222-8222-222222222222",
    },
    changes: [
      { field: "displayName" as const, before: "Mara", after: "Mara Alexandra Chen" },
      { field: "birthday" as const, before: "--03-03", after: null },
      {
        field: "profileBlurb" as const,
        before: null,
        after:
          "A long description that wraps naturally in the narrow conversation panel without obscuring Undo or its destination link.",
      },
    ],
  };
  const rendered = await renderInBrowser(
    <ChatPersonUpdateCard
      update={update}
      view={{
        kind: "updated_person",
        personId: update.target.personId,
        displayName: "Mara Alexandra Chen",
        relationshipType: "friend",
        updatedFields: ["displayName", "birthday", "profileBlurb"],
        update,
      }}
    />,
  );
  cleanup = rendered.unmount;
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  expect(rendered.container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  await userEvent.tab();
  await expect.element(page.getByRole("button", { name: "Undo", exact: true })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("status")).toHaveTextContent("Update undone.");
  await expect.element(page.getByRole("link", { name: "View person" })).toBeVisible();
});
