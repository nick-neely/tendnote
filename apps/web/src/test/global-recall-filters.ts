import { expect } from "vitest";
import { screen, type userEvent, waitFor } from "@/test/dom";

/**
 * The restricted-match gate, asserted the same way wherever recall is offered.
 *
 * Both front doors - the phone's Search flow and the desktop palette - draw the
 * gate from one hook, so the contract they owe the owner is one contract:
 * "Reveal restricted matches" stays a checkbox named after itself, disabled with
 * the reason in helper text until a single record type is chosen, and enabled
 * with the helper gone once one is. Only the surrounding layout differs, so the
 * two suites drive it through the accessible names rather than through anything
 * either surface owns.
 *
 * Deliberately not a shared *render* helper: each suite mounts its own surface,
 * and this only picks up once that surface is showing its filters.
 */
export async function expectRestrictedGateOpensOnRecordType(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const restricted = await screen.findByRole("checkbox", { name: "Reveal restricted matches" });
  expect((restricted as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Pick a record type first.")).toBeDefined();

  await user.click(screen.getByRole("combobox", { name: "Record type" }));
  await user.click(await screen.findByRole("option", { name: "People" }));

  await waitFor(() =>
    expect(
      (screen.getByRole("checkbox", { name: "Reveal restricted matches" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("Pick a record type first.")).toBeNull();
}
