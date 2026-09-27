import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "rolldown/utils";

/**
 * The model-call entry point (spec #591, ADR 0246). It is the only module that
 * may build, wrap, or route to a provider model; every other hosted call takes
 * its model from `hostedModel` or `hostedEmbeddingModel`.
 */
export const ENTRY_POINT = "packages/db/src/queries/model-calls.ts";
const ENTRY_POINT_SPECIFIER = /(?:^|\/)model-calls$/;
const ENTRY_POINT_MODELS = new Set(["hostedModel", "hostedEmbeddingModel"]);

/** AI SDK exports that call a model. Each call must pass an entry-point model inline. */
const AI_SDK_MODEL_CALLERS = new Set([
  "embed",
  "embedMany",
  "generateObject",
  "generateText",
  "streamObject",
  "streamText",
]);

/**
 * AI SDK value exports that never reach a model. Anything else, including a
 * gateway, a provider registry, a model wrapper, or an agent class, belongs in
 * the entry point; add an export here only if it cannot call a model.
 */
const AI_SDK_HELPERS = new Set(["Output", "jsonSchema", "stepCountIs", "tool"]);

const MODEL_SDK_SPECIFIER = /^(?:ai|ai\/.+|@ai-sdk\/.+)$/;
/** The AI SDK's mock models, for test support; they cannot reach a provider. */
const AI_SDK_MOCKS = "ai/test";

/** TypeScript-only subtrees: a name there is a type position, not a reference. */
const TYPE_ONLY_NODES = new Set([
  "TSTypeAnnotation",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
]);

/**
 * Production source: what hosted Eve, the web app, and background jobs run.
 * Tests, evals, and local scripts are left out; they use mock models or drive
 * Eve itself.
 */
export function productionSourceFiles(root: string) {
  const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/src`);
  return ["apps/agent/agent", "apps/web/src", ...packages].flatMap((dir) => sourceFiles(root, dir));
}

function sourceFiles(root: string, dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "tests" ? [] : sourceFiles(root, path);
    }
    return /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

/** An ESTree node, read loosely; only the fields this check needs are named. */
type Node = { type: string } & Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";
const child = (node: Node, key: string) => (isNode(node[key]) ? (node[key] as Node) : undefined);
const children = (node: Node, key: string) => {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
};
const nameOf = (node: Node | undefined) => (node?.name ?? node?.value) as string | undefined;

/** Every node with its parent, skipping type-only subtrees and export-from lists. */
function* walk(node: Node, parent?: Node): Generator<[Node, Node | undefined]> {
  yield [node, parent];
  if (TYPE_ONLY_NODES.has(node.type) || (node.type === "ExportNamedDeclaration" && node.source)) {
    return;
  }
  for (const value of Object.values(node)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isNode(item)) yield* walk(item, node);
    }
  }
}

/** What a module imports, and the local names whose every use must be a checked call. */
type ModuleReach = {
  violations: string[];
  /** Local name of each model caller, to a description for violations. */
  callers: Map<string, string>;
  entryPointLocals: Set<string>;
  usesEntryPoint: boolean;
};
type ImportedName = { kind: string; imported: string; local: string };

/** An import or re-export's module, unless the whole statement is type-only. */
function valueSource(statement: Node) {
  if (statement.importKind === "type" || statement.exportKind === "type") return undefined;
  return nameOf(child(statement, "source"));
}

function importedNames(statement: Node): ImportedName[] {
  const reexport = statement.type !== "ImportDeclaration";
  return children(statement, "specifiers")
    .filter((specifier) => specifier.importKind !== "type" && specifier.exportKind !== "type")
    .map((specifier) => ({
      kind: specifier.type,
      imported: nameOf(child(specifier, reexport ? "local" : "imported")) ?? "default",
      local: nameOf(child(specifier, reexport ? "exported" : "local")) ?? "",
    }));
}

function readEntryPointImport(named: ImportedName[], reach: ModuleReach) {
  reach.usesEntryPoint = true;
  for (const { imported, local } of named) {
    if (ENTRY_POINT_MODELS.has(imported)) reach.entryPointLocals.add(local);
  }
}

function readEveImport(named: ImportedName[], reach: ModuleReach) {
  for (const { kind, imported, local } of named) {
    if (kind !== "ImportSpecifier") reach.violations.push('imports all of "eve"');
    if (imported === "defineAgent") reach.callers.set(local, "Eve's defineAgent");
  }
}

function readAiSdkImport(statement: Node, source: string, reach: ModuleReach) {
  const named = importedNames(statement);
  if (statement.type === "ExportAllDeclaration") {
    reach.violations.push(`re-exports all of "${source}"`);
  } else if (named.length && source !== "ai") {
    reach.violations.push(`imports "${source}"`);
  } else if (source === "ai") {
    const reexport = statement.type !== "ImportDeclaration";
    for (const name of named) readAiSdkName(name, reexport, reach);
  }
}

function readAiSdkName(
  { kind, imported, local }: ImportedName,
  reexport: boolean,
  reach: ModuleReach,
) {
  if (kind === "ImportNamespaceSpecifier") reach.violations.push('imports all of "ai"');
  else if (!reexport && AI_SDK_MODEL_CALLERS.has(imported)) {
    reach.callers.set(local, `the AI SDK's ${imported}`);
  } else if (!AI_SDK_HELPERS.has(imported)) {
    reach.violations.push(`${reexport ? "re-exports" : "imports"} ${imported} from "ai"`);
  }
}

function readImports(program: Node): ModuleReach {
  const reach: ModuleReach = {
    violations: [],
    callers: new Map(),
    entryPointLocals: new Set(),
    usesEntryPoint: false,
  };
  for (const statement of children(program, "body")) {
    const source = valueSource(statement);
    if (!source) continue;
    if (ENTRY_POINT_SPECIFIER.test(source)) readEntryPointImport(importedNames(statement), reach);
    else if (source === "eve") readEveImport(importedNames(statement), reach);
    else if (MODEL_SDK_SPECIFIER.test(source) && source !== AI_SDK_MOCKS) {
      readAiSdkImport(statement, source, reach);
    }
  }
  return reach;
}

/** A string literal's value, including a template literal with no substitutions. */
function staticString(node: Node | undefined) {
  if (node?.type !== "TemplateLiteral") return nameOf(node);
  const [quasi] = children(node, "quasis");
  return children(node, "expressions").length
    ? undefined
    : (quasi?.value as Node | undefined)?.cooked;
}

/** Whether a node is a dynamic `import()` or `require()` of a model SDK. */
function loadsModelSdk(node: Node) {
  const dynamic =
    node.type === "ImportExpression" ||
    (node.type === "CallExpression" && nameOf(child(node, "callee")) === "require");
  const specifier = child(node, "source") ?? children(node, "arguments")[0];
  const loaded = dynamic ? staticString(specifier) : "";
  return typeof loaded === "string" && MODEL_SDK_SPECIFIER.test(loaded) && loaded !== AI_SDK_MOCKS;
}

/** Whether an identifier names a binding, as opposed to a key, member, or import slot. */
function isReference(node: Node, parent: Node | undefined) {
  if (!parent) return true;
  const keyed = ["MemberExpression", "Property", "PropertyDefinition", "MethodDefinition"];
  const nonComputedKey =
    keyed.includes(parent.type) &&
    !parent.computed &&
    (parent.property === node || parent.key === node);
  return !nonComputedKey && !parent.type.startsWith("Import");
}

/**
 * Whether a call passes, as its options object, exactly one `model` whose value
 * is a one-argument entry-point call. A spread could override the model and a
 * second argument would inject another provider, so both fail.
 */
function takesEntryPointModel(call: Node, entryPointLocals: Set<string>) {
  const options = children(call, "arguments")[0];
  const models = children(options ?? call, "properties").filter(
    (property) =>
      property.type === "SpreadElement" ||
      (!property.computed && nameOf(child(property, "key")) === "model"),
  );
  const model = models.length === 1 ? child(models[0] as Node, "value") : undefined;
  return (
    options?.type === "ObjectExpression" &&
    model?.type === "CallExpression" &&
    entryPointLocals.has(nameOf(child(model, "callee")) ?? "") &&
    children(model, "arguments").length === 1
  );
}

/** The call or `new` expression a node is the callee of, if any. */
function callOf(node: Node, parent: Node | undefined) {
  const isCall = parent?.type === "CallExpression" || parent?.type === "NewExpression";
  return isCall && parent?.callee === node ? parent : undefined;
}

/** How a node uses a model caller: a checked call, a violation, or not at all. */
function callerUse(node: Node, parent: Node | undefined, reach: ModuleReach) {
  const caller = node.type === "Identifier" ? reach.callers.get(nameOf(node) ?? "") : undefined;
  if (!caller || !isReference(node, parent)) return undefined;
  const call = callOf(node, parent);
  if (!call) return `${caller} is used other than by calling it`;
  return takesEntryPointModel(call, reach.entryPointLocals)
    ? "checked"
    : `${caller} is called without \`model: hostedModel(...)\` inline`;
}

/**
 * Every way a module could reach a model without the entry point, the number
 * of model calls it checked, and whether it imports the entry point.
 */
export function modelCallViolations(file: string, source: string) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length) {
    return { violations: ["does not parse"], checkedCalls: 0, usesEntryPoint: false };
  }
  const program = parsed.program as unknown as Node;
  const reach = readImports(program);
  let checkedCalls = 0;
  for (const [node, parent] of walk(program)) {
    if (loadsModelSdk(node)) reach.violations.push("loads the AI SDK dynamically");
    const use = callerUse(node, parent, reach);
    if (use === "checked") checkedCalls++;
    else if (use) reach.violations.push(use);
  }
  return { violations: reach.violations, checkedCalls, usesEntryPoint: reach.usesEntryPoint };
}
