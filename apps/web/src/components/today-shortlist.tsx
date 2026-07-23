"use client";

import type { TodayCandidate, TodayShortlistResponse } from "@tendnote/domain/today";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type CandidateRef = {
  localDate: string;
  candidateIdentity: string;
  reasonKey: string;
};

export type TodayShortlistHandlers = {
  refresh: (input: { localDate: string }) => Promise<TodayShortlistResponse>;
  suppress: (
    input: CandidateRef & {
      kind: "later" | "not_today";
      suppressUntil: Date | null;
    },
  ) => Promise<TodayShortlistResponse>;
  act: (input: CandidateRef) => Promise<TodayShortlistResponse>;
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
  const [response, setResponse] = useState(initial);
  const [laterItem, setLaterItem] = useState<TodayCandidate | null>(null);
  const [laterAt, setLaterAt] = useState(() => defaultLaterValue());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requestRollover = useTodayRollover(localDate, timeZone);
  useEffect(() => setResponse(initial), [initial]);

  function candidateRef(item: TodayCandidate): CandidateRef {
    return {
      localDate,
      candidateIdentity: item.identity,
      reasonKey: item.reason.key,
    };
  }

  function run(action: () => Promise<TodayShortlistResponse>) {
    setError(null);
    startTransition(async () => {
      try {
        setResponse(await action());
        setLaterItem(null);
      } catch {
        if (requestRollover()) return;
        setError("Today couldn't update. Your records are unchanged.");
      }
    });
  }

  return (
    <section aria-label="Today shortlist" className="px-5 pt-6">
      <div className="mb-2 flex items-start justify-between gap-4">
        <h2 className="font-semibold text-sm">Worth your attention</h2>
        {showRefresh ? (
          <Button
            aria-label="Refresh Today shortlist"
            className="size-11 shrink-0"
            disabled={pending}
            onClick={() => run(() => handlers.refresh({ localDate }))}
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
            const presentation = familyPresentation[item.family];
            const Icon = presentation.icon;
            const completesRecord =
              item.action.kind === "complete_follow_up" || item.action.kind === "complete_action";
            const actionHref = "href" in item.action ? item.action.href : undefined;
            return (
              <article className="py-4" data-today-ledger-row key={item.identity}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-muted-foreground text-xs">
                      {presentation.label}
                    </p>
                    <Link
                      className="mt-0.5 flex min-h-11 w-fit items-center font-medium text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      href={item.record.href}
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1 text-foreground/80 text-sm">{item.context}</p>
                    <p className="mt-1.5 text-muted-foreground text-xs">
                      Why today: {item.reason.explanation}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {completesRecord ? (
                        <Button
                          aria-label={`${item.action.label} ${item.title}`}
                          className="min-h-11"
                          disabled={pending}
                          onClick={() => run(() => handlers.act(candidateRef(item)))}
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
                            disabled={pending}
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
                              run(() =>
                                handlers.suppress({
                                  ...candidateRef(item),
                                  kind: "not_today",
                                  suppressUntil: null,
                                }),
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
                      run(() =>
                        handlers.suppress({
                          ...candidateRef(item),
                          kind: "later",
                          suppressUntil: new Date(laterAt),
                        }),
                      );
                    }}
                  >
                    <label
                      className="flex min-w-52 flex-1 flex-col gap-1 text-xs"
                      htmlFor={`today-later-${item.identity}`}
                    >
                      Show again
                      <Input
                        className="min-h-11"
                        id={`today-later-${item.identity}`}
                        min={toDatetimeLocal(new Date())}
                        onChange={(event) => setLaterAt(event.target.value)}
                        required
                        type="datetime-local"
                        value={laterAt}
                      />
                    </label>
                    <Button className="min-h-11" disabled={pending} size="sm" type="submit">
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
        <div className="mt-2 text-muted-foreground text-xs">
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
        <p className="mt-2 text-muted-foreground text-xs" key={limitation} role="status">
          {limitation}
        </p>
      ))}
      <p aria-live="polite" className="sr-only">
        {pending ? "Updating Today." : ""}
      </p>
      {error ? (
        <p className="mt-3 text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function defaultLaterValue(): string {
  return toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1_000));
}

function useTodayRollover(localDate: string, timeZone: string): () => boolean {
  const router = useRouter();
  const rolloverRequested = useRef(false);
  const requestRollover = useCallback(() => {
    if (localDateInTimeZone(new Date(), timeZone) === localDate || rolloverRequested.current) {
      return false;
    }
    rolloverRequested.current = true;
    router.refresh();
    return true;
  }, [localDate, router, timeZone]);

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

function toDatetimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
