import { expect } from "vitest";
import { screen, waitFor } from "@/test/dom";

/**
 * The restricted-match gate, asserted the same way wherever recall is offered.
 *
 * Both front doors - the phone's Search flow and the desktop palette - draw the
 * gate from one hook, so the contract they owe the owner is one contract:
 * "Reveal restricted matches" is not on offer at all until a single record type
 * is chosen, and is offered as a checkbox named after itself once one is. It used
 * to be a permanently disabled checkbox with "Pick a record type first." beneath
 * it; naming a record type now simply produces the control, which is the same
 * rule shown rather than written.
 *
 * The two surfaces reach their record types differently - a strip of chips on the
 * phone, a select in the palette's filter bar - so choosing one is the caller's
 * to do; everything either side of it is the shared part.
 *
 * Deliberately not a shared *render* helper: each suite mounts its own surface,
 * and this only picks up once that surface is showing its filters.
 */
export async function expectRestrictedGateOpensOnRecordType(
  chooseRecordType: () => Promise<void>,
): Promise<void> {
  expect(screen.queryByRole("checkbox", { name: "Reveal restricted matches" })).toBeNull();

  await chooseRecordType();

  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Reveal restricted matches" })).toBeDefined(),
  );
}
