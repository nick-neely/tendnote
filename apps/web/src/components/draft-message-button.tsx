"use client";

import type { MessageDraftPurpose } from "@tendnote/domain";
import { PenLineIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useCreateDraft } from "@/components/use-create-draft";

/**
 * Reusable "Draft a message" entry-point button (PRD #75, issue #79). Pass the
 * explicit relationship context for the surface it lives on; it calls the shared
 * generator and routes into the persisted draft review flow. It never sends or
 * creates anything externally.
 */
export function DraftMessageButton({
  personId,
  purpose,
  followupContext,
  briefItemContext,
  label = "Draft a message",
  size = "sm",
  variant = "outline",
}: {
  personId: string;
  purpose?: MessageDraftPurpose;
  followupContext?: { id: string; reason: string };
  briefItemContext?: { id: string; title: string; reason?: string };
  label?: string;
  size?: "sm" | "icon-sm";
  variant?: "outline" | "ghost" | "default";
}) {
  const { create, pending, error } = useCreateDraft();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() => create({ personId, purpose, followupContext, briefItemContext })}
        size={size}
        type="button"
        variant={variant}
      >
        <PenLineIcon />
        {label}
      </Button>
      {error ? (
        <p className="text-[length:var(--text-small)] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
