/**
 * The one allowed outbound diagnostic envelope (#641, ADR 0257): everything an
 * error report may carry to GlitchTip, and nothing else. A predefined error
 * code, sanitized stack locations, an operation name, and coarse runtime or
 * browser information; the release is stamped by the server that forwards it.
 *
 * Never an account, user, or session identifier, the raw message, console
 * output, a request body, a header, a URL, an IP address, a user-agent string,
 * or a breadcrumb. Every field is built from a closed set or rebuilt through an
 * allowlist, so an unexpected value is dropped rather than escaped.
 *
 * Pure and isomorphic: the browser sanitizes with it before anything leaves the
 * page, and the server validates the browser's report again with the same
 * sanitizers (`browser-report.ts`).
 */

/** Error codes a report may carry, derived from the error's built-in kind, never its message. */
export const DIAGNOSTIC_ERROR_CODES = [
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "ChunkLoadError",
  "NonError",
  "UnknownError",
] as const;

export type DiagnosticErrorCode = (typeof DIAGNOSTIC_ERROR_CODES)[number];

/** Where a browser report was captured. The browser cannot name any other operation. */
export const BROWSER_OPERATIONS = [
  "error_boundary",
  "window_error",
  "unhandled_rejection",
] as const;

export type BrowserOperation = (typeof BROWSER_OPERATIONS)[number];

export const BROWSER_NAMES = ["chrome", "edge", "firefox", "safari", "other"] as const;

export type BrowserName = (typeof BROWSER_NAMES)[number];

/** A browser family and major version: coarse enough to group by, never the user-agent string. */
export type CoarseRuntime = { name: BrowserName | "node"; major: number | null };

/** One sanitized stack location. */
export type DiagnosticFrame = { file: string; function: string; line: number; column: number };

/** What the browser posts to Tendnote, already sanitized. */
export type BrowserDiagnostic = {
  code: DiagnosticErrorCode;
  operation: BrowserOperation;
  frames: DiagnosticFrame[];
  browser: CoarseRuntime & { name: BrowserName };
};

/** A validated report, from either side, ready to forward. */
export type DiagnosticEnvelope = {
  platform: "javascript" | "node";
  code: DiagnosticErrorCode;
  operation: string;
  frames: DiagnosticFrame[];
  runtime: CoarseRuntime;
};

export const MAX_FRAMES = 30;
export const MAX_POSITION = 10_000_000;
const UNKNOWN_FILE = "<unknown>";
const UNKNOWN_FUNCTION = "?";

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** The predefined code for a thrown value: its built-in kind, or a catch-all. */
export function diagnosticErrorCode(error: unknown): DiagnosticErrorCode {
  if (!(error instanceof Error)) return "NonError";
  return isOneOf(DIAGNOSTIC_ERROR_CODES, error.name) ? error.name : "UnknownError";
}

/*
 * A stack file survives only as a path inside code Tendnote ships or depends
 * on: a browser chunk under `/_next/`, a server chunk under `.next/`, a
 * dependency under its innermost `node_modules/` (past pnpm's versioned store
 * directory), or a Node built-in. Everything before the anchor (an origin, a
 * deployment's directory, a home directory) is cut, a query or hash is cut, and
 * whatever is left must be plain path characters. Anything else, a page URL or
 * an extension script among them, is `<unknown>`.
 */
const FILE_ANCHORS = [
  ["/_next/", "first"],
  [".next/", "first"],
  ["node_modules/", "last"],
] as const;
const SAFE_PATH = /^[A-Za-z0-9_.\-/[\]()]{1,200}$/;
const NODE_BUILTIN = /^node:[a-z_/]{1,60}$/;

export function sanitizeStackFile(raw: string): string {
  if (NODE_BUILTIN.test(raw)) return raw;
  const path = raw.split(/[?#]/, 1)[0] ?? "";
  for (const [anchor, occurrence] of FILE_ANCHORS) {
    const at = occurrence === "first" ? path.indexOf(anchor) : path.lastIndexOf(anchor);
    if (at === -1) continue;
    const kept = path.slice(at);
    return SAFE_PATH.test(kept) ? kept : UNKNOWN_FILE;
  }
  return UNKNOWN_FILE;
}

/** A dotted identifier path, like `Object.<anonymous>` or `PersonCard.render`; anything else is `?`. */
const SAFE_FUNCTION =
  /^(?:[A-Za-z_$][\w$]*|<anonymous>)(?:\.(?:[A-Za-z_$][\w$]*|<anonymous>)){0,4}$/;

export function sanitizeStackFunction(raw: string | undefined): string {
  const name = (raw ?? "").replace(/^(?:async |new )+/, "").trim();
  return name.length <= 120 && SAFE_FUNCTION.test(name) ? name : UNKNOWN_FUNCTION;
}

function position(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_POSITION
    ? (value as number)
    : null;
}

function frame(file: string, fn: string | undefined, line: unknown, column: unknown) {
  const lineNumber = position(line);
  const columnNumber = position(column);
  if (lineNumber === null || columnNumber === null) return null;
  return {
    file: sanitizeStackFile(file),
    function: sanitizeStackFunction(fn),
    line: lineNumber,
    column: columnNumber,
  };
}

// V8: `    at fn (file:1:2)` or `    at file:1:2`. Gecko and WebKit: `fn@file:1:2`.
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^\s*([^@\s]*)@(.+?):(\d+):(\d+)$/;

/**
 * The sanitized locations of an error's stack, innermost first. The message is
 * never parsed, because a message can contain lines shaped like frames.
 *
 * Gecko and WebKit stacks hold no message: they start at the first frame. V8
 * stacks start with `name: message`, which may span lines, so exactly that
 * header is cut and only V8 frames are read after it. V8 writes the stack
 * once, so if the error's name or message changed afterwards the stack no
 * longer starts with the header, where the message ends is unknown, and no
 * frame is trusted.
 */
export function sanitizeStack(error: unknown): DiagnosticFrame[] {
  if (!(error instanceof Error) || typeof error.stack !== "string") return [];
  const { stack, message } = error;

  if (GECKO_FRAME.test(stack.split("\n", 1)[0] ?? "")) {
    return message && stack.includes(message) ? [] : parseFrameLines(stack, GECKO_FRAME);
  }
  const header = message ? `${error.name}: ${message}` : error.name;
  return stack.startsWith(header) ? parseFrameLines(stack.slice(header.length), V8_FRAME) : [];
}

function parseFrameLines(stack: string, pattern: RegExp): DiagnosticFrame[] {
  const frames: DiagnosticFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = pattern.exec(line);
    if (!match) continue;
    const parsed = frame(match[2] ?? "", match[1], match[3], match[4]);
    if (parsed) frames.push(parsed);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
}

const MAJOR = "(\\d{1,3})";
const BROWSER_PATTERNS: readonly [BrowserName, RegExp][] = [
  ["edge", new RegExp(`Edg(?:e|A|iOS)?/${MAJOR}`)],
  ["firefox", new RegExp(`(?:Firefox|FxiOS)/${MAJOR}`)],
  ["chrome", new RegExp(`(?:Chrome|CriOS)/${MAJOR}`)],
  ["safari", new RegExp(`Version/${MAJOR}[\\d.]* (?:Mobile/\\S+ )?Safari/`)],
];

/** The browser family and major version a user-agent string names. The string itself goes nowhere. */
export function coarseBrowser(userAgent: string): CoarseRuntime & { name: BrowserName } {
  for (const [name, pattern] of BROWSER_PATTERNS) {
    const match = pattern.exec(userAgent);
    if (match) return { name, major: Number(match[1]) };
  }
  return { name: "other", major: null };
}

const SERVER_ROUTE_TYPES = ["render", "route", "action", "proxy"] as const;

/** The two fields of Next's `onRequestError` context an operation name is built from. */
export type ServerRouteContext = { routeType?: unknown; routePath?: unknown };
const SAFE_ROUTE_PATH = /^\/[A-Za-z0-9_.\-/[\]()@]{0,200}$/;

/**
 * The operation name for a server error: Next's route type and the route's
 * file path, such as `render /(member)/people/[personId]/page`. That is the
 * route's pattern from the build, never the request's path, so it carries no
 * record identifier or query.
 */
export function serverOperation(context: ServerRouteContext): string {
  const type = isOneOf(SERVER_ROUTE_TYPES, context.routeType) ? context.routeType : "unknown";
  const path =
    typeof context.routePath === "string" && SAFE_ROUTE_PATH.test(context.routePath)
      ? context.routePath
      : "<unknown route>";
  return `${type} ${path}`;
}

export function browserEnvelope(report: BrowserDiagnostic): DiagnosticEnvelope {
  return {
    platform: "javascript",
    code: report.code,
    operation: `browser ${report.operation}`,
    frames: report.frames,
    runtime: report.browser,
  };
}

export function serverEnvelope(
  error: unknown,
  context: ServerRouteContext,
  nodeVersion: string,
): DiagnosticEnvelope {
  const major = Number.parseInt(nodeVersion, 10);
  return {
    platform: "node",
    code: diagnosticErrorCode(error),
    operation: serverOperation(context),
    frames: sanitizeStack(error),
    runtime: { name: "node", major: Number.isInteger(major) && major <= 999 ? major : null },
  };
}
