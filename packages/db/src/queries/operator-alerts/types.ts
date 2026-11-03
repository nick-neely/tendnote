import type {
  FirstValueAlertContext,
  FirstValueHealthSample,
  FirstValuePolicy,
  OperatorAlertCondition,
  OperatorAlertNotice,
} from "@tendnote/domain/operator-alerts";

/** A notice claimed for sending, named by the episode it belongs to. */
export type ClaimedOperatorAlertNotice = OperatorAlertNotice & {
  episodeId: string;
  openedAt: Date;
  clearedAt: Date | null;
  firstValueContext?: FirstValueAlertContext;
};

export type OperatorAlertStore = {
  /** Returns the new episode id, or null if an episode was already open. */
  open: (input: {
    condition: OperatorAlertCondition;
    at: Date;
    firstValueContext?: FirstValueAlertContext;
  }) => Promise<string | null>;
  /** Clears the condition's open episode, if there is one. */
  clear: (input: { condition: OperatorAlertCondition; at: Date }) => Promise<void>;
  /**
   * Whether this pass runs the synthetic First Value check. Always under the
   * ten-minute policy; under the daily policy, an atomic claim of the day's run.
   */
  claimFirstValueRun: (input: { at: Date }) => Promise<boolean>;
  /** Atomically records one scheduled sample and its incident/summary transitions. */
  observeFirstValue: (input: { sample: FirstValueHealthSample; at: Date }) => Promise<string[]>;
  /**
   * Claims every notice that is due, recoveries first: an alert for an open
   * episode not yet alerted, and a recovery for a cleared episode that was
   * alerted. A claimed notice is not claimed again, so concurrent passes never
   * both send it. An episode that cleared before its alert went out sends
   * neither.
   */
  claimNotices: (input: { at: Date }) => Promise<ClaimedOperatorAlertNotice[]>;
  /** Hands back a claimed notice whose send failed, for the next pass to retry. */
  releaseNotice: (notice: ClaimedOperatorAlertNotice) => Promise<void>;
};

/** Every store adapter's options. The policy defaults to `FIRST_VALUE_POLICY`. */
export type OperatorAlertStoreOptions = { firstValuePolicy?: FirstValuePolicy };
