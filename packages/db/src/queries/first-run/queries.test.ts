import { describe, expect, it } from "vitest";
import { createInMemoryFirstRunStore } from "./in-memory-store";
import { createFirstRunQueries } from "./queries";

const OWNER = "owner-1";

function setup(initial: Parameters<typeof createInMemoryFirstRunStore>[0] = { [OWNER]: {} }) {
  const store = createInMemoryFirstRunStore(initial);
  return { store, queries: createFirstRunQueries(store) };
}

describe("first run", () => {
  it("owes a newly admitted account the prompt and nothing else", async () => {
    const { queries } = setup();
    await expect(queries.getHomeFirstRun({ userId: OWNER })).resolves.toEqual({
      welcome: true,
      notebookEmpty: true,
      integrationOffer: false,
    });
  });

  it("stops prompting once skipped, and skipping twice keeps it closed", async () => {
    const { queries } = setup();
    await queries.closeFirstRun({ userId: OWNER });
    await queries.closeFirstRun({ userId: OWNER });
    expect((await queries.getHomeFirstRun({ userId: OWNER })).welcome).toBe(false);
  });

  it("treats a first conversation or a first person as the answer", async () => {
    const { store, queries } = setup({ a: {}, b: {} });
    store.set("a", { hasConversation: true });
    store.set("b", { hasPerson: true });
    expect((await queries.getHomeFirstRun({ userId: "a" })).welcome).toBe(false);
    expect((await queries.getHomeFirstRun({ userId: "b" })).welcome).toBe(false);
    expect((await queries.getHomeFirstRun({ userId: "a" })).notebookEmpty).toBe(true);
    expect((await queries.getHomeFirstRun({ userId: "b" })).notebookEmpty).toBe(false);
    await expect(queries.hasSavedAPerson({ userId: "b" })).resolves.toBe(true);
  });

  it("offers integrations only after First Value, until the offer is closed", async () => {
    const { store, queries } = setup({ [OWNER]: { hasPerson: true } });
    expect((await queries.getHomeFirstRun({ userId: OWNER })).integrationOffer).toBe(false);

    store.set(OWNER, { firstValueReached: true });
    expect((await queries.getHomeFirstRun({ userId: OWNER })).integrationOffer).toBe(true);

    await queries.closeIntegrationOffer({ userId: OWNER });
    expect((await queries.getHomeFirstRun({ userId: OWNER })).integrationOffer).toBe(false);
  });

  it("owes nothing to an account without a profile", async () => {
    const { queries } = setup({});
    await expect(queries.getHomeFirstRun({ userId: OWNER })).resolves.toEqual({
      welcome: false,
      notebookEmpty: false,
      integrationOffer: false,
    });
    await expect(queries.hasSavedAPerson({ userId: OWNER })).resolves.toBe(false);
  });
});
