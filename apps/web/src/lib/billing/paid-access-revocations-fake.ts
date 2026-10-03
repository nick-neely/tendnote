import type {
  AdmissionExceptionRecord,
  DisputeRecord,
  RefundRecord,
} from "@tendnote/db/queries/paid-access-revocations";
import type { RevocationRecords } from "./paid-access-revocation";

/**
 * Refund records, disputes, and Admission Exceptions in memory, with the
 * Drizzle queries' semantics: a record keeps the first refund id it is given,
 * a dispute and the exception naming an event are each written once, and a
 * subscription's blocks are its matched refunds and its disputes.
 */
export function createPaidAccessRevocationsFake(input: { steps?: string[] } = {}) {
  const steps = input.steps ?? [];
  const refunds: RefundRecord[] = [];
  const disputes = new Map<string, DisputeRecord>();
  const exceptions: AdmissionExceptionRecord[] = [];

  const revocations: RevocationRecords = {
    getRefundRecordByStripeRefund: async ({ stripeRefundId }) =>
      refunds.find((record) => record.stripeRefundId === stripeRefundId) ?? null,
    findUnmatchedRefundRecord: async (match) =>
      refunds
        .filter(
          (record) =>
            record.paymentIntentId === match.paymentIntentId &&
            record.amount === match.amount &&
            record.stripeRefundId === null &&
            record.requestedAt >= match.requestedAtOrAfter &&
            record.requestedAt <= match.requestedAtOrBefore,
        )
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0] ?? null,
    attachStripeRefund: async ({ id, stripeRefundId }) => {
      const record = refunds.find((each) => each.id === id);
      if (record && record.stripeRefundId === null) record.stripeRefundId = stripeRefundId;
    },
    markRefundRevoked: async ({ id, at }) => {
      const record = refunds.find((each) => each.id === id);
      if (record && record.revokedAt === null) record.revokedAt = at;
    },
    getDispute: async ({ stripeDisputeId }) => {
      const dispute = disputes.get(stripeDisputeId);
      return dispute ? { ...dispute } : null;
    },
    recordDispute: async (dispute) => {
      if (!disputes.has(dispute.stripeDisputeId)) {
        disputes.set(dispute.stripeDisputeId, { ...dispute, renewalStopped: false });
      }
      return { ...(disputes.get(dispute.stripeDisputeId) as DisputeRecord) };
    },
    markDisputeRenewalStopped: async ({ stripeDisputeId }) => {
      const dispute = disputes.get(stripeDisputeId);
      if (dispute) dispute.renewalStopped = true;
    },
    listSubscriptionRevocationBlocks: async ({ stripeSubscriptionId }) => [
      ...refunds
        .filter(
          (record) =>
            record.stripeSubscriptionId === stripeSubscriptionId && record.stripeRefundId !== null,
        )
        .map((record) => ({ kind: "refund", event: record.id, exceptions: [] })),
      ...[...disputes.values()]
        .filter((dispute) => dispute.stripeSubscriptionId === stripeSubscriptionId)
        .map((dispute) => ({
          kind: "dispute",
          event: dispute.stripeDisputeId,
          exceptions: exceptions
            .filter(
              (each) => each.blockKind === "dispute" && each.event === dispute.stripeDisputeId,
            )
            .map((each) => ({ event: each.event })),
        })),
    ],
  };

  const records = {
    recordRefund: async (refund: Omit<RefundRecord, "id" | "stripeRefundId" | "revokedAt">) => {
      const record: RefundRecord = {
        ...refund,
        id: `refund-record-${refunds.length + 1}`,
        stripeRefundId: null,
        revokedAt: null,
      };
      refunds.push(record);
      steps.push("record:refund");
      return { ...record };
    },
    grantAdmissionException: async (grant: Omit<AdmissionExceptionRecord, "id">) => {
      let record = exceptions.find(
        (each) => each.blockKind === grant.blockKind && each.event === grant.event,
      );
      if (!record) {
        record = { ...grant, id: `exception-${exceptions.length + 1}` };
        exceptions.push(record);
      }
      steps.push("record:grant");
      return { ...record };
    },
  };

  return { revocations, records, refunds, disputes, exceptions };
}
