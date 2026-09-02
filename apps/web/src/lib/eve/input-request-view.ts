import type { EveDynamicToolPart, EveMessageInputRequest, EveMessagePart } from "eve/react";

/**
 * Projection of Eve's human-in-the-loop input requests — the tool calls that park
 * mid-turn waiting for the owner to answer.
 *
 * A gated tool call is *one* message part that walks through several states
 * (`input-streaming` → `approval-requested` → `approval-responded` → a terminal
 * `output-*`), because the default reducer keys parts by `toolCallId`. So a call is
 * never both a pending request and a result, and the turn renderer can project each
 * part into exactly one unit without double-rendering (see `messageTurnUnits`).
 *
 * **What the owner actually gets to judge (eve 0.47.7).** For `kind: "tool-approval"`
 * the framework authors the whole request itself: `prompt` is the fixed string
 * `"Approve tool call: <toolName>"`, `display` is `"confirmation"`, `allowFreeform` is
 * false, and the options are exactly `approve` / "Approve" and `cancel` / "Cancel" with
 * no style hint (`dist/src/harness/input-extraction.js`, `extractApprovalRequests`). A
 * tool's approval policy cannot supply a reason - `ApprovalStatus` types
 * `user-approval`'s `reason` as `never` - and the client projection
 * (`EveMessageInputRequest`) carries no tool input at all.
 *
 * So the *only* description of the pending action is the frozen tool call itself, which
 * the default reducer copies onto the part: `part.toolName` and `part.input` (from the
 * request's `action.toolName` / `action.input`), keyed by `part.toolCallId` (the
 * request's `action.callId`). That is what {@link approvalInputFields} renders, and it
 * is why nothing downstream may read meaning out of `prompt` for an approval.
 *
 * `kind: "question"` is the opposite case: there `prompt` and `options` come from the
 * model's own `ask_question` input, so the prompt is the whole point.
 *
 * Option ids and labels always travel on the request. Nothing here invents one: the
 * answer the client posts back is the id eve asked for, so a UI that drifted from the
 * framework's option set could not silently approve the wrong thing.
 */

/** One selectable answer Eve offered for a parked request. */
export type AssistantInputOption = {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  /** Eve's own emphasis hint; the card maps it to a button variant, never to meaning. */
  readonly style: "danger" | "default" | "primary";
};

/** Which framework channel parked the turn (`tool-approval`, `question`, …). */
export type AssistantInputRequestKind = EveMessageInputRequest["kind"];

/** How the answer is collected: a two-way confirm, a list of choices, or free text. */
export type AssistantInputDisplay = NonNullable<EveMessageInputRequest["display"]>;

/**
 * One line of the frozen tool input, rendered for a human.
 *
 * `key` is the tool's own parameter name (`url`, `personId`, `content`) and is null when
 * the input is not an object - a bare string or array argument still has to be shown.
 * `value` is already flattened to text, so the card renders strings rather than
 * re-deciding how to display an arbitrary payload.
 */
export type AssistantInputField = {
  readonly key: string | null;
  readonly value: string;
  /** True when the value is JSON or spans lines, so the card gives it its own block. */
  readonly block: boolean;
};

/** A parked request waiting on the owner, ready to render as an action card. */
export type AssistantInputRequestView = {
  /** The id the client echoes back in its input response; Eve keys the answer on it. */
  readonly requestId: string;
  /** The parked call's own identity — the React key and the part's identity. */
  readonly toolCallId: string;
  readonly toolName: string;
  readonly kind: AssistantInputRequestKind;
  /**
   * The request's prompt, exactly as eve sent it — and for an approval that is *not*
   * a description of the action.
   *
   * eve authors it itself as the fixed string `"Approve tool call: <toolName>"`; an
   * approval policy cannot influence it (`ApprovalStatus` types `user-approval`'s
   * `reason` as `never`). So for `kind: "tool-approval"` this must never be rendered
   * as the description of what is about to happen — the frozen {@link fields} /
   * {@link input} are. It is only meaningful for `kind: "question"`, where the words
   * are the model's own `ask_question` text.
   */
  readonly prompt: string;
  readonly display: AssistantInputDisplay;
  /** Whether a typed answer is accepted alongside the options. */
  readonly allowFreeform: boolean;
  readonly options: readonly AssistantInputOption[];
  /**
   * The frozen tool input, flattened for display. For a `tool-approval` this is the
   * entire description of what will happen: the framework's prompt names only the tool.
   */
  readonly fields: readonly AssistantInputField[];
  /**
   * The same input unflattened, for the owner-scoped subject lookup.
   *
   * The server needs the argument the call is actually keyed on (`{ followupId }`),
   * not its rendering, and it must be the *same* value the card displays: a summary
   * described from one input beside arguments taken from another would be exactly
   * the mismatch this gate exists to prevent.
   */
  readonly input: unknown;
};

/**
 * How a parked request ended.
 *
 * `answered` is the in-between: the owner's response is on its way and Eve has not
 * settled the call yet, so the card echoes the option they picked rather than
 * guessing which way it will land. `approved` and `declined` are Eve's verdicts, and
 * `failed` means the owner said yes and the tool then failed.
 */
export type AssistantInputOutcome = "answered" | "approved" | "declined" | "failed";

/** A settled request, rendered as a quiet status in the slot the card occupied. */
export type AssistantInputResolutionView = {
  readonly toolCallId: string;
  readonly requestId: string;
  readonly toolName: string;
  readonly kind: AssistantInputRequestKind;
  /**
   * eve's own prompt, carrying the same trap as
   * {@link AssistantInputRequestView.prompt}: for an approval it is the framework's
   * fixed `"Approve tool call: <toolName>"` and says nothing about the action, so
   * only a `question` may render it.
   */
  readonly prompt: string;
  readonly outcome: AssistantInputOutcome;
  /** The frozen tool input, so the settled line can still say which call this was. */
  readonly fields: readonly AssistantInputField[];
  /** The option label the owner picked, or their typed answer, when Eve recorded one. */
  readonly answerLabel: string | null;
  /** Eve's own words for a denial or failure. Never composed here. */
  readonly detail: string | null;
};

const DEFAULT_OPTION_STYLE = "default" as const;

/**
 * How much of one value survives into the DOM. A tool input is model-authored and
 * unbounded (a pasted note, a long body), and the card is a decision, not a document
 * viewer; the cap keeps a runaway payload out of the transcript. It is generous enough
 * that every realistic argument - a URL, a memory, a draft paragraph - arrives whole.
 */
const FIELD_VALUE_MAX_LENGTH = 2000;

/** Flattens one argument to text. Objects and arrays keep their shape as JSON. */
function formatFieldValue(value: unknown): { text: string; block: boolean } {
  if (typeof value === "string") {
    return { text: value, block: value.includes("\n") };
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return { text: String(value), block: false };
  }
  try {
    return { text: JSON.stringify(value, null, 2) ?? String(value), block: true };
  } catch {
    // A cyclic or otherwise unserializable argument is still a fact about the call, so
    // the field stays and says what it can rather than disappearing from the decision.
    return { text: "(unreadable value)", block: false };
  }
}

function toField(key: string | null, value: unknown): AssistantInputField {
  const { text, block } = formatFieldValue(value);
  const capped =
    text.length > FIELD_VALUE_MAX_LENGTH ? `${text.slice(0, FIELD_VALUE_MAX_LENGTH)}…` : text;
  return { key, value: capped, block: block || capped.length > 120 };
}

/**
 * The frozen tool input, flattened into displayable lines.
 *
 * This is the whole substance of an approval card: eve's approval prompt names only the
 * tool, so what the owner is actually authorizing - which URL, which record, what text -
 * exists only here. An object becomes one line per argument, keyed by the tool's own
 * parameter name; anything else becomes a single unkeyed line, because a bare argument
 * still has to be shown rather than silently dropped.
 */
export function approvalInputFields(input: unknown): AssistantInputField[] {
  if (input === undefined || input === null) {
    return [];
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return [toField(null, input)];
  }

  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => toField(key, value));
}

function isToolPart(part: EveMessagePart): part is EveDynamicToolPart {
  return part.type === "dynamic-tool";
}

/** The HITL prompt Eve attached to this call, if it ever parked for the owner. */
function partInputRequest(part: EveDynamicToolPart): EveMessageInputRequest | undefined {
  return part.toolMetadata?.eve?.inputRequest;
}

function toOptions(request: EveMessageInputRequest): AssistantInputOption[] {
  return (request.options ?? []).map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description ?? null,
    style: option.style ?? DEFAULT_OPTION_STYLE,
  }));
}

/**
 * The control this request should render with. Eve states it explicitly for the
 * requests it authors; the fallback reads the request rather than the tool, so a
 * question with choices still gets a choice control and a bare prompt gets a field.
 */
function toDisplay(
  request: EveMessageInputRequest,
  options: readonly AssistantInputOption[],
): AssistantInputDisplay {
  if (request.display) {
    return request.display;
  }
  if (request.kind === "tool-approval") {
    return "confirmation";
  }
  return options.length > 0 ? "select" : "text";
}

/**
 * The pending request on a tool call, or `null` when the call is not parked.
 *
 * A `question` with no prompt has nothing to ask, so it projects to nothing; an
 * approval never hits that guard, because the framework always supplies its own
 * prompt and the substance lives in {@link AssistantInputRequestView.fields} anyway.
 */
export function toInputRequestView(part: EveMessagePart): AssistantInputRequestView | null {
  if (!isToolPart(part) || part.state !== "approval-requested") {
    return null;
  }

  const request = partInputRequest(part);
  if (!request) {
    return null;
  }
  if (request.kind !== "tool-approval" && request.prompt.trim().length === 0) {
    return null;
  }

  const options = toOptions(request);
  return {
    requestId: request.requestId,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    kind: request.kind,
    prompt: request.prompt,
    display: toDisplay(request, options),
    allowFreeform: request.allowFreeform ?? false,
    options,
    fields: approvalInputFields(part.input),
    input: part.input,
  };
}

/** The label for whatever the owner sent back, when Eve recorded a response. */
function answerLabelFor(part: EveDynamicToolPart, request: EveMessageInputRequest): string | null {
  const response = part.toolMetadata?.eve?.inputResponse;
  if (!response) {
    return null;
  }

  const picked = request.options?.find((option) => option.id === response.optionId);
  return picked?.label ?? response.text ?? null;
}

/**
 * How a parked request ended, or `null` when this call never parked for the owner.
 *
 * The gate is deliberately `inputRequest`, not the state: a tool that was denied or
 * that failed without ever being shown to the owner keeps its existing silent
 * treatment (the model receives the reason and explains it in its own words). What
 * this adds is narrower and is the whole point of the approval gate — *a call the
 * owner was asked about never ends silently*.
 *
 * An automatic approval is not an answer the owner gave, so it projects to nothing.
 */
export function toInputResolutionView(part: EveMessagePart): AssistantInputResolutionView | null {
  if (!isToolPart(part)) {
    return null;
  }

  const request = partInputRequest(part);
  if (!request) {
    return null;
  }

  const outcome = resolvedOutcome(part);
  if (!outcome) {
    return null;
  }

  return {
    toolCallId: part.toolCallId,
    requestId: part.approval?.id ?? request.requestId,
    toolName: part.toolName,
    kind: request.kind,
    prompt: request.prompt,
    outcome,
    fields: approvalInputFields(part.input),
    answerLabel: answerLabelFor(part, request),
    detail: resolvedDetail(part),
  };
}

function resolvedOutcome(part: EveDynamicToolPart): AssistantInputOutcome | null {
  if (part.approval?.isAutomatic) {
    return null;
  }

  switch (part.state) {
    case "approval-responded":
      // The reducer sets `approved` only once the server settles the request; the
      // client's own optimistic projection leaves it undefined, so an unsettled
      // response stays `answered` rather than claiming a verdict Eve has not given.
      return part.approval.approved === true ? "approved" : "answered";
    case "output-denied":
      return "declined";
    case "output-error":
      return "failed";
    default:
      return null;
  }
}

/** Eve's stated reason, kept verbatim; the empty string is treated as absent. */
function resolvedDetail(part: EveDynamicToolPart): string | null {
  const raw =
    part.state === "output-error"
      ? part.errorText
      : part.state === "output-denied"
        ? part.approval.reason
        : undefined;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
