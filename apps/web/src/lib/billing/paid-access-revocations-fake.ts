import type {
  AdmissionExceptionRecord,
  DisputeRecord,
  RefundRecord,
} from "@tendnote/db/queries/paid-access-revocations";
import type { SuspensionCredit } from "@tendnote/db/queries/suspension-credits";
import type { RevocationRecords } from "./paid-access-revocation";
import type { SuspensionCreditDependencies } from "./suspension-credit";

type RefundMatch = Parameters<RevocationRecords["findUnmatchedRefundRecord"]>[0];

/** The Drizzle queries' lost-id match: newest unmatched record for this payment, amount, and window. */
function newestUnmatched<
  T extends {
    paymentIntentId: string | null;
    amount: number;
    stripeRefundId: string | null;
    requestedAt: Date;
  },
>(rows: readonly T[], match: RefundMatch): T | null {
  return (
    rows
      .filter(
        (record) =>
          record.paymentIntentId === match.paymentIntentId &&
          record.amount === match.amount &&
          record.stripeRefundId === null &&
          record.requestedAt >= match.requestedAtOrAfter &&
          record.requestedAt <= match.requestedAtOrBefore,
      )
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0] ?? null
  );
}

/**
 * Refund records, Suspension Credits, disputes, and Admission Exceptions in
 * memory, with the Drizzle queries' semantics: a record keeps the first refund
 * id and credit note it is given, an exit credits an invoice once, a dispute
 * and the exception naming an event are each written once, and a
 * subscription's blocks are its matched refunds and its disputes.
 */
export function createPaidAccessRevocationsFake(input: { steps?: string[] } = {}) {
  const steps = input.steps ?? [];
  const refunds: RefundRecord[] = [];
  const disputes = new Map<string, DisputeRecord>();
  const exceptions: AdmissionExceptionRecord[] = [];
  const suspensionCredits: SuspensionCredit[] = [];
  const attachCreditRefund = async ({
    id,
    stripeRefundId,
  }: {
    id: string;
    stripeRefundId: string;
  }) => {
    const record = suspensionCredits.find((each) => each.id === id);
    if (record && record.stripeRefundId === null) record.stripeRefundId = stripeRefundId;
  };

  const revocations: RevocationRecords = {
    getRefundRecordByStripeRefund: async ({ stripeRefundId }) =>
      refunds.find((record) => record.stripeRefundId === stripeRefundId) ?? null,
    findUnmatchedRefundRecord: async (match) => newestUnmatched(refunds, match),
    attachStripeRefund: async ({ id, stripeRefundId }) => {
      const record = refunds.find((each) => each.id === id);
      if (record && record.stripeRefundId === null) record.stripeRefundId = stripeRefundId;
    },
    markRefundRevoked: async ({ id, at }) => {
      const record = refunds.find((each) => each.id === id);
      if (record && record.revokedAt === null) record.revokedAt = at;
    },
    getSuspensionCreditByStripeRefund: async ({ stripeRefundId }) =>
      suspensionCredits.find((record) => record.stripeRefundId === stripeRefundId) ?? null,
    findUnmatchedSuspensionCredit: async (match) =>
      newestUnmatched(
        suspensionCredits.filter((record) => record.instrument === "card"),
        match,
      ),
    attachSuspensionCreditRefund: attachCreditRefund,
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
    findRefundRecordForInvoice: async ({ invoiceId }: { invoiceId: string }) => {
      const record = refunds
        .filter((each) => each.invoiceId === invoiceId)
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())[0];
      return record ? { ...record } : null;
    },
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

  const credits: SuspensionCreditDependencies["credits"] = {
    listSuspensionCreditsForExit: async (exit) =>
      suspensionCredits
        .filter((record) =>
          "terminationId" in exit
            ? record.terminationId === exit.terminationId
            : record.suspensionId === exit.suspensionId && record.terminationId === null,
        )
        .map((record) => ({ ...record })),
    recordSuspensionCredit: async (credit) => {
      const exitKey = (record: Pick<SuspensionCredit, "suspensionId" | "terminationId">) =>
        record.terminationId ?? `lift:${record.suspensionId}`;
      if (
        suspensionCredits.some(
          (each) => exitKey(each) === exitKey(credit) && each.invoiceId === credit.invoiceId,
        )
      ) {
        throw new Error(
          credit.terminationId
            ? "suspension_credits_termination_invoice_idx"
            : "suspension_credits_lift_invoice_idx",
        );
      }
      const record: SuspensionCredit = {
        ...credit,
        id: `suspension-credit-${suspensionCredits.length + 1}`,
        stripeCreditNoteId: null,
        stripeRefundId: null,
      };
      suspensionCredits.push(record);
      steps.push("record:suspension-credit");
      return { ...record };
    },
    attachSuspensionCreditNote: async ({ id, stripeCreditNoteId }) => {
      const record = suspensionCredits.find((each) => each.id === id);
      if (record && record.stripeCreditNoteId === null) {
        record.stripeCreditNoteId = stripeCreditNoteId;
      }
    },
    attachSuspensionCreditRefund: attachCreditRefund,
  };

  return { revocations, records, credits, refunds, suspensionCredits, disputes, exceptions };
}
