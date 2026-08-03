import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import { SelfContextLaterInvitation } from "./self-context-later-invitation";

let unmount: (() => Promise<void>) | undefined;

afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

describe("Self Context later invitation browser contract", () => {
  it("is a quiet, non-blocking link without urgency or notification treatment", async () => {
    await page.viewport(390, 844);
    const rendered = await renderInBrowser(<SelfContextLaterInvitation />);
    unmount = rendered.unmount;

    await expect
      .element(page.getByRole("heading", { name: "Want to add a little context?" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "Open setup" }))
      .toHaveAttribute("href", "/onboarding/self-context");
    expect(page.getByRole("status").query()).toBeNull();
    expect(page.getByRole("alert").query()).toBeNull();
    expect(page.getByText(/badge|notification|urgent|must/i).query()).toBeNull();
  });
});
