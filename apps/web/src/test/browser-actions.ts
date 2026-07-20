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
export const listGeneralActionHistoryAction = unusedAction;
export const pauseGeneralActionAction = unusedAction;
export const promoteAssetHintAction = unusedAction;
export const reopenGeneralActionAction = unusedAction;
export const resumeGeneralActionAction = unusedAction;
export const setGeneralActionPeopleAction = unusedAction;
export const setGeneralActionVisibilityAction = unusedAction;

export const archiveGeneralActionAreaAction = unusedAction;
export const createGeneralActionAreaAction = unusedAction;
export const renameGeneralActionAreaAction = unusedAction;
export const unarchiveGeneralActionAreaAction = unusedAction;

export const acceptSuggestedGeneralActionAction = unusedAction;
export const dismissSuggestedGeneralActionAction = unusedAction;
export const editSuggestedGeneralActionAction = unusedAction;
export const ignoreSuggestedGeneralActionAction = unusedAction;

export function useRouter() {
  return { refresh: () => {}, push: () => {} };
}
