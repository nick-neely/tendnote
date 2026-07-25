"use client";

import type { PromptNudge } from "@tendnote/domain";
import dynamic from "next/dynamic";
import { DashboardAssistantReserve } from "@/components/dashboard-reserve";
import { useWideViewport } from "@/lib/use-wide-viewport";

/**
 * The dashboard's assistant column: the conversation surface, ready to type into
 * from the moment the destination paints.
 *
 * It used to sit behind an "Open Eve" button. The button was protecting the right
 * thing for the wrong reason — no owner conversation, provider call, or draft may
 * begin before explicit interaction (ADR 0208, #308) — but `useEveAgent` already
 * guarantees that: it holds a durable session and sends nothing until `send()`.
 * Gating the *surface* bought no additional privacy and cost the owner a click
 * before they could write anything down, on the one screen whose whole job is
 * capture. What arrives here is the composer and the panel's static copy; the
 * conversation still starts on the owner's first keystroke.
 *
 * The panel loads as its own chunk (it carries the agent client and the markdown
 * renderer) behind the same reserve the server streams, so the chunk boundary is
 * invisible rather than a second visible loading state.
 */
const AssistantPanel = dynamic(
  () => import("@/components/assistant-panel").then((mod) => mod.AssistantPanel),
  { loading: () => <DashboardAssistantReserve />, ssr: false },
);

export function DashboardAssistant({
  nudges,
  ownerUserId,
  suggestPersonName,
}: {
  /** Calendar-derived prompt nudges; clicking one starts a turn (#114). */
  nudges: PromptNudge[];
  ownerUserId: string;
  suggestPersonName: string | null;
}) {
  // This column lives under `hidden lg:contents`, which hides it on phones but
  // still mounts it. Mounting the panel there would be worse than wasteful: its
  // composer reads the on-device draft and consumes the one-shot "send this draft"
  // handoff the mobile Today band writes, so an invisible second panel could claim
  // that handoff and send a turn the owner never sees. The panel only mounts where
  // it is actually the assistant.
  const wide = useWideViewport();
  if (!wide) return <DashboardAssistantReserve />;

  return (
    <AssistantPanel
      nudges={nudges}
      ownerUserId={ownerUserId}
      suggestPersonName={suggestPersonName}
    />
  );
}
