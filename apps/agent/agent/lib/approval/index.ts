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
 * resource, and action - without a new table (ADR-0014), and sharing the one
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
 * ## Declaring a Reversible Private Write
 *
 * A write that is owner-scoped, private by construction, and undoable may say so,
 * and an owner whose Approval Mode is `trusted` gets it without a click - unless
 * the conversation has become a Tainted Conversation, in which case everything
 * asks again (ADR-0240):
 *
 * ```ts
 * approval: requireOwnerApproval<Input>({ reversiblePrivateWrite: true }),
 * // or, when the tier depends on the arguments:
 * approval: requireOwnerApproval<Input>({
 *   reversiblePrivateWrite: (input) => input?.requestedScope === undefined,
 * }),
 * ```
 *
 * Omitting it means always-ask. `tests/write-tool-approval.test.ts` enforces the
 * rule behind the declaration, so this is a claim the test checks rather than a
 * list somebody maintains.
 *
 * ## What the tool sees
 *
 * Nothing new. `execute` runs unchanged after an approval, and never runs at
 * all after a denial or a decline - eve settles the call itself and the model
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
 * The dependency seam (`./dependencies`). Installing the query layer at startup
 * and replacing it in a test are the business of the startup hook and the test
 * setup, never of a gated tool, so the handful of modules that do either import
 * it by path instead.
 *
 * `describeRegisteredSubject` (`./subject-registry`) reaches the shared
 * approval-subject registry. Re-exporting it here would put a registry lookup in
 * front of every tool that only wants the policy, so the id-referenced writes
 * import it by name from its own module and the rest never see it.
 *
 * It is also still a statement about bundles. ADR-0240 has the policy read the
 * owner's Approval Mode from the database on every gated call, which would have
 * put `@tendnote/db` behind this barrel for every tool that imports it -
 * `web_fetch` included, whose whole chunk is otherwise a fetch. It does not:
 * `./dependencies` is a seam with no runtime import at all, and the queries in
 * `./dependencies-production` reach the policy either through the registration
 * an eve-loaded hook performs at startup or through a lazy import behind the
 * first decision that needs one.
 */

export { APPROVAL_APPROVE_OPTION_ID, APPROVAL_REQUEST_KIND, OPAQUE_DENIAL } from "./contract";
export {
  type OwnerApprovalSpec,
  requireOwnerApproval,
  requireRestrictedRevealApproval,
} from "./policy";
