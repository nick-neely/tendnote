"use client";

import type { PersonUpdateSummary } from "@tendnote/domain";
import { Body, ResultCard } from "@/components/assistant-result-card";
import { PersonUpdateUndo } from "@/components/person-update-undo";
import type { AssistantToolView } from "@/lib/eve/tool-result-view";

export function ChatPersonUpdateCard({
  view,
  update,
}: {
  view: Extract<AssistantToolView, { kind: "updated_person" }>;
  update: PersonUpdateSummary;
}) {
  return (
    <ResultCard isNew kind="updated_person" tone="confirmed">
      <Body className="font-medium">{view.displayName}</Body>
      <PersonUpdateUndo inConversation key={update.target.updateId} update={update} />
    </ResultCard>
  );
}
