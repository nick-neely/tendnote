"use client";

import { Suggestion } from "@/components/ai-elements/suggestion";
import { ASSISTANT_CONVERSATION_STARTERS } from "@/lib/assistant/starters";

export function AssistantStarterChips({
  disabled = false,
  onSend,
}: {
  disabled?: boolean;
  onSend?: (text: string) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {ASSISTANT_CONVERSATION_STARTERS.map((starter) => (
        <Suggestion key={starter} disabled={disabled} onClick={onSend} suggestion={starter} />
      ))}
    </div>
  );
}
