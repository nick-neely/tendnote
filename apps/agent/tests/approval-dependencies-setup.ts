import { beforeEach } from "vitest";
import {
  resetApprovalPolicyDependencies,
  setApprovalPolicyDependencies,
} from "../agent/lib/approval/dependencies";

/**
 * No unit test reaches a database.
 *
 * The approval policy now reads the owner's Approval Mode, any Session Tool
 * Trust, and writes an approval decision record on every gated call. In
 * production those are `@tendnote/db` queries; left installed under vitest they
 * would open a Postgres connection from ~40 tool files' approval assertions, and
 * the answer every one of them got would depend on whether a local database
 * happened to be running.
 *
 * So this setup file installs the same defaults the production code falls back
 * to when a read fails - Approval Mode `ask`, no Session Tool Trust, an audit
 * write that does nothing - for every test file. A test that cares about a
 * different posture calls `setApprovalPolicyDependencies` itself; the
 * `beforeEach` here puts these back first, so one file's override cannot leak
 * into the next test.
 */
beforeEach(() => {
  resetApprovalPolicyDependencies();
  setApprovalPolicyDependencies({
    readApprovalMode: async () => "ask",
    readSessionToolTrust: async () => false,
    recordApprovalDecision: async () => ({ recorded: true }),
  });
});
