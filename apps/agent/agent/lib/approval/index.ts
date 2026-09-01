/**
 * Owner approval: the seam every gated Eve tool imports.
 *
 * ## The problem
 *
 * Until this module existed, every durable write, external egress, and
 * restricted-context read Eve performed was authorised by one of two things: a
 * sentence in the system prompt, or a boolean the model itself supplied
 * (`includeRestricted`, `acceptedProposal`, `requestedScope`). Both are text a
 * prompt injection can mint — a pasted email, a fetched page, a household
 * member's note. Neither is a decision by the person who owns the records.
 *
 * ## The mechanism
 *
 * `defineTool({ approval })` is eve's own human-in-the-loop primitive. A policy
 * returning `"user-approval"` parks *that exact call*, with its input frozen and
 * its `callId` recorded, durably at `session.waiting` until the authenticated
 * owner answers through the client (`useEveAgent().respond`). The answer never
 * passes through the model, so it is a real capability bound to owner, turn,
 * resource, and action — without a new table (ADR-0014), and sharing the one
 * approval artifact the web surface uses (ADR-0092).
 *
 * ```ts
 * import { requireOwnerApproval } from "../lib/approval";
 *
 * export default defineTool({
 *   description: "...",
 *   inputSchema,
 *   approval: requireOwnerApproval(),
 *   async execute(input, ctx) { ... },
 * });
 * ```
 *
 * For a tool that only widens authority when the model sets a flag, gate the
 * flag rather than the tool. The restricted-reveal spellings have their own
 * one-line form, so the predicate is written once rather than per tool:
 *
 * ```ts
 * approval: requireRestrictedRevealApproval<Input>(),
 * ```
 *
 * And for a tool that names a record by id, resolve it first so a foreign id is
 * denied opaquely instead of parking. The lookup lives in the shared registry
 * (`@tendnote/db/queries/approval-subjects`), which the web approval card reads
 * too, so a record is described once for both surfaces:
 *
 * ```ts
 * import { describeRegisteredSubject } from "../lib/approval/subject-registry";
 *
 * approval: requireOwnerApproval<Input>({ describe: describeRegisteredSubject() }),
 * ```
 *
 * ## What the tool sees
 *
 * Nothing new. `execute` runs unchanged after an approval, and never runs at
 * all after a denial or a decline — eve settles the call itself and the model
 * receives a `tool-output-denied` result. There is no approval argument to
 * thread, and nothing for the model to assert.
 *
 * ## Two framework limits worth knowing (eve 0.47.7, verified)
 *
 * - The approval prompt is fixed (`Approve tool call: <name>`) and a policy
 *   cannot author one; what the approver judges is the frozen tool input on the
 *   same request. See `contract.ts`.
 * - Omitting `approval` means `never()`. A new write tool without this gate is
 *   silently ungated, which is why the gate belongs on the tool rather than in
 *   a registry someone has to remember to update.
 *
 * ## What this barrel deliberately does not export
 *
 * The subject types (`./subject`). They describe how a resolver is written, not
 * how the gate is used, so the two modules that implement one import them by
 * path and every tool sees the policy alone.
 *
 * `describeRegisteredSubject` (`./subject-registry`) reaches the shared
 * approval-subject registry, and that registry imports the whole
 * `@tendnote/db` query layer. Re-exporting it here would drag those modules
 * into every tool that only wants the policy - `web_fetch` has no store at all -
 * so the id-referenced writes import it by name from its own module.
 */

export { APPROVAL_APPROVE_OPTION_ID, APPROVAL_REQUEST_KIND, OPAQUE_DENIAL } from "./contract";
export {
  type OwnerApprovalSpec,
  requireOwnerApproval,
  requireRestrictedRevealApproval,
} from "./policy";
