"use client";

import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { useId } from "react";
import { EyeIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { VisibilityChoiceControl } from "@/components/visibility-choice-control";

/** A household member an Action can be shared with. */
export type ShareableActionMember = {
  userId: string;
  name: string;
  email: string;
};

/**
 * A one-line, plain-language preview of who a visibility choice will let in, shown
 * right above the commit so widening the audience costs a deliberate beat rather than
 * happening silently. Calm and factual — a statement of who, never a warning
 * (DESIGN.md calm-by-default; ADR 0153). Renders nothing for "only me".
 */
export function AudiencePreview({
  choice,
  householdSize,
  selectedCount,
}: {
  choice: VisibilityChoice;
  /** Total active members of the household, including the owner. */
  householdSize: number;
  /** How many members are currently selected (for the "specific people" choice). */
  selectedCount: number;
}) {
  let message: string | null = null;
  if (choice === "whole_household") {
    message = `Visible to all ${householdSize} household ${
      householdSize === 1 ? "member" : "members"
    }.`;
  } else if (choice === "selected_members") {
    message =
      selectedCount > 0
        ? `Visible to you and the ${selectedCount} ${
            selectedCount === 1 ? "person" : "people"
          } you chose.`
        : "Pick at least one person.";
  }

  if (!message) {
    return null;
  }

  return (
    <p className="inline-flex items-center gap-1.5 text-[length:var(--text-small)] text-muted-foreground">
      <EyeIcon aria-hidden className="size-3.5 shrink-0" />
      {message}
    </p>
  );
}

/**
 * The visibility control for a General Action: a calm three-way choice (private,
 * selected members, whole household) plus, when "Specific people" is chosen, a
 * checklist of household members to share with. Scope is a deliberate, explicit
 * choice — never widened by accident — and the whole control only appears when the
 * user actually has household members (ADR 0153). Shared by the create form and the
 * row's re-scope editor so the two never drift.
 */
export function ActionVisibilityField({
  members,
  value,
  selectedUserIds,
  onChoiceChange,
  onSelectedChange,
  name,
}: {
  members: ShareableActionMember[];
  value: VisibilityChoice;
  selectedUserIds: string[];
  onChoiceChange: (choice: VisibilityChoice) => void;
  onSelectedChange: (userIds: string[]) => void;
  name: string;
}) {
  const memberFieldId = useId();

  if (members.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <VisibilityChoiceControl
        name={name}
        onChoiceChange={(choice) => {
          onChoiceChange(choice);
          if (choice !== "selected_members") {
            onSelectedChange([]);
          }
        }}
        value={value}
      />
      {value === "selected_members" ? (
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-foreground">Share with</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {members.map((member) => (
              // The row's selected fill keys off the Checkbox's own data-state rather than
              // `has-checked:`: the registry control is a button, so there is no `:checked`
              // in the row to match. Association is spelled out with htmlFor/id - the whole
              // row stays clickable, and a nested component is not a control lint can see.
              <Label
                className="min-h-16 cursor-pointer rounded-md border border-border bg-card p-3 text-sm font-normal transition-colors hover:border-primary/45 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-secondary"
                htmlFor={`${memberFieldId}-${member.userId}`}
                key={member.userId}
              >
                <Checkbox
                  checked={selectedUserIds.includes(member.userId)}
                  id={`${memberFieldId}-${member.userId}`}
                  onCheckedChange={(checked) => {
                    onSelectedChange(
                      checked === true
                        ? [...selectedUserIds, member.userId]
                        : selectedUserIds.filter((userId) => userId !== member.userId),
                    );
                  }}
                  value={member.userId}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{member.name}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {member.email}
                  </span>
                </span>
              </Label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
