import type {
  ConversationalCaptureRequestedScope,
  ConversationalCaptureVisibility,
} from "@tendnote/domain";
import type { CaptureVisibility } from "./types";

type HouseholdMembership = { householdId: string };
type ShareableMember = {
  householdId: string;
  userId: string;
  name: string | null;
  email: string;
};

const HOUSEHOLD_AUDIENCE = /\s+(?:and\s+)?share(?:\s+this)?\s+with\s+(?:my\s+)?household[.!]?$/i;
const MEMBER_AUDIENCE = /\s+(?:and\s+)?share(?:\s+this)?\s+with\s+([^.;]+)[.!]?$/i;

export function createCaptureVisibilityResolver(deps: {
  listMemberships: (input: { userId: string }) => Promise<HouseholdMembership[]>;
  listMembers: (input: { userId: string }) => Promise<ShareableMember[]>;
}) {
  return async function resolveCaptureVisibility(input: {
    ownerUserId: string;
    originalText: string;
    contextVisibility?: ConversationalCaptureVisibility;
    requestedScope?: ConversationalCaptureRequestedScope;
  }): Promise<CaptureVisibility> {
    /**
     * A deliberate scope choice outranks everything the text says.
     *
     * It runs first because it is the only signal that is actually a decision. The
     * suffix patterns below read an audience out of the caller's own sentence,
     * which is fine when that sentence *is* the instruction and wrong the moment
     * a control exists — a member who turned the household scope on and then
     * typed "share with my household" must not have their words re-parsed into a
     * second, possibly different, answer.
     *
     * The household is read from this caller's own active memberships, never from
     * the request. There is no argument shape here that can name a workspace.
     */
    if (input.requestedScope === "household") {
      const memberships = await deps.listMemberships({ userId: input.ownerUserId });
      const householdId = memberships[0]?.householdId;
      // Fail closed rather than falling back to private: a member who chose to
      // share and then silently did not would learn about it too late.
      if (!householdId) throw new Error("A household audience requires an active household.");
      return {
        scope: "household",
        householdId,
        selectedUserIds: [],
        label: "Household",
        captureText: input.originalText,
      };
    }
    if (input.requestedScope === "private") {
      return {
        scope: "private",
        householdId: null,
        selectedUserIds: [],
        label: "Only me",
        captureText: input.originalText,
      };
    }

    const householdMatch = input.originalText.match(HOUSEHOLD_AUDIENCE);
    if (householdMatch) {
      const memberships = await deps.listMemberships({ userId: input.ownerUserId });
      const householdId = memberships[0]?.householdId;
      if (!householdId) throw new Error("A household audience requires an active household.");
      return {
        scope: "household",
        householdId,
        selectedUserIds: [],
        label: "Household",
        captureText: stripAudience(input.originalText, householdMatch[0]),
      };
    }

    const memberMatch = input.originalText.match(MEMBER_AUDIENCE);
    const audience = memberMatch?.[1]?.trim();
    if (memberMatch && audience) {
      const normalized = audience.toLocaleLowerCase();
      const members = (await deps.listMembers({ userId: input.ownerUserId })).filter(
        (member) =>
          member.name?.trim().toLocaleLowerCase() === normalized ||
          member.email.trim().toLocaleLowerCase() === normalized,
      );
      if (members.length !== 1) {
        throw new Error(
          members.length === 0
            ? `No active household member matches ${audience}.`
            : `More than one household member matches ${audience}.`,
        );
      }
      const member = members[0];
      if (!member) throw new Error("The selected household member is unavailable.");
      return {
        scope: "shared",
        householdId: member.householdId,
        selectedUserIds: [member.userId],
        label: member.name?.trim() || member.email,
        captureText: stripAudience(input.originalText, memberMatch[0]),
      };
    }

    return fromContext(input.originalText, input.contextVisibility);
  };
}

function fromContext(
  originalText: string,
  context?: ConversationalCaptureVisibility,
): CaptureVisibility {
  if (!context || context.scope === "private") {
    return {
      scope: "private",
      householdId: null,
      selectedUserIds: [],
      label: "Only me",
      captureText: originalText,
    };
  }
  if (context.scope === "household") {
    return {
      scope: "household",
      householdId: context.householdId,
      selectedUserIds: [],
      label: context.label,
      captureText: originalText,
    };
  }
  return {
    scope: "shared",
    householdId: context.householdId,
    selectedUserIds: [...new Set(context.selectedUserIds)],
    label: context.label,
    captureText: originalText,
  };
}

function stripAudience(originalText: string, suffix: string) {
  const captureText = originalText
    .slice(0, -suffix.length)
    .trim()
    .replace(/[;,]\s*$/, "");
  if (!captureText) throw new Error("Capture text is required before a shared audience.");
  return captureText;
}
