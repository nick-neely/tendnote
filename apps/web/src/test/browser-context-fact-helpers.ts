import { act } from "react";
import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";

export async function clickBrowserControl(control: ReturnType<typeof page.getByRole>) {
  await act(async () => {
    await userEvent.click(control);
  });
}

export async function focusAndPressEnter(control: ReturnType<typeof page.getByRole>) {
  await act(async () => {
    (await control.element()).focus();
    await userEvent.keyboard("{Enter}");
  });
}

export async function expectTouchTargetButtons(names: string[]) {
  for (const name of names) {
    const box = (await page.getByRole("button", { name }).element()).getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

export async function expectFailedFocusedMutation(input: {
  buttonName: string;
  errorText: string;
  factText: string;
}) {
  const control = page.getByRole("button", { name: input.buttonName });
  await focusAndPressEnter(control);
  await expect.element(page.getByRole("alert")).toHaveTextContent(input.errorText);
  await expect.element(page.getByText(input.factText)).toBeVisible();
  await expect.element(control).toHaveFocus();
}

export async function resetBrowserContextFactDom(
  cleanups: Array<() => Promise<void>>,
): Promise<void> {
  while (cleanups.length) await cleanups.pop()?.();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
}
