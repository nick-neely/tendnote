"use client";

// [DEBUG-trace] TEMPORARY diagnostic surface for the repeated-tool-call loop.
// Renders every tool call in the live Eve turn (name, step, state, input,
// output/error) plus the raw stream-event log, so a loop like "search_people
// ×8" and any failing get_person_context are visible at a glance. Remove this
// file and its toggle in assistant-panel.tsx once the loop is fixed
// (grep "[DEBUG-trace]").

import type { EveDynamicToolPart, EveMessage } from "eve/react";
import { cn } from "@/lib/utils";

type ToolCall = {
  toolName: string;
  toolCallId: string;
  stepIndex?: number;
  state: EveDynamicToolPart["state"];
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type StateTone = "pending" | "ok" | "error" | "denied" | "waiting";

const STATE_TONE: Record<EveDynamicToolPart["state"], StateTone> = {
  "input-streaming": "pending",
  "input-available": "pending",
  "approval-requested": "waiting",
  "approval-responded": "waiting",
  "output-available": "ok",
  "output-error": "error",
  "output-denied": "denied",
};

const TONE_CLASS: Record<StateTone, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  error: "bg-destructive/15 text-destructive",
  denied: "bg-muted text-muted-foreground",
  waiting: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

function readToolPart(part: EveDynamicToolPart): ToolCall {
  const base = {
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    stepIndex: part.stepIndex,
    state: part.state,
  } satisfies ToolCall;

  switch (part.state) {
    case "output-available":
      return { ...base, input: part.input, output: part.output };
    case "output-error":
      return { ...base, input: part.input, errorText: part.errorText };
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
    case "output-denied":
      return { ...base, input: part.input };
    default:
      return base;
  }
}

function collectToolCalls(messages: readonly EveMessage[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts) {
      if (part.type === "dynamic-tool") {
        calls.push(readToolPart(part));
      }
    }
  }
  return calls;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AssistantDebugTrace({
  messages,
  events,
  status,
  error,
}: {
  messages: readonly EveMessage[];
  events: readonly unknown[];
  status: string;
  error?: Error;
}) {
  const calls = collectToolCalls(messages);

  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.toolName, (counts.get(call.toolName) ?? 0) + 1);
  }
  const tallies = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section className="border-t bg-muted/30 px-4 py-3 sm:px-5" data-debug-trace>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[length:var(--text-caption)] font-medium text-muted-foreground">
          Trace · {calls.length} tool call{calls.length === 1 ? "" : "s"} · status {status}
        </span>
      </div>

      {tallies.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tallies.map(([toolName, count]) => (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px]",
                count > 1
                  ? "bg-destructive/15 text-destructive"
                  : "bg-secondary text-muted-foreground",
              )}
              key={toolName}
              title={count > 1 ? "Called more than once this turn — possible loop" : undefined}
            >
              {toolName} ×{count}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[length:var(--text-caption)] text-muted-foreground">
          No tool calls yet this session.
        </p>
      )}

      {error ? (
        <p className="mt-2 rounded-md bg-destructive/15 px-2 py-1 font-mono text-[11px] text-destructive">
          {error.message}
        </p>
      ) : null}

      {calls.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1.5">
          {calls.map((call, index) => {
            const tone = STATE_TONE[call.state] ?? "pending";
            return (
              <li className="rounded-md border bg-card px-2.5 py-2" key={call.toolCallId}>
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                      {index + 1}.
                    </span>
                    <span className="font-mono text-[length:var(--text-caption)] font-medium">
                      {call.toolName}
                    </span>
                    {typeof call.stepIndex === "number" ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        step {call.stepIndex}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[11px]",
                        TONE_CLASS[tone],
                      )}
                    >
                      {call.state}
                    </span>
                  </summary>
                  <div className="mt-2 border-t pt-2">
                    <span className="font-mono text-[11px] text-muted-foreground">input</span>
                    <Json value={call.input ?? null} />
                    {call.errorText ? (
                      <>
                        <span className="font-mono text-[11px] text-destructive">error</span>
                        <p className="mt-1 rounded-md bg-destructive/10 p-2 font-mono text-[11px] text-destructive">
                          {call.errorText}
                        </p>
                      </>
                    ) : null}
                    {call.output !== undefined ? (
                      <>
                        <span className="font-mono text-[11px] text-muted-foreground">output</span>
                        <Json value={call.output} />
                      </>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer font-mono text-[11px] text-muted-foreground">
          Raw stream events ({events.length})
        </summary>
        <Json value={events} />
      </details>
    </section>
  );
}
