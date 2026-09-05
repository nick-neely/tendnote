import type { PersonUpdateChange, PersonUpdateUndoStatus } from "@tendnote/domain";
import { titleCase } from "./person-format";

export const PERSON_UNDO_MESSAGES: Record<PersonUpdateUndoStatus, string> = {
  applied: "Update undone.",
  already_undone: "This update was already undone.",
  superseded: "This profile changed again. This update can no longer be undone.",
  unavailable: "This person is no longer available.",
};

export function formatPersonUpdateValue(
  field: PersonUpdateChange["field"],
  value: PersonUpdateChange["before"],
): string {
  if (value === null || value === "") return "Not set";
  if (field === "birthday" && typeof value === "string") {
    const parts = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(value);
    if (!parts) return value;
    const hasYear = parts[1] !== "-";
    const date = new Date(
      Date.UTC(hasYear ? Number(parts[1]) : 2000, Number(parts[2]) - 1, Number(parts[3])),
    );
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      ...(hasYear ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    }).format(date);
  }
  return field === "relationshipType" ? titleCase(String(value)) : String(value);
}
