import type { GeneralActionRecurrence } from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
// Type-only, so none of the server-only chain behind these modules is pulled in
// at runtime. This file is pure: it assembles a payload and calls nothing.
import type { createGeneralActionAction } from "@/app/actions/general-actions";
import type { cleanHintLabels } from "@/components/general-action-asset-hints-field";
import type { cleanLinks } from "@/components/general-action-links-field";

export type CreateActionFields = {
  title: string;
  notes: string;
  dueDate: string;
  recurrence: GeneralActionRecurrence | null;
  links: ReturnType<typeof cleanLinks>;
  assetHints: ReturnType<typeof cleanHintLabels>;
  personIds: string[];
  areaId: string | null;
  visibilityChoice: VisibilityChoice;
  selectedUserIds: string[];
};

/**
 * Assembles the create-action server-action payload, including only the optional fields the
 * user actually filled in (an empty note, no date, no links, and so on are simply omitted).
 * Kept a pure function so the submit handler stays a flat try/await/handle flow.
 *
 * It lives beside the form rather than inside it so it can be tested on its own.
 * The rule it encodes is which fields a household-native Action may not carry
 * (ADR 0214), and reaching that through a rendered submit would prove it far
 * less directly than asking the function.
 */
export function buildCreateActionInput(
  fields: CreateActionFields,
): Parameters<typeof createGeneralActionAction>[0] {
  // "Our household" creates a record the household owns, and an Area and people
  // links are one member's own records — so the composer hides both fields for
  // that choice and this drops whatever they were carrying, rather than sending
  // a pre-filled Area (the active filter pre-fills one) into a refusal the member
  // never asked for (ADR 0214).
  const householdNative = fields.visibilityChoice === "whole_household";
  return {
    title: fields.title,
    ...(fields.notes ? { notes: fields.notes } : {}),
    ...(fields.dueDate ? { dueAt: fields.dueDate } : {}),
    ...(fields.recurrence ? { recurrence: fields.recurrence } : {}),
    ...(fields.links.length ? { links: fields.links } : {}),
    ...(fields.assetHints.length ? { assetHints: fields.assetHints } : {}),
    ...(fields.personIds.length && !householdNative ? { personIds: fields.personIds } : {}),
    ...(fields.areaId && !householdNative ? { areaId: fields.areaId } : {}),
    visibilityChoice: fields.visibilityChoice,
    ...(fields.selectedUserIds.length ? { selectedUserIds: fields.selectedUserIds } : {}),
  };
}
