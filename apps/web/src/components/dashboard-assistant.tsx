"use client";

import type { EveApprovalMode, PromptNudge } from "@tendnote/domain";
import dynamic from "next/dynamic";
import { recordAssistantConversationAction } from "@/app/actions/assistant-conversations";
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
  approvalMode = "ask",
  nudges,
  ownerUserId,
  suggestPersonName,
}: {
  /** The owner's Approval Mode, read server-side by the destination (#549). */
  approvalMode?: EveApprovalMode;
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
      approvalMode={approvalMode}
      nudges={nudges}
      // A conversation started here is the same kind of thing as one started on
      // the Assistant page, and has to be findable again from the same list -
      // otherwise the dashboard would be the one surface whose threads quietly
      // vanish (ADR 0238). There is no rail here to update, so the claim is
      // fire-and-forget; the agent hook writes the same row from inside the
      // session, so a failure here loses nothing durable.
      onSessionStarted={(sessionId, firstMessage) => {
        void recordAssistantConversationAction({ firstMessage, sessionId }).catch(() => {});
      }}
      ownerUserId={ownerUserId}
      suggestPersonName={suggestPersonName}
    />
  );
}
