import "server-only";

import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import {
  AssetValidationError,
  ContextFactConflictError,
  ContextFactValidationError,
  GeneralActionValidationError,
  GiftPlanConflictError,
  GiftPlanValidationError,
  HouseholdRecordUnavailableError,
  HouseholdValidationError,
  PersonReferenceValidationError,
  RelationshipShareValidationError,
  SavedItemValidationError,
} from "@tendnote/domain";
import type { VisibilityChoice } from "@tendnote/domain/privacy";
import { ZodError } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { reconcileAffectedScopes } from "@/lib/cache/reconcile-affected-scopes";
import type { OwnerActionResult } from "@/lib/owner-action-result";
import { enforceProductBudget, ProductRateLimitError } from "@/lib/rate-limit/guards";
import type { RateLimitRequest } from "@/lib/rate-limit/types";
import { resolveScopeForCaller } from "@/lib/resolve-scope-for-caller";

export type { OwnerActionResult } from "@/lib/owner-action-result";

type ResolvedOwnerScope = Awaited<ReturnType<typeof resolveScopeForCaller>>;

type InputSchema<TInput> = {
  parse(input: unknown): TInput;
};

type OwnerActionDependencies = {
  gate: () => Promise<string>;
  resolveScope: typeof resolveScopeForCaller;
  enforceBudget: (request: RateLimitRequest) => Promise<unknown>;
  reconcile: (scopes: readonly AffectedScope[]) => void;
};

type OwnerActionInput<TInput, TEntity, TView> = {
  schema: InputSchema<TInput>;
  input: unknown;
  visibilityChoice?: (input: TInput) => VisibilityChoice | undefined;
  budget?: Omit<RateLimitRequest, "subject">;
  body: (context: {
    ownerUserId: string;
    input: TInput;
    resolvedScope: ResolvedOwnerScope | null;
  }) => Promise<TEntity>;
  affectedScopes?: (entity: TEntity, ownerUserId: string) => readonly AffectedScope[];
  result: (entity: TEntity, ownerUserId: string) => TView | Promise<TView>;
};

function userSafeErrorMessage(error: unknown): string | null {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Check the highlighted fields and try again.";
  }
  if (
    error instanceof GeneralActionValidationError ||
    error instanceof AssetValidationError ||
    error instanceof SavedItemValidationError ||
    error instanceof ContextFactValidationError ||
    error instanceof GiftPlanValidationError ||
    error instanceof HouseholdValidationError ||
    error instanceof RelationshipShareValidationError ||
    error instanceof PersonReferenceValidationError ||
    error instanceof ProductRateLimitError
  ) {
    return error.message;
  }
  /**
   * The one opaque household refusal. It is rendered rather than rethrown so the
   * surface settles quietly instead of erroring, and its message is deliberately
   * the same sentence whether the record is gone, was never shared, or is a
   * surprise being kept from the person asking. Rendering it verbatim discloses
   * nothing while still telling the owner that their press landed somewhere and
   * changed nothing (ADR 0219).
   */
  if (error instanceof HouseholdRecordUnavailableError) {
    return error.message;
  }
  return null;
}

/**
 * Creates the one owner-mutation protocol: admission precedes parsing, then
 * optional scope and budget resolution, mutation, cache reconciliation, and view
 * mapping. Curated validation failures are data; admission and infrastructure
 * failures still reject.
 */
export function createOwnerActionRunner(dependencies: OwnerActionDependencies) {
  return async function runOwnerAction<TInput, TEntity, TView>(
    action: OwnerActionInput<TInput, TEntity, TView>,
  ): Promise<OwnerActionResult<Awaited<TView>>> {
    try {
      const ownerUserId = await dependencies.gate();
      const input = action.schema.parse(action.input);
      const visibilityChoice = action.visibilityChoice?.(input);
      const resolvedScope =
        visibilityChoice === undefined
          ? null
          : await dependencies.resolveScope(ownerUserId, visibilityChoice);

      if (action.budget) {
        await dependencies.enforceBudget({ ...action.budget, subject: ownerUserId });
      }

      const entity = await action.body({ ownerUserId, input, resolvedScope });
      dependencies.reconcile(action.affectedScopes?.(entity, ownerUserId) ?? []);
      return { ok: true, view: await action.result(entity, ownerUserId) };
    } catch (error) {
      if (error instanceof ContextFactConflictError) {
        return {
          ok: false,
          error: error.message,
          focusContextFactId: error.existingFactId,
        };
      }
      if (error instanceof GiftPlanConflictError) {
        // The actor travels as an id here and is turned into a name by the
        // surface, which already holds the co-planner roster. Resolving it here
        // would mean a name lookup inside a failure path.
        return {
          ok: false,
          error: error.message,
          conflict: {
            currentValue: error.conflict.currentValue,
            actorLabel: error.conflict.actorUserId,
            revision: error.conflict.revision,
          },
        };
      }
      const message = userSafeErrorMessage(error);
      if (message) {
        return { ok: false, error: message };
      }
      throw error;
    }
  };
}

export const runOwnerAction = createOwnerActionRunner({
  gate: requireAdmittedOwnerForAction,
  resolveScope: resolveScopeForCaller,
  enforceBudget: enforceProductBudget,
  reconcile: (scopes) => reconcileAffectedScopes(scopes, { origin: "owner-action" }),
});
