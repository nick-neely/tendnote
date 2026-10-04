import type { OperatorAlertCondition, OperatorAlertNotice } from "@tendnote/domain/operator-alerts";

/** A notice claimed for sending, named by the episode it belongs to. */
export type ClaimedOperatorAlertNotice = OperatorAlertNotice & { episodeId: string };

export type OperatorAlertStore = {
  /** Opens an episode for the condition, unless one is already open. */
  open: (input: { condition: OperatorAlertCondition; at: Date }) => Promise<void>;
  /** Clears the condition's open episode, if there is one. */
  clear: (input: { condition: OperatorAlertCondition; at: Date }) => Promise<void>;
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
