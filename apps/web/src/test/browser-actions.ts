/**
 * Browser-contract boundary for server actions and Next navigation. Layout tests never
 * mutate data; aliases in `vitest.browser.config.ts` keep server-only graphs out of Vite.
 */
const unusedAction = async () => undefined;

export const archiveGeneralActionAction = unusedAction;
export const completeGeneralActionAction = unusedAction;
export const createGeneralActionAction = unusedAction;
export const deferGeneralActionAction = unusedAction;
export const dismissGeneralActionAction = unusedAction;
export const editGeneralActionAction = unusedAction;
export const getActionComposerOptionsAction = unusedAction;
export const getActionSecondaryLedgerViewsAction = unusedAction;
export const getActionSecondaryViewsAction = unusedAction;
export const getSuggestedActionViewsAction = unusedAction;
export const listGeneralActionHistoryAction = unusedAction;
export const pauseGeneralActionAction = unusedAction;
export const promoteAssetHintAction = unusedAction;
export const reopenGeneralActionAction = unusedAction;
export const restoreGeneralActionAction = unusedAction;
export const resumeGeneralActionAction = unusedAction;
export const setGeneralActionPeopleAction = unusedAction;
export const setGeneralActionVisibilityAction = unusedAction;
export const skipGeneralActionOccurrenceAction = unusedAction;
export const undeferGeneralActionAction = unusedAction;
export const undoRoutineOccurrenceAction = unusedAction;

export const archiveGeneralActionAreaAction = unusedAction;
export const createGeneralActionAreaAction = unusedAction;
export const renameGeneralActionAreaAction = unusedAction;
export const unarchiveGeneralActionAreaAction = unusedAction;

export const acceptSuggestedGeneralActionAction = unusedAction;
export const dismissSuggestedGeneralActionAction = unusedAction;
export const editSuggestedGeneralActionAction = unusedAction;
export const ignoreSuggestedGeneralActionAction = unusedAction;
export const restoreDismissedSuggestedGeneralActionAction = unusedAction;

export const acceptAssetReviewGroupAction = unusedAction;
export const acceptSuggestedAssetAction = unusedAction;
export const acceptSuggestedAssetMemoryAction = unusedAction;
export const dismissAssetReviewGroupAction = unusedAction;
export const dismissSuggestedAssetMemoryAction = unusedAction;
export const editSuggestedAssetAction = unusedAction;
export const editSuggestedAssetMemoryAction = unusedAction;
export const linkAssetReviewGroupAction = unusedAction;
export const addAssetEvidenceAction = unusedAction;
export const addAssetEvidenceToNewAssetAction = unusedAction;
export const listAssetEvidenceDestinationsAction = async () => [];
export const removeAssetEvidenceAction = unusedAction;

export const archiveSuggestedMemoryAction = unusedAction;
export const dismissSuggestedMemoryAction = unusedAction;
export const editSuggestedMemoryAction = unusedAction;
export const restoreDismissedSuggestedMemoryAction = unusedAction;
export const saveSuggestedMemoryAction = unusedAction;

export const addCapturePersonAction = unusedAction;
export const captureExplicitOutcomeAction = unusedAction;
export const changeExplicitCaptureOutcomeAction = unusedAction;
export const changeExplicitCaptureReminderAction = unusedAction;
export const undoExplicitCaptureOutcomeAction = unusedAction;
export const createSelfContextFactAction = unusedAction;
export const archiveSelfContextFactAction = unusedAction;
export const deleteSelfContextFactAction = unusedAction;
export const globalRecallAction = unusedAction;
export const restoreSelfContextFactAction = unusedAction;
export const updateSelfContextFactAction = unusedAction;

export const actOnTodayItemAction = unusedAction;
export const refreshTodayAction = unusedAction;
export const restoreTodayItemAction = unusedAction;
export const suppressTodayItemAction = unusedAction;

export const beginReminderInstallationOptInAction = unusedAction;
export const claimReminderStandaloneContinuationAction = async () => ({ claimed: false });
export const clearReminderAction = unusedAction;
export const disableCurrentReminderInstallationAction = unusedAction;
export const getReminderInstallationStateAction = async () => ({
  optInState: null,
  installation: null,
});
export const markReminderStandaloneContinuationAction = unusedAction;
export const reconcileReminderTimeZoneAction = async () => ({
  ok: true as const,
  view: { reconciled: 0, remaining: 0, nextOffset: 0 },
});
export const registerReminderInstallationAction = async () => ({ enabled: true });
export const revokeReminderInstallationAction = unusedAction;
export const saveReminderAction = unusedAction;
export const setReminderInstallationPreviewModeAction = unusedAction;
export const setReminderOptInDecisionAction = unusedAction;

export function useRouter() {
  return { refresh: () => {}, push: () => {} };
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}
