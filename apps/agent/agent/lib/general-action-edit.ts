import type {
  GeneralActionEdit,
  GeneralActionLink,
  GeneralActionRecurrence,
} from "@tendnote/domain";

/**
 * The raw, tool-facing edit fields shared by `edit_general_action` and the optional
 * correction on `accept_suggested_general_action`. Dates arrive as ISO 8601 strings
 * (the model speaks strings); every field is optional so a caller passes only what it
 * touches. `accept`'s correction uses a subset of these keys.
 */
export type GeneralActionEditInput = {
  title?: string;
  notes?: string | null;
  dueAt?: string | null;
  recurrence?: GeneralActionRecurrence | null;
  areaId?: string | null;
  links?: GeneralActionLink[];
};

/**
 * Maps a tool-facing edit input to the shared `GeneralActionEdit` payload: `undefined`
 * leaves a field unchanged (the key is omitted), explicit `null` clears an optional one,
 * and the due-date string is parsed to a Date. Only keys the caller actually set are
 * included, so the shared lifecycle's "an edit must change something" guard still catches
 * an empty edit rather than this helper silently wiping columns. Shared so the edit and
 * accept-with-correction paths map identically.
 */
export function buildGeneralActionEdit(input: GeneralActionEditInput): GeneralActionEdit {
  const edit: GeneralActionEdit = {};
  if (input.title !== undefined) edit.title = input.title;
  if (input.notes !== undefined) edit.notes = input.notes;
  if (input.dueAt !== undefined) edit.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
  if (input.recurrence !== undefined) edit.recurrence = input.recurrence;
  if (input.areaId !== undefined) edit.areaId = input.areaId;
  if (input.links !== undefined) edit.links = input.links;
  return edit;
}
