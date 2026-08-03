import type { ContextFact } from "@tendnote/domain";

export function callerScopedSubjectFilter(subject: ContextFact["subject"], callerUserId: string) {
  return subject.kind === "self"
    ? { subjectUserId: subject.userId }
    : {
        householdIds: [subject.householdId],
        activeHouseholdMemberUserId: callerUserId,
      };
}

export function sameInstant(left: Date | undefined, right: Date | null): boolean {
  return left !== undefined && right !== null && left.getTime() === right.getTime();
}
