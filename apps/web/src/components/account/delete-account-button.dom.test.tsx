// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "@/test/dom";

const { deleteUser, signOut, push, refresh } = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/auth/client", () => ({ authClient: { deleteUser }, signOut }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { DeleteAccountButton } from "./delete-account-button";

const EMAIL = "newcomer@example.com";

async function openAndConfirm() {
  const user = userEvent.setup();
  render(<DeleteAccountButton email={EMAIL} />);
  await user.click(screen.getByRole("button", { name: "Delete account" }));
  const dialog = await screen.findByRole("alertdialog");
  return { user, dialog };
}

function confirmButton(dialog: HTMLElement) {
  const buttons = Array.from(dialog.querySelectorAll("button"));
  const confirm = buttons.find((button) => button.textContent?.includes("Delete account"));
  if (!confirm) throw new Error("no confirm button");
  return confirm;
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteUser.mockResolvedValue({ data: { success: true }, error: null });
  signOut.mockResolvedValue(undefined);
});

describe("DeleteAccountButton (#607)", () => {
  it("asks first, naming the signed-in account, and Keep account deletes nothing", async () => {
    const { user, dialog } = await openAndConfirm();

    expect(dialog.textContent).toContain(EMAIL);
    expect(dialog.textContent).toContain("can't be undone");

    await user.click(screen.getByRole("button", { name: "Keep account" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("deletes, signs out, and lands on sign-in once deletion is accepted", async () => {
    const { user, dialog } = await openAndConfirm();

    await user.click(confirmButton(dialog));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    expect(deleteUser).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("still leaves for sign-in when the sign-out after deletion fails", async () => {
    signOut.mockRejectedValue(new Error("network"));
    const { user, dialog } = await openAndConfirm();

    await user.click(confirmButton(dialog));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
  });

  it("asks a stale session to sign in again instead of deleting", async () => {
    deleteUser.mockResolvedValue({
      data: null,
      error: { code: "SESSION_EXPIRED", message: "Session expired" },
    });
    const { user, dialog } = await openAndConfirm();

    await user.click(confirmButton(dialog));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "For your security, sign out and sign back in, then delete the account.",
    );
    expect(signOut).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("shows the server's refusal and keeps the account open", async () => {
    deleteUser.mockResolvedValue({
      data: null,
      error: { code: "BAD_REQUEST", message: "Hand the household to another Owner first." },
    });
    const { user, dialog } = await openAndConfirm();

    await user.click(confirmButton(dialog));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Hand the household to another Owner first.",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("names a failed request plainly and lets the person try again", async () => {
    deleteUser.mockRejectedValueOnce(new Error("offline"));
    const { user, dialog } = await openAndConfirm();

    await user.click(confirmButton(dialog));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Tendnote couldn't delete the account. Try again.",
    );
    await waitFor(() => expect(confirmButton(dialog).hasAttribute("disabled")).toBe(false));
    await user.click(confirmButton(dialog));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
  });
});
