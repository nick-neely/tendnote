import type { CaptureDestinationInput, ResolvedCaptureRoute } from "../destinations";
import type { CaptureAssetReview, ConversationalCaptureDeps } from "../types";
import { parseOutcomeConfirmation } from "./confirmation";

type AssetDestinationInput = Omit<
  CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "asset_review" }>>,
  "store" | "ids"
> & {
  store?: CaptureDestinationInput["store"];
  ids?: CaptureDestinationInput["ids"];
  directlyRequested?: boolean;
};

export async function createAssetReviewDestination(input: AssetDestinationInput) {
  if (!input.deps.suggestAsset) throw new Error("Asset review capture is unavailable.");
  const evidenceText = capturedEvidenceText(input.route.fact);
  const reviewOutcome = await getOrSuggestAssetReview(
    input.deps,
    assetSuggestionInput(input, evidenceText),
    input.excludedAssetReviewGroupId,
  );
  const assetReview = reviewOutcome.result;
  const evidenceOutcome = await attachCapturedEvidence(input, assetReview, evidenceText);
  const evidence = evidenceOutcome?.result ?? null;
  const confirmation = parseOutcomeConfirmation({
    destination: "Review",
    groundedBySourceRecordId: input.sourceRecordId,
    interpreted: {
      record: "Asset",
      name: assetReview.asset.name,
      authority: "Needs review",
      scope: input.visibility.label,
    },
    change: {
      kind: "edit_asset_review",
      groupId: assetReview.group.id,
      sourceRecordId: input.sourceRecordId,
    },
    undo: { kind: "dismiss_asset_review", groupId: assetReview.group.id },
  });
  return {
    kind: "asset_review" as const,
    assetReview,
    ...(evidence ? { evidence: [evidence] } : {}),
    affectedScopes: [...reviewOutcome.affectedScopes, ...(evidenceOutcome?.affectedScopes ?? [])],
    confirmation,
    id: assetReview.group.id,
  };
}

function capturedEvidenceText(fact: string | null) {
  return fact?.match(/^evidence\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function assetSuggestionInput(input: AssetDestinationInput, evidenceText: string | null) {
  return {
    ownerUserId: input.ownerUserId,
    name: input.route.assetName,
    kind: input.route.assetKind,
    scope: input.visibility.scope,
    ...(input.visibility.householdId ? { householdId: input.visibility.householdId } : {}),
    ...(input.visibility.scope === "shared"
      ? { selectedUserIds: input.visibility.selectedUserIds }
      : {}),
    sourceRecordId: input.sourceRecordId,
    directlyRequested: input.directlyRequested ?? true,
    memories:
      input.route.fact && !evidenceText
        ? [{ label: "Captured detail", notes: input.route.fact }]
        : [],
    source: "assistant" as const,
  };
}

async function attachCapturedEvidence(
  input: AssetDestinationInput,
  assetReview: CaptureAssetReview,
  evidenceText: string | null,
) {
  if (!evidenceText) return null;
  const existing = assetReview.evidence?.find(
    (candidate) => candidate.sourceRecordId === input.sourceRecordId,
  );
  if (existing) return { result: existing, affectedScopes: [] };
  if (!input.deps.addAssetEvidence) throw new Error("Asset evidence capture is unavailable.");
  const url = captureEvidenceUrl(evidenceText);
  return input.deps.addAssetEvidence({
    ownerUserId: input.ownerUserId,
    reviewGroupId: assetReview.group.id,
    kind: url ? "link" : "note",
    label: "Captured evidence",
    ...(url ? { url } : { capturedText: evidenceText }),
    scope: input.visibility.scope,
    ...(input.visibility.householdId ? { householdId: input.visibility.householdId } : {}),
    ...(input.visibility.scope === "shared"
      ? { selectedUserIds: input.visibility.selectedUserIds }
      : {}),
    sourceRecordId: input.sourceRecordId,
    source: "assistant",
  });
}

function captureEvidenceUrl(evidenceText: string) {
  try {
    return new URL(evidenceText).toString();
  } catch {
    return undefined;
  }
}

async function getOrSuggestAssetReview(
  deps: ConversationalCaptureDeps,
  input: Parameters<NonNullable<ConversationalCaptureDeps["suggestAsset"]>>[0],
  excludedGroupId?: string,
): Promise<import("../../../affected-scopes").MutationOutcome<CaptureAssetReview>> {
  const existing = await deps.findAssetReviewBySource?.({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
    assetName: input.name,
  });
  if (existing && existing.group.id !== excludedGroupId) {
    return { result: existing, affectedScopes: [] };
  }
  if (!deps.suggestAsset) throw new Error("Asset review capture is unavailable.");
  return deps.suggestAsset(input);
}
