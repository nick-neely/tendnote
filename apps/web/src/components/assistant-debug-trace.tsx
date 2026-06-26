"use client";

// Diagnostic trace for the live Eve turn, toggled from the assistant header.
// Surfaces every tool call (name, step, state, input, output/error), per-tool
// tallies that flag repeats, and the raw stream-event log — each copyable. Reads
// straight from the useEveAgent snapshot; no agent-side instrumentation. A
// developer "Quiet Workbench" surface: mono throughout, on-system status colors.

import type { EveDynamicToolPart, EveMessage } from "eve/react";
import { CheckIcon, ChevronRightIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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

type Tone = "ok" | "error" | "denied" | "waiting" | "pending";

const STATE_TONE: Record<EveDynamicToolPart["state"], Tone> = {
  "input-streaming": "pending",
  "input-available": "pending",
  "approval-requested": "waiting",
  "approval-responded": "waiting",
  "output-available": "ok",
  "output-error": "error",
  "output-denied": "denied",
};

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-success",
  error: "bg-destructive",
  denied: "bg-muted-foreground/60",
  waiting: "bg-info",
  // Pending stays neutral (the warning amber fails AA as small text); the
  // pulsing dot carries the "in flight" signal instead of color.
  pending: "bg-muted-foreground/70",
};

const TONE_BADGE: Record<Tone, string> = {
  ok: "bg-success/12 text-success",
  error: "bg-destructive/12 text-destructive",
  denied: "bg-muted text-muted-foreground",
  waiting: "bg-info/12 text-info",
  pending: "bg-muted text-muted-foreground",
};

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

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

/** Ghost copy control with a brief copied confirmation; degrades quietly. */
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (e.g. an insecure context); stay quiet.
      setCopied(false);
    }
  }

  return (
    <Button
      aria-label={copied ? "Copied to clipboard" : label}
      className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
      onClick={onCopy}
      size="xs"
      type="button"
      variant="ghost"
    >
      {copied ? <CheckIcon aria-hidden className="text-success" /> : <CopyIcon aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Labeled, copyable payload block. `tone="error"` tints it destructive. */
function PayloadBlock({ label, value, tone }: { label: string; value: unknown; tone?: "error" }) {
  const text = stringify(value);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-background",
        tone === "error" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b px-2 py-0.5",
          tone === "error" && "border-destructive/20",
        )}
      >
        <span
          className={cn(
            "font-mono text-[11px] text-muted-foreground",
            tone === "error" && "text-destructive",
          )}
        >
          {label}
        </span>
        <CopyButton label="Copy" value={text} />
      </div>
      <pre className="max-h-56 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/85">
        {text}
      </pre>
    </div>
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
    <section
      className="flex flex-col gap-3 border-t bg-background px-4 py-3 sm:px-5"
      data-debug-trace
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <TerminalIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-[length:var(--text-caption)] font-medium text-muted-foreground">
            Trace · {calls.length} call{calls.length === 1 ? "" : "s"} · {status}
          </span>
        </div>
        {events.length > 0 ? <CopyButton label="Copy events" value={stringify(events)} /> : null}
      </div>

      {tallies.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tallies.map(([toolName, count]) => {
            const repeated = count > 1;
            return (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px]",
                  repeated ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground",
                )}
                key={toolName}
                title={repeated ? `Called ${count} times this turn` : undefined}
              >
                {repeated ? (
                  <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                ) : null}
                {toolName}
                <span className="opacity-60">×{count}</span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="font-mono text-[11px] text-muted-foreground">
          No tool calls yet this session.
        </p>
      )}

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
          <span className="font-mono text-[11px] text-destructive">{error.message}</span>
        </div>
      ) : null}

      {calls.length > 0 ? (
        <ol className="divide-y overflow-hidden rounded-lg border bg-card">
          {calls.map((call, index) => {
            const tone = STATE_TONE[call.state] ?? "pending";
            return (
              <li key={call.toolCallId}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2 outline-none transition-colors duration-150 ease-(--motion-ease-out) hover:bg-muted/40 focus-visible:bg-muted/40 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
                    <ChevronRightIcon
                      aria-hidden
                      className="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-(--motion-ease-out) group-open:rotate-90 motion-reduce:transition-none"
                    />
                    <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                      {index + 1}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        TONE_DOT[tone],
                        tone === "pending" && "animate-pulse motion-reduce:animate-none",
                      )}
                    />
                    <span className="truncate font-mono text-[length:var(--text-small)] font-medium text-foreground">
                      {call.toolName}
                    </span>
                    {typeof call.stepIndex === "number" ? (
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                        step {call.stepIndex}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "ml-auto shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px]",
                        TONE_BADGE[tone],
                      )}
                    >
                      {call.state}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-2 px-3 pt-1 pb-3 pl-[2.125rem]">
                    <PayloadBlock label="input" value={call.input ?? null} />
                    {call.errorText ? (
                      <PayloadBlock label="error" tone="error" value={call.errorText} />
                    ) : null}
                    {call.output !== undefined ? (
                      <PayloadBlock label="output" value={call.output} />
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      ) : null}

      <details className="group rounded-lg border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 outline-none transition-colors duration-150 ease-(--motion-ease-out) hover:bg-muted/40 focus-visible:bg-muted/40 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
          <ChevronRightIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground/70 transition-transform duration-150 ease-(--motion-ease-out) group-open:rotate-90 motion-reduce:transition-none"
          />
          <span className="font-mono text-[11px] text-muted-foreground">Raw stream events</span>
          <span className="font-mono text-[11px] text-muted-foreground/60">({events.length})</span>
        </summary>
        <pre className="max-h-72 overflow-auto border-t px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground/85">
          {stringify(events)}
        </pre>
      </details>
    </section>
  );
}
