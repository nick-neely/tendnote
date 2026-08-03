"use client";

import type { TodayCandidate, TodayShortlistResponse } from "@tendnote/domain/today";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookmarkIcon,
  CakeIcon,
  CalendarDotsIcon,
  CheckIcon,
  ClipboardTextIcon,
  type Icon,
  ListTodoIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  RepeatIcon,
  RotateCwIcon,
  UserRoundIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DateTimePicker, toDateTimeValue } from "@/components/ui/date-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { captureFocusAfterRemoval } from "@/lib/focus-after-removal";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import {
  ReversibleMutationProvider,
  useReversibleMutationController,
} from "@/lib/reversible-mutation";
import { todaySuppressionAdapter } from "@/lib/today-reversible-mutation";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

type CandidateRef = {
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
};

type TodayMutationKey = { recordId: string; intent: "pending" | "suppress" };

export type TodayShortlistHandlers = {
  refresh: (input: { localDate: string }) => Promise<OwnerActionResult<TodayShortlistResponse>>;
  suppress: (
    input: CandidateRef & {
      kind: "later" | "not_today";
      suppressUntil: Date | null;
    },
  ) => Promise<OwnerActionResult<TodayShortlistResponse>>;
  restore: (
    input: CandidateRef & { kind: "later" | "not_today" },
  ) => Promise<OwnerActionResult<TodayShortlistResponse>>;
  act: (input: CandidateRef) => Promise<OwnerActionResult<TodayShortlistResponse>>;
};

const familyPresentation: Record<TodayCandidate["family"], { label: string; icon: Icon }> = {
  follow_up: { label: "Follow-Up", icon: UserRoundIcon },
  birthday: { label: "Birthday", icon: CakeIcon },
  action: { label: "Action", icon: ListTodoIcon },
  routine: { label: "Routine", icon: RepeatIcon },
  calendar: { label: "Calendar", icon: CalendarDotsIcon },
  review: { label: "Review", icon: ClipboardTextIcon },
  saved_item: { label: "Saved Item", icon: BookmarkIcon },
  relationship_context: { label: "Relationship", icon: MessageCircleIcon },
};

export function TodayShortlist({
  ...props
}: {
  handlers: TodayShortlistHandlers;
  initial: TodayShortlistResponse;
  localDate: string;
  timeZone: string;
  showRefresh?: boolean;
}) {
  return (
    <ReversibleMutationProvider>
      <TodayShortlistContent key={props.localDate} {...props} />
    </ReversibleMutationProvider>
  );
}

// fallow-ignore-next-line complexity -- Today owns one bounded shortlist interaction surface; family rendering, rollover, and reversible suppression share the same authoritative response.
function TodayShortlistContent({
  handlers,
  initial,
  localDate,
  timeZone,
  showRefresh = true,
}: {
  handlers: TodayShortlistHandlers;
  initial: TodayShortlistResponse;
  localDate: string;
  timeZone: string;
  showRefresh?: boolean;
}) {
  const [items, setItems] = useServerSyncedList(initial.items, (item) => item.identity);
  const [responseMeta, setResponseMeta] = useState<Omit<TodayShortlistResponse, "items">>(() => {
    const { items: _items, ...meta } = initial;
    return meta;
  });
  const response = { ...responseMeta, items };
  const [laterItem, setLaterItem] = useState<TodayCandidate | null>(null);
  const [laterAt, setLaterAt] = useState(() => defaultLaterValue());
  const mutations = useReversibleMutationController();
  const [activeKeys, setActiveKeys] = useState<TodayMutationKey[]>([]);
  const suppressedIds = useRef(new Set<string>());
  const activeStates = activeKeys.map((key) => ({
    key,
    state: mutations.state(key.recordId, key.intent),
  }));
  const pending = activeStates.some(({ state }) => state.pending);
  const requestRollover = useTodayRollover(localDate, timeZone);

  useEffect(() => {
    setItems((current) =>
      current.map(
        (item) => initial.items.find((candidate) => candidate.identity === item.identity) ?? item,
      ),
    );
    const { items: _items, ...meta } = initial;
    setResponseMeta(meta);
  }, [initial, setItems]);

  function candidateRef(item: TodayCandidate): CandidateRef {
    return {
      localDate,
      candidateIdentity: item.identity,
      reasonKey: item.reason.key,
    };
  }

  function applyResponse(
    view: TodayShortlistResponse,
    phase: "authoritative" | "inverse" | "projection" | "rollback",
  ) {
    setItems(view.items.filter((item) => !suppressedIds.current.has(item.identity)));
    const { items: _items, ...meta } = view;
    setResponseMeta(meta);
    if (phase === "authoritative") setLaterItem(null);
    return true;
  }

  function trackMutation(key: TodayMutationKey) {
    setActiveKeys((current) =>
      current.some(
        (candidate) => candidate.recordId === key.recordId && candidate.intent === key.intent,
      )
        ? current
        : [...current, key],
    );
  }

  function runPending(
    item: TodayCandidate | null,
    action: () => Promise<OwnerActionResult<TodayShortlistResponse>>,
    focusTarget: HTMLElement | null,
  ) {
    const recordId = item?.identity ?? "today-shortlist";
    const moveFocus = item ? focusAfterRowRemoval(item.identity) : null;
    trackMutation({ recordId, intent: "pending" });
    mutations.run(recordId, "pending", {
      kind: "pending",
      apply: (view, phase) => {
        const accepted = applyResponse(view, phase);
        if (
          phase === "authoritative" &&
          item &&
          !view.items.some((candidate) => candidate.identity === item.identity)
        ) {
          moveFocus?.();
        }
        return accepted;
      },
      command: action,
      focusTarget,
      labels: {
        pending: "Updating Today…",
        success: "Today updated.",
        rollback: "Today was not changed.",
        undo: "",
        undone: "",
      },
    });
  }

  function runSuppression(
    item: TodayCandidate,
    kind: "later" | "not_today",
    suppressUntil: Date | null,
    focusTarget: () => HTMLElement | null,
  ) {
    const reference = candidateRef(item);
    const moveFocus = focusAfterRowRemoval(item.identity);
    const key = { recordId: item.identity, intent: "suppress" } as const;
    suppressedIds.current.add(item.identity);
    trackMutation(key);
    const started = mutations.run(item.identity, "suppress", {
      kind: "optimistic",
      adapter: todaySuppressionAdapter(item.identity, () =>
        handlers.restore({ ...reference, kind }),
      ),
      apply: (view, phase) => {
        if (phase === "rollback" || phase === "inverse") {
          suppressedIds.current.delete(item.identity);
        }
        const accepted = applyResponse(view, phase);
        if (phase === "projection") moveFocus();
        return accepted;
      },
      command: () => handlers.suppress({ ...reference, kind, suppressUntil }),
      focusTarget,
      labels: {
        pending: kind === "later" ? "Setting Today item aside…" : "Removing item from Today…",
        success: "Today updated. Undo available.",
        rollback: "The Today item was restored after the change failed.",
        undo: kind === "later" ? "Undo Later" : "Undo Not today",
        undone: "Today item restored.",
      },
      prior: response,
    });
    if (!started) suppressedIds.current.delete(item.identity);
  }

  function runWithRollover(
    item: TodayCandidate | null,
    action: () => Promise<OwnerActionResult<TodayShortlistResponse>>,
    focusTarget: HTMLElement | null,
  ) {
    runPending(
      item,
      async () => {
        try {
          return await action();
        } catch (cause) {
          if (requestRollover()) {
            return { ok: false, error: "Today rolled to a new day. Refreshing…" };
          }
          throw cause;
        }
      },
      focusTarget,
    );
  }

  return (
    <section aria-busy={pending} aria-label="Today shortlist" className="px-5 pt-6">
      <div className="mb-2 flex items-start justify-between gap-4">
        <h2 className="font-semibold text-sm">Worth your attention</h2>
        {showRefresh ? (
          <Button
            aria-label="Refresh Today shortlist"
            className="size-11 shrink-0"
            disabled={pending}
            onClick={(event) =>
              runWithRollover(null, () => handlers.refresh({ localDate }), event.currentTarget)
            }
            size="icon-lg"
            variant="ghost"
          >
            <RotateCwIcon aria-hidden />
          </Button>
        ) : null}
      </div>

      {response.items.length > 0 ? (
        <div className="divide-y" data-testid="today-ledger">
          {response.items.map((item) => {
            const itemPending =
              mutations.state(item.identity, "pending").pending ||
              mutations.state(item.identity, "suppress").pending;
            const presentation = familyPresentation[item.family];
            const Icon = presentation.icon;
            const completesRecord =
              item.action.kind === "complete_follow_up" || item.action.kind === "complete_action";
            const actionHref = "href" in item.action ? item.action.href : undefined;
            return (
              <article
                aria-busy={itemPending}
                className="py-4"
                data-today-ledger-row
                data-today-row={item.identity}
                key={item.identity}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
                      {presentation.label}
                    </p>
                    <Link
                      className="mt-0.5 flex min-h-11 w-fit items-center font-medium text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      href={item.record.href}
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1 text-foreground/80 text-sm">{item.context}</p>
                    <p className="mt-1.5 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                      Why today: {item.reason.explanation}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {completesRecord ? (
                        <Button
                          aria-label={`${item.action.label} ${item.title}`}
                          className="min-h-11"
                          disabled={itemPending}
                          onClick={(event) =>
                            runWithRollover(
                              item,
                              () => handlers.act(candidateRef(item)),
                              event.currentTarget,
                            )
                          }
                          size="sm"
                          variant="secondary"
                        >
                          <CheckIcon aria-hidden data-icon="inline-start" />
                          {item.action.label}
                        </Button>
                      ) : (
                        <Button asChild className="min-h-11" size="sm" variant="secondary">
                          <Link href={actionHref ?? item.record.href}>{item.action.label}</Link>
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={`More options for ${item.title}`}
                            className="min-h-11"
                            disabled={itemPending}
                            data-today-control={item.identity}
                            size="sm"
                            variant="ghost"
                          >
                            <MoreHorizontalIcon aria-hidden data-icon="inline-start" />
                            More
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild className="min-h-11">
                            <Link href={item.record.href}>Open record</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-11"
                            onSelect={() => setLaterItem(item)}
                          >
                            Later
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-11"
                            onSelect={() =>
                              runSuppression(
                                item,
                                "not_today",
                                null,
                                () =>
                                  Array.from(
                                    document.querySelectorAll<HTMLElement>("[data-today-control]"),
                                  ).find(
                                    (control) => control.dataset.todayControl === item.identity,
                                  ) ?? null,
                              )
                            }
                          >
                            Not today
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
                {laterItem?.identity === item.identity ? (
                  <form
                    className="mt-3 ml-12 flex flex-wrap items-end gap-2 border-t pt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      runSuppression(
                        item,
                        "later",
                        new Date(laterAt),
                        () =>
                          Array.from(
                            document.querySelectorAll<HTMLElement>("[data-today-later-submit]"),
                          ).find((control) => control.dataset.todayLaterSubmit === item.identity) ??
                          null,
                      );
                    }}
                  >
                    {/* The label sits beside the control rather than around it:
                        wrapping folds the time field's own name into the label,
                        and the date trigger ends up called "Show again Time". */}
                    <div className="flex min-w-52 flex-1 flex-col gap-1 text-[length:var(--text-small)]">
                      <Label className="font-normal" htmlFor={`today-later-${item.identity}`}>
                        Show again
                      </Label>
                      <DateTimePicker
                        // The form cannot be submitted without a date, so there
                        // is nothing for a clear button to mean here. Left
                        // clearable it also let the date be emptied while
                        // `required` still only covered the time half, and the
                        // submit handed `new Date("")` - an Invalid Date - to
                        // the suppression, which the native `datetime-local`
                        // this replaced had blocked outright.
                        clearable={false}
                        id={`today-later-${item.identity}`}
                        min={toDateTimeValue(new Date())}
                        onChange={setLaterAt}
                        required
                        // Today rows are thumb-first, so both halves keep the
                        // 44px target the native field had.
                        size="touch"
                        timeLabel="Show again time"
                        value={laterAt}
                      />
                    </div>
                    <Button
                      className="min-h-11"
                      data-today-later-submit={item.identity}
                      disabled={itemPending}
                      size="sm"
                      type="submit"
                    >
                      Set
                    </Button>
                    <Button
                      className="min-h-11"
                      onClick={() => setLaterItem(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Cancel
                    </Button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="py-10 text-center">
          <p className="font-medium text-sm">Nothing needs your attention today.</p>
        </div>
      )}

      {response.overflow ? (
        <div className="mt-2 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          <span>
            {response.overflow.omittedCount} more dated{" "}
            {response.overflow.omittedCount === 1 ? "item is" : "items are"} waiting in
          </span>{" "}
          {response.overflow.destinations.map((destination, index) => (
            <span key={destination.family}>
              {index > 0 ? ", " : null}
              <Link
                className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
                href={destination.href}
              >
                {destination.label}
              </Link>
            </span>
          ))}
          .
        </div>
      ) : null}
      {response.limitations.map((limitation) => (
        <p
          className="mt-2 text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]"
          key={limitation}
          role="status"
        >
          {limitation}
        </p>
      ))}
      {activeStates.map(({ key, state }) =>
        state.pending || state.undoAvailable || state.error ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-2"
            key={`${key.recordId}:${key.intent}`}
          >
            {state.undoAvailable ? (
              <Button
                disabled={state.undoRequested}
                onClick={() => mutations.requestUndo(key.recordId, key.intent)}
                size="sm"
                type="button"
                variant="outline"
              >
                {state.undoRequested ? "Undoing…" : state.labels.undo}
              </Button>
            ) : null}
            {state.pending ? (
              <p aria-live="polite" className="text-muted-foreground text-sm">
                {state.labels.pending || "Updating Today…"}
              </p>
            ) : null}
            {state.error ? (
              <p className="text-destructive text-sm" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
        ) : null,
      )}
    </section>
  );
}

function defaultLaterValue(): string {
  return toDateTimeValue(new Date(Date.now() + 60 * 60 * 1_000));
}

function focusAfterRowRemoval(identity: string): () => void {
  const row = Array.from(document.querySelectorAll<HTMLElement>("[data-today-row]")).find(
    (candidate) => candidate.dataset.todayRow === identity,
  );
  return captureFocusAfterRemoval(row, "h2");
}

function useTodayRollover(localDate: string, timeZone: string): () => boolean {
  const router = useRouter();
  const refresh = router.refresh;
  const rolloverRequested = useRef(false);
  const requestRollover = useCallback(() => {
    if (localDateInTimeZone(new Date(), timeZone) === localDate || rolloverRequested.current) {
      return false;
    }
    rolloverRequested.current = true;
    refresh();
    return true;
  }, [localDate, refresh, timeZone]);

  useEffect(() => {
    rolloverRequested.current = false;
    requestRollover();
    const interval = window.setInterval(requestRollover, 60_000);
    document.addEventListener("visibilitychange", requestRollover);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", requestRollover);
    };
  }, [requestRollover]);

  return requestRollover;
}

function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
