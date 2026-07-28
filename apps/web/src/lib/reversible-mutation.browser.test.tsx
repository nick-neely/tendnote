import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderInBrowser } from "@/test/browser";
import {
  type ReversibleMutationAdapter,
  ReversibleMutationProvider,
  useActiveReversibleMutation,
  useReversibleMutation,
} from "./reversible-mutation";
import { useServerSyncedList } from "./use-server-synced-list";

type View = {
  id: string;
  revision: string;
  label: string;
};

const PRIOR: View = { id: "record-1", revision: "1", label: "Before" };
const PROJECTED: View = { ...PRIOR, label: "Projected" };

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

async function mount(ui: React.ReactNode) {
  const rendered = await renderInBrowser(ui);
  cleanups.push(rendered.unmount);
}

async function click(control: ReturnType<typeof page.getByRole>) {
  await act(async () => {
    await userEvent.click(control);
  });
}

async function settleInAct(settle: () => void) {
  await act(async () => {
    settle();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function Harness({
  command,
  adapter,
}: {
  command: () => Promise<{ ok: true; view: View } | { ok: false; error: string }>;
  adapter: ReversibleMutationAdapter<View>;
}) {
  const [view, setView] = useState(PRIOR);
  const mutation = useReversibleMutation("record-1", "resolve");

  return (
    <div>
      <button
        onClick={(event) =>
          mutation.run({
            kind: "optimistic",
            adapter,
            apply: setView,
            command,
            focusTarget: event.currentTarget,
            labels: {
              pending: "Resolving record…",
              rollback: "The record was restored after the change failed.",
              success: "Record resolved. Undo available.",
              undo: "Undo resolve",
              undone: "Record restored.",
            },
            prior: view,
          })
        }
        type="button"
      >
        Resolve
      </button>
      <span>{view.label}</span>
      {mutation.state.pending ? <span>{mutation.state.labels.pending}</span> : null}
      {mutation.state.undoAvailable ? (
        <button onClick={mutation.requestUndo} type="button">
          {mutation.state.undoRequested ? "Undoing…" : mutation.state.labels.undo}
        </button>
      ) : null}
    </div>
  );
}

function DestructiveHarness({
  command,
}: {
  command: () => Promise<{ ok: true; view: View } | { ok: false; error: string }>;
}) {
  const [view, setView] = useState(PRIOR);
  const mutation = useReversibleMutation("record-1", "delete");

  return (
    <div>
      <button
        onClick={(event) =>
          mutation.run({
            kind: "pending",
            apply: setView,
            command,
            failureAnnouncement: "assertive",
            focusTarget: event.currentTarget,
            labels: {
              pending: "Deleting record…",
              rollback: "The record could not be deleted.",
              success: "Record deleted.",
              undo: "",
              undone: "",
            },
          })
        }
        type="button"
      >
        Delete
      </button>
      <span>{view.label}</span>
      {mutation.state.pending ? <span>{mutation.state.labels.pending}</span> : null}
    </div>
  );
}

function LeavingHarness({
  command,
  onLeave,
}: {
  command: () => Promise<{ ok: true; view: View } | { ok: false; error: string }>;
  onLeave: (view: View) => void;
}) {
  const [view, setView] = useState(PRIOR);
  const mutation = useReversibleMutation("record-1", "archive");
  const adapter: ReversibleMutationAdapter<View> = {
    project: () => PROJECTED,
    inverse: async () => ({ ok: true, view: PRIOR }),
  };

  return (
    <div>
      <button
        onClick={(event) =>
          mutation.run({
            kind: "optimistic",
            adapter,
            apply: setView,
            command,
            focusTarget: event.currentTarget,
            labels: {
              pending: "Archiving record…",
              rollback: "The record was restored.",
              success: "Record archived. Undo available.",
              undo: "Undo archive",
              undone: "Record restored.",
            },
            leave: { afterMs: 20, apply: onLeave },
            prior: view,
          })
        }
        type="button"
      >
        Archive
      </button>
      <span>{view.label}</span>
      <span>{mutation.state.leaving ? "Leaving" : "Staying"}</span>
    </div>
  );
}

function ReconciliationHarness() {
  const initial = { id: "record-1", revision: "1", label: "Initial" };
  const [server, setServer] = useState([initial]);
  const [items, setItems] = useServerSyncedList(
    server,
    (item) => item.id,
    undefined,
    (item) => item.revision,
  );

  return (
    <div>
      <span>{items[0]?.label}</span>
      <button
        onClick={() => setItems([{ id: "record-1", revision: "3", label: "Acknowledged" }])}
        type="button"
      >
        Acknowledge revision 3
      </button>
      <button
        onClick={() => setServer([{ id: "record-1", revision: "2", label: "Stale" }])}
        type="button"
      >
        Render stale revision 2
      </button>
    </div>
  );
}

function ListPositionHarness({
  command,
}: {
  command: () => Promise<{ ok: true; view: View[] } | { ok: false; error: string }>;
}) {
  const prior = [
    { id: "a", revision: "1", label: "First" },
    { id: "b", revision: "1", label: "Middle" },
    { id: "c", revision: "1", label: "Last" },
  ];
  const [items, setItems] = useState(prior);
  const mutation = useReversibleMutation("b", "reopen");
  const adapter: ReversibleMutationAdapter<View[]> = {
    project: (current) => current.filter((item) => item.id !== "b"),
    inverse: async (current) => ({ ok: true, view: current }),
  };

  return (
    <div>
      <button
        onClick={(event) =>
          mutation.run({
            kind: "optimistic",
            adapter,
            apply: setItems,
            command,
            focusTarget: event.currentTarget,
            labels: {
              pending: "Reopening record…",
              rollback: "The record returned to its prior position.",
              success: "Record reopened. Undo available.",
              undo: "Undo reopen",
              undone: "Record restored.",
            },
            prior: items,
          })
        }
        type="button"
      >
        Reopen middle
      </button>
      <span>{items.map((item) => item.label).join("|")}</span>
    </div>
  );
}

function SiblingIntentHarness({
  archiveCommand,
}: {
  archiveCommand: () => Promise<{ ok: true; view: View }>;
}) {
  const complete = useReversibleMutation("record-1", "complete");
  const archive = useReversibleMutation("record-1", "archive");
  const active = useActiveReversibleMutation("record-1", ["complete", "archive"]);
  const labels = {
    pending: "Updating record…",
    rollback: "The record was restored.",
    success: "Record updated.",
    undo: "",
    undone: "",
  };

  return (
    <div>
      <button
        onClick={(event) =>
          complete.run({
            kind: "pending",
            apply: () => {},
            command: async () => ({ ok: false, error: "Complete failed." }),
            focusTarget: event.currentTarget,
            labels,
          })
        }
        type="button"
      >
        Fail complete
      </button>
      <button
        onClick={(event) =>
          archive.run({
            kind: "pending",
            apply: () => {},
            command: archiveCommand,
            focusTarget: event.currentTarget,
            labels,
          })
        }
        type="button"
      >
        Start archive
      </button>
      <span>
        Active {active?.intent ?? "none"}:
        {active?.state.pending ? "pending" : active?.state.error ? "error" : "settled"}
      </span>
    </div>
  );
}

describe("reversible mutation contract", () => {
  it("projects immediately, then restores the exact prior view and focus with a polite rollback", async () => {
    let settle:
      | ((result: { ok: true; view: View } | { ok: false; error: string }) => void)
      | undefined;
    const command = vi.fn(
      () =>
        new Promise<{ ok: true; view: View } | { ok: false; error: string }>((resolve) => {
          settle = resolve;
        }),
    );
    const adapter: ReversibleMutationAdapter<View> = {
      project: () => PROJECTED,
      inverse: vi.fn(),
    };
    await mount(
      <ReversibleMutationProvider>
        <Harness adapter={adapter} command={command} />
      </ReversibleMutationProvider>,
    );

    const control = page.getByRole("button", { name: "Resolve" });
    await click(control);

    await expect.element(page.getByText("Projected")).toBeVisible();
    await expect.element(page.getByText("Resolving record…").first()).toBeVisible();

    await settleInAct(() => settle?.({ ok: false, error: "The record changed elsewhere." }));

    await expect.element(page.getByText("Before")).toBeVisible();
    await expect.element(control).toHaveFocus();
    await expect
      .element(page.getByText("The record was restored after the change failed."))
      .toBeVisible();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain(
      "The record was restored after the change failed.",
    );
  });

  it("serializes an Undo requested mid-flight after the original settles", async () => {
    let settle:
      | ((result: { ok: true; view: View } | { ok: false; error: string }) => void)
      | undefined;
    const command = vi.fn(
      () =>
        new Promise<{ ok: true; view: View } | { ok: false; error: string }>((resolve) => {
          settle = resolve;
        }),
    );
    const inverse = vi.fn(async () => ({ ok: true as const, view: PRIOR }));
    const adapter: ReversibleMutationAdapter<View> = {
      project: () => PROJECTED,
      inverse,
    };
    await mount(
      <ReversibleMutationProvider>
        <Harness adapter={adapter} command={command} />
      </ReversibleMutationProvider>,
    );

    await click(page.getByRole("button", { name: "Resolve" }));
    await click(page.getByRole("button", { name: "Undo resolve" }));

    expect(inverse).not.toHaveBeenCalled();
    await expect.element(page.getByRole("button", { name: "Undoing…" })).toBeVisible();

    const authoritative = { ...PROJECTED, revision: "2" };
    await settleInAct(() => settle?.({ ok: true, view: authoritative }));

    await expect.poll(() => inverse.mock.calls.length).toBe(1);
    expect(inverse).toHaveBeenCalledWith(PRIOR, authoritative);
    await expect.element(page.getByText("Before")).toBeVisible();
  });

  it("announces an inverse failure through the module live region", async () => {
    const authoritative = { ...PROJECTED, revision: "2" };
    const adapter: ReversibleMutationAdapter<View> = {
      project: () => PROJECTED,
      inverse: async () => ({ ok: false, error: "The record changed before Undo." }),
    };
    await mount(
      <ReversibleMutationProvider>
        <Harness adapter={adapter} command={async () => ({ ok: true, view: authoritative })} />
      </ReversibleMutationProvider>,
    );

    await click(page.getByRole("button", { name: "Resolve" }));
    await click(page.getByRole("button", { name: "Undo resolve" }));

    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("The record changed before Undo.");
  });

  it("keeps a Pending Mutation unprojected and announces a destructive failure assertively", async () => {
    const command = vi.fn(async () => ({
      ok: false as const,
      error: "Deletion was refused.",
    }));
    await mount(
      <ReversibleMutationProvider>
        <DestructiveHarness command={command} />
      </ReversibleMutationProvider>,
    );

    const control = page.getByRole("button", { name: "Delete" });
    await click(control);

    await expect.element(page.getByText("Before")).toBeVisible();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Deletion was refused.");
    await expect.element(control).toHaveFocus();
  });

  it("owns leave timing and permits only one in-flight command for the same record and intent", async () => {
    const authoritative = { ...PROJECTED, revision: "2" };
    let settle: ((result: { ok: true; view: View }) => void) | undefined;
    const command = vi.fn(
      () =>
        new Promise<{ ok: true; view: View }>((resolve) => {
          settle = resolve;
        }),
    );
    const onLeave = vi.fn();
    await mount(
      <ReversibleMutationProvider>
        <LeavingHarness command={command} onLeave={onLeave} />
      </ReversibleMutationProvider>,
    );

    const control = page.getByRole("button", { name: "Archive" });
    await click(control);
    await click(control);

    expect(command).toHaveBeenCalledTimes(1);
    await settleInAct(() => settle?.({ ok: true, view: authoritative }));
    await expect.element(page.getByText("Leaving")).toBeVisible();
    expect(onLeave).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    });
    expect(onLeave).toHaveBeenCalledWith(authoritative);
  });

  it("ignores a stale server render after a newer local acknowledgement", async () => {
    await mount(<ReconciliationHarness />);

    await click(page.getByRole("button", { name: "Acknowledge revision 3" }));
    await expect.element(page.getByText("Acknowledged")).toBeVisible();

    await click(page.getByRole("button", { name: "Render stale revision 2" }));

    await expect.element(page.getByText("Acknowledged")).toBeVisible();
    await expect.element(page.getByText(/^Stale$/)).not.toBeInTheDocument();
  });

  it("restores an exact ordered-list snapshot when an optimistic move fails", async () => {
    let settle: ((result: { ok: false; error: string }) => void) | undefined;
    const command = vi.fn(
      () =>
        new Promise<{ ok: false; error: string }>((resolve) => {
          settle = resolve;
        }),
    );
    await mount(
      <ReversibleMutationProvider>
        <ListPositionHarness command={command} />
      </ReversibleMutationProvider>,
    );

    await click(page.getByRole("button", { name: "Reopen middle" }));
    await expect.element(page.getByText("First|Last")).toBeVisible();

    await settleInAct(() => settle?.({ ok: false, error: "Reopen failed." }));

    await expect.element(page.getByText("First|Middle|Last")).toBeVisible();
  });

  it("prioritizes a newer operational intent over an older error-only state", async () => {
    const archiveCommand = vi.fn(
      () =>
        new Promise<{ ok: true; view: View }>(() => {
          // Deliberately remain pending while the active-intent selector is observed.
        }),
    );
    await mount(
      <ReversibleMutationProvider>
        <SiblingIntentHarness archiveCommand={archiveCommand} />
      </ReversibleMutationProvider>,
    );

    await click(page.getByRole("button", { name: "Fail complete" }));
    await expect.element(page.getByText("Active complete:error")).toBeVisible();

    await click(page.getByRole("button", { name: "Start archive" }));

    await expect.element(page.getByText("Active archive:pending")).toBeVisible();
    expect(archiveCommand).toHaveBeenCalledTimes(1);
  });
});
