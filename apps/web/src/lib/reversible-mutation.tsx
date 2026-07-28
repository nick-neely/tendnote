"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OwnerActionResult } from "@/lib/owner-action-result";

export type ReversibleMutationAdapter<TView> = {
  project: (prior: TView) => TView;
  inverse: (prior: TView, authoritative: TView) => Promise<OwnerActionResult<TView>>;
};

const REVERSIBLE_MUTATION_LEAVE_MS = 5_000;
const RECONCILIATION_CONFLICT = "This record changed elsewhere. Refresh and try again.";

// biome-ignore lint/suspicious/noConfusingVoidType: existing UI callbacks may ignore acceptance; explicit false alone signals a conflict.
export type ReversibleMutationApplyResult = boolean | void;

type ReversibleMutationLeave<TView> = {
  afterMs?: number;
  apply: (authoritative: TView) => ReversibleMutationApplyResult;
};

export type ReversibleMutationLabels = {
  pending: string;
  success: string;
  rollback: string;
  undo: string;
  undone: string;
};

export type ReversibleMutationApplyPhase = "authoritative" | "projection" | "rollback";

type OptimisticMutation<TView> = {
  kind: "optimistic";
  prior: TView;
  adapter: ReversibleMutationAdapter<TView>;
  command: () => Promise<OwnerActionResult<TView>>;
  apply: (view: TView, phase: ReversibleMutationApplyPhase) => ReversibleMutationApplyResult;
  focusTarget: HTMLElement | null;
  labels: ReversibleMutationLabels;
  failureAnnouncement?: "polite" | "assertive";
  onFinalize?: () => void;
  leave?: ReversibleMutationLeave<TView>;
};

type PendingMutation<TView> = {
  kind: "pending";
  command: () => Promise<OwnerActionResult<TView>>;
  apply: (view: TView, phase: ReversibleMutationApplyPhase) => ReversibleMutationApplyResult;
  focusTarget: HTMLElement | null;
  labels: ReversibleMutationLabels;
  failureAnnouncement?: "polite" | "assertive";
  onFinalize?: () => void;
  inverse?: (authoritative: TView) => Promise<OwnerActionResult<TView>>;
  leave?: ReversibleMutationLeave<TView>;
};

type Mutation<TView> = OptimisticMutation<TView> | PendingMutation<TView>;

export type ReversibleMutationState = {
  pending: boolean;
  undoAvailable: boolean;
  undoRequested: boolean;
  leaving: boolean;
  error: string | null;
  labels: ReversibleMutationLabels;
};

export type ActiveReversibleMutation = {
  intent: string;
  state: ReversibleMutationState;
  requestUndo: () => void;
};

const EMPTY_LABELS: ReversibleMutationLabels = {
  pending: "",
  success: "",
  rollback: "",
  undo: "",
  undone: "",
};

const EMPTY_STATE: ReversibleMutationState = {
  pending: false,
  undoAvailable: false,
  undoRequested: false,
  leaving: false,
  error: null,
  labels: EMPTY_LABELS,
};

type Entry<TView = unknown> = {
  originalPending: boolean;
  undoRequested: boolean;
  prior: TView | null;
  authoritative: TView | null;
  mutation: Mutation<TView>;
  timer: number | null;
};

type ReversibleMutationContextValue = {
  states: Record<string, ReversibleMutationState>;
  run: <TView>(key: string, mutation: Mutation<TView>) => boolean;
  requestUndo: (key: string) => void;
};

const ReversibleMutationContext = createContext<ReversibleMutationContextValue | null>(null);

function restoreFocus(target: HTMLElement | null) {
  if (!target) return;
  requestAnimationFrame(() => target.focus());
}

export function ReversibleMutationProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ReversibleMutationState>>({});
  const [politeAnnouncement, setPoliteAnnouncement] = useState("");
  const [assertiveAnnouncement, setAssertiveAnnouncement] = useState("");
  const entries = useRef(new Map<string, Entry>());

  useEffect(
    () => () => {
      for (const entry of entries.current.values()) {
        if (entry.timer !== null) window.clearTimeout(entry.timer);
        entry.mutation.onFinalize?.();
      }
    },
    [],
  );

  const finalizeEntry = useCallback((key: string, entry: Entry) => {
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    entries.current.delete(key);
    entry.mutation.onFinalize?.();
  }, []);

  const setState = useCallback(
    (
      key: string,
      update:
        | ReversibleMutationState
        | ((current: ReversibleMutationState) => ReversibleMutationState),
    ) => {
      setStates((current) => {
        const previous = current[key] ?? EMPTY_STATE;
        const next = typeof update === "function" ? update(previous) : update;
        return { ...current, [key]: next };
      });
    },
    [],
  );

  const runInverse = useCallback(
    async (key: string, entry: Entry) => {
      const authoritative = entry.authoritative;
      if (!authoritative) return;
      if (entry.timer !== null) {
        window.clearTimeout(entry.timer);
        entry.timer = null;
      }
      setState(key, (current) => ({
        ...current,
        pending: true,
        undoRequested: true,
        error: null,
      }));
      try {
        if (entry.mutation.kind === "optimistic" && entry.prior === null) return;
        const result =
          entry.mutation.kind === "optimistic"
            ? await entry.mutation.adapter.inverse(entry.prior, authoritative)
            : await entry.mutation.inverse?.(authoritative);
        if (!result) return;
        if (!result.ok) {
          setState(key, (current) => ({
            ...current,
            pending: false,
            undoRequested: false,
            error: result.error,
          }));
          if (entry.mutation.failureAnnouncement === "assertive") {
            setAssertiveAnnouncement(result.error);
          } else {
            setPoliteAnnouncement(result.error);
          }
          return;
        }
        const accepted = entry.mutation.apply(result.view, "authoritative");
        if (accepted === false) {
          finalizeEntry(key, entry);
          setState(key, (current) => ({
            ...current,
            pending: false,
            undoAvailable: false,
            undoRequested: false,
            error: RECONCILIATION_CONFLICT,
          }));
          setPoliteAnnouncement(RECONCILIATION_CONFLICT);
          restoreFocus(entry.mutation.focusTarget);
          return;
        }
        finalizeEntry(key, entry);
        setState(key, (current) => ({
          ...current,
          pending: false,
          undoAvailable: false,
          undoRequested: false,
          error: null,
        }));
        setPoliteAnnouncement(entry.mutation.labels.undone);
      } catch {
        const failure = "Unable to undo the change. Try again.";
        setState(key, (current) => ({
          ...current,
          pending: false,
          undoRequested: false,
          error: failure,
        }));
        if (entry.mutation.failureAnnouncement === "assertive") {
          setAssertiveAnnouncement(failure);
        } else {
          setPoliteAnnouncement(failure);
        }
      }
    },
    [finalizeEntry, setState],
  );

  const requestUndo = useCallback(
    (key: string) => {
      const entry = entries.current.get(key);
      if (!entry) return;
      entry.undoRequested = true;
      setState(key, (current) => ({ ...current, undoRequested: true }));
      if (!entry.originalPending) void runInverse(key, entry);
    },
    [runInverse, setState],
  );

  const run = useCallback(
    <TView,>(key: string, mutation: Mutation<TView>): boolean => {
      const existing = entries.current.get(key);
      if (existing) return false;

      const entry: Entry<TView> = {
        originalPending: true,
        undoRequested: false,
        prior: mutation.kind === "optimistic" ? mutation.prior : null,
        authoritative: null,
        mutation,
        timer: null,
      };
      entries.current.set(key, entry as Entry);
      if (mutation.kind === "optimistic") {
        mutation.apply(mutation.adapter.project(mutation.prior), "projection");
      }
      setState(key, {
        pending: true,
        undoAvailable: mutation.kind === "optimistic" || Boolean(mutation.inverse),
        undoRequested: false,
        leaving: Boolean(mutation.leave),
        error: null,
        labels: mutation.labels,
      });
      setPoliteAnnouncement(mutation.labels.pending);

      // fallow-ignore-next-line complexity -- Original settlement is one serialized state machine whose branches are contract-tested in a real browser.
      void (async () => {
        try {
          const result = await mutation.command();
          if (!result.ok) {
            if (mutation.kind === "optimistic") mutation.apply(mutation.prior, "rollback");
            finalizeEntry(key, entry as Entry);
            setState(key, {
              pending: false,
              undoAvailable: false,
              undoRequested: false,
              leaving: false,
              error: result.error,
              labels: mutation.labels,
            });
            if (mutation.failureAnnouncement === "assertive") {
              setAssertiveAnnouncement(result.error);
            } else {
              setPoliteAnnouncement(
                mutation.kind === "optimistic" ? mutation.labels.rollback : result.error,
              );
            }
            restoreFocus(mutation.focusTarget);
            return;
          }

          entry.authoritative = result.view;
          entry.originalPending = false;
          const accepted = !mutation.leave
            ? mutation.apply(result.view, "authoritative")
            : undefined;
          if (accepted === false) {
            finalizeEntry(key, entry as Entry);
            setState(key, {
              pending: false,
              undoAvailable: false,
              undoRequested: false,
              leaving: false,
              error: RECONCILIATION_CONFLICT,
              labels: mutation.labels,
            });
            setPoliteAnnouncement(RECONCILIATION_CONFLICT);
            restoreFocus(mutation.focusTarget);
            return;
          }
          setState(key, (current) => ({
            ...current,
            pending: false,
            leaving: Boolean(mutation.leave),
          }));
          setPoliteAnnouncement(mutation.labels.success);
          if (entry.undoRequested) {
            void runInverse(key, entry as Entry);
            return;
          }
          if (mutation.leave) {
            entry.timer = window.setTimeout(() => {
              const leaveAccepted = mutation.leave?.apply(result.view);
              finalizeEntry(key, entry as Entry);
              setState(key, (current) => ({
                ...current,
                leaving: false,
                undoAvailable: false,
                ...(leaveAccepted === false ? { error: RECONCILIATION_CONFLICT } : {}),
              }));
              if (leaveAccepted === false) setPoliteAnnouncement(RECONCILIATION_CONFLICT);
            }, mutation.leave.afterMs ?? REVERSIBLE_MUTATION_LEAVE_MS);
            return;
          }
          const undoAvailable = mutation.kind === "optimistic" || Boolean(mutation.inverse);
          if (undoAvailable) {
            entry.timer = window.setTimeout(() => {
              finalizeEntry(key, entry as Entry);
              setState(key, (current) => ({ ...current, undoAvailable: false }));
            }, REVERSIBLE_MUTATION_LEAVE_MS);
          } else {
            finalizeEntry(key, entry as Entry);
          }
        } catch {
          if (mutation.kind === "optimistic") mutation.apply(mutation.prior, "rollback");
          finalizeEntry(key, entry as Entry);
          setState(key, {
            pending: false,
            undoAvailable: false,
            undoRequested: false,
            leaving: false,
            error: "Unable to update this record. Try again.",
            labels: mutation.labels,
          });
          const failure = "Unable to update this record. Try again.";
          if (mutation.failureAnnouncement === "assertive") {
            setAssertiveAnnouncement(failure);
          } else {
            setPoliteAnnouncement(
              mutation.kind === "optimistic" ? mutation.labels.rollback : failure,
            );
          }
          restoreFocus(mutation.focusTarget);
        }
      })();

      return true;
    },
    [finalizeEntry, runInverse, setState],
  );

  const value = useMemo(() => ({ states, run, requestUndo }), [requestUndo, run, states]);

  return (
    <ReversibleMutationContext.Provider value={value}>
      {children}
      {politeAnnouncement ? (
        <span aria-live="polite" className="sr-only" role="status">
          {politeAnnouncement}
        </span>
      ) : null}
      {assertiveAnnouncement ? (
        <span aria-live="assertive" className="sr-only" role="alert">
          {assertiveAnnouncement}
        </span>
      ) : null}
    </ReversibleMutationContext.Provider>
  );
}

export function useReversibleMutation(recordId: string, intent: string) {
  const context = useContext(ReversibleMutationContext);
  if (!context) {
    throw new Error("useReversibleMutation must be used within ReversibleMutationProvider");
  }
  const key = `${recordId}:${intent}`;
  return {
    state: context.states[key] ?? EMPTY_STATE,
    run: <TView,>(mutation: Mutation<TView>) => context.run(key, mutation),
    requestUndo: () => context.requestUndo(key),
  };
}

export function useActiveReversibleMutation(
  recordId: string,
  intents: readonly string[],
): ActiveReversibleMutation | null {
  const context = useContext(ReversibleMutationContext);
  if (!context) {
    throw new Error("useActiveReversibleMutation must be used within ReversibleMutationProvider");
  }
  for (const intent of intents) {
    const key = `${recordId}:${intent}`;
    const state = context.states[key];
    if (state && (state.pending || state.undoAvailable || state.undoRequested || state.leaving)) {
      return {
        intent,
        state,
        requestUndo: () => context.requestUndo(key),
      };
    }
  }
  for (const intent of intents) {
    const key = `${recordId}:${intent}`;
    const state = context.states[key];
    if (state?.error) {
      return {
        intent,
        state,
        requestUndo: () => context.requestUndo(key),
      };
    }
  }
  return null;
}
