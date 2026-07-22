import type {
  CalendarEventSummary,
  GlobalRecallFilter,
  ParsedGlobalRecallInput,
} from "@tendnote/domain";
import type { ActiveFollowupSummary } from "../followups/types";

type TargetedRecallFamily = Exclude<GlobalRecallFilter, "all">;

export type RestrictedRecallAuthorization =
  | { kind: "excluded"; directlyRequested: false }
  | { kind: "family_targeted"; directlyRequested: true; family: TargetedRecallFamily };

export function authorizeRestrictedRecall(
  input: Pick<ParsedGlobalRecallInput, "family" | "includeRestricted" | "query">,
): RestrictedRecallAuthorization {
  if (!input.includeRestricted || input.family === "all" || queryTokens(input.query).length < 2) {
    return { kind: "excluded", directlyRequested: false };
  }
  return { kind: "family_targeted", directlyRequested: true, family: input.family };
}

export function calendarEventMatches(event: CalendarEventSummary, query: string): boolean {
  const attendeeText = event.attendees
    .flatMap((attendee) => [attendee.displayName, attendee.email])
    .filter(Boolean)
    .join(" ");
  const searchable = [event.title, event.description, event.location, attendeeText]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return allQueryTokensMatch(searchable, query);
}

export function followupMatches(entry: ActiveFollowupSummary, query: string): boolean {
  const searchable =
    `${entry.person?.displayName ?? ""} ${entry.followup.reason}`.toLocaleLowerCase();
  return allQueryTokensMatch(searchable, query);
}

function allQueryTokensMatch(searchable: string, query: string): boolean {
  const tokens = queryTokens(query);
  return tokens.length > 0 && tokens.every((token) => searchable.includes(token));
}

function queryTokens(query: string): string[] {
  return query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}
