import type { SuspensionCredit, SuspensionExitRef } from "@tendnote/db/queries/suspension-credits";
import { type RecoveryJournal, suspensionCreditAmounts } from "@tendnote/domain";
import type Stripe from "stripe";
import { invoiceSubscription, stripeId } from "./first-paid-invoice";
import type { SubscriptionSnapshot } from "./subscription-projection";

/**
 * A paid subscription invoice the Suspension Credit can credit (#631): its
 * subscription line, the period that line paid for, and the line's amount
 * before discounts, which is the amount a credit note credits the line by.
 * Stripe takes the line's discounts off the credited amount in proportion, so
 * the customer gets back the share of what they actually paid. The line is
 * `null` when the invoice has more than one renewal line and so no single line
 * to credit.
 */
export type CreditableInvoice = {
  invoiceId: string;
  stripeSubscriptionId: string;
  paymentIntentId: string | null;
  invoiceLineItemId: string | null;
  periodStart: Date;
  periodEnd: Date;
  lineAmount: number;
};

/**
 * The creditable part of a paid invoice, or `null` when it is not a paid
 * subscription invoice. The subscription line is the one renewal line, not a
 * proration; its period is the line's own, because a renewal invoice's own
 * period is the one before it. An invoice with no renewal line, such as one
 * that only prorates, is not creditable.
 */
export function creditableInvoice(invoice: Stripe.Invoice): CreditableInvoice | null {
  const owner = invoiceSubscription(invoice);
  if (invoice.status !== "paid" || !invoice.id || !owner) return null;
  const lines = invoice.lines.data.filter(
    (line) =>
      line.parent?.type === "subscription_item_details" &&
      !line.parent.subscription_item_details?.proration,
  );
  const [line] = lines;
  if (!line) return null;
  const payment = invoice.payments?.data.find((each) => each.status === "paid");
  return {
    invoiceId: invoice.id,
    stripeSubscriptionId: owner.stripeSubscriptionId,
    paymentIntentId: stripeId(payment?.payment.payment_intent ?? null),
    invoiceLineItemId: lines.length === 1 ? line.id : null,
    periodStart: new Date(line.period.start * 1000),
    periodEnd: new Date(line.period.end * 1000),
    lineAmount: line.amount,
  };
}

/** One credit note's line: the invoice's subscription line, credited by amount. */
export type CreditNoteLine = { invoiceId: string; invoiceLineItemId: string; lineAmount: number };

/** The credit note's single line: the invoice's subscription line, credited by amount. */
function creditNoteLines(line: CreditNoteLine) {
  return [
    {
      type: "invoice_line_item" as const,
      invoice_line_item: line.invoiceLineItemId,
      amount: line.lineAmount,
    },
  ];
}

/**
 * The Stripe calls the Suspension Credit makes, over the configured client.
 * Stripe takes the line's discounts off the credited amount and adds its tax
 * in proportion, so the instrument moves the previewed total; both are sandbox
 * checks for launch evidence. The record's id is the idempotency key and is
 * kept on the credit note, so a rerun after the key has expired finds the
 * credit note a lost response left behind rather than creating another.
 */
export function suspensionCreditStripeCalls(
  stripe: () => Pick<Stripe, "invoices" | "creditNotes">,
): Pick<
  SuspensionCreditDependencies,
  "listCreditableInvoices" | "previewCreditNote" | "createCreditNote"
> {
  return {
    listCreditableInvoices: async (stripeCustomerId) => {
      const invoices: CreditableInvoice[] = [];
      for await (const invoice of stripe().invoices.list({
        customer: stripeCustomerId,
        status: "paid",
        expand: ["data.payments"],
        limit: 100,
      })) {
        const creditable = creditableInvoice(invoice);
        if (creditable) invoices.push(creditable);
      }
      return invoices;
    },
    previewCreditNote: async (line) =>
      (
        await stripe().creditNotes.preview({
          invoice: line.invoiceId,
          lines: creditNoteLines(line),
        })
      ).total,
    createCreditNote: async ({ suspensionCreditId, instrument, amount, ...line }) => {
      const notes = stripe().creditNotes;
      let note: Stripe.CreditNote | undefined;
      for await (const each of notes.list({ invoice: line.invoiceId, limit: 100 })) {
        if (each.metadata?.suspension_credit === suspensionCreditId) note = each;
      }
      note ??= await notes.create(
        {
          invoice: line.invoiceId,
          lines: creditNoteLines(line),
          ...(instrument === "card" ? { refund_amount: amount } : { credit_amount: amount }),
          metadata: { suspension_credit: suspensionCreditId },
        },
        { idempotencyKey: `suspension-credit:${suspensionCreditId}` },
      );
      return { id: note.id, stripeRefundId: stripeId(note.refunds[0]?.refund ?? null) };
    },
  };
}

/** What the Suspension Credit Operator Action touches (#631). */
export type SuspensionCreditDependencies = {
  journal: RecoveryJournal;
  credits: {
    listSuspensionCreditsForExit: (exit: SuspensionExitRef) => Promise<SuspensionCredit[]>;
    recordSuspensionCredit: (
      input: Omit<SuspensionCredit, "id" | "stripeCreditNoteId" | "stripeRefundId">,
    ) => Promise<SuspensionCredit>;
    attachSuspensionCreditNote: (input: {
      id: string;
      stripeCreditNoteId: string;
    }) => Promise<void>;
    attachSuspensionCreditRefund: (input: { id: string; stripeRefundId: string }) => Promise<void>;
  };
  /** The account's Stripe customer, read locally; `null` when it never had one. */
  findStripeCustomer: (input: { userId: string }) => Promise<string | null>;
  /** Every paid subscription invoice the customer has, read from Stripe. */
  listCreditableInvoices: (stripeCustomerId: string) => Promise<CreditableInvoice[]>;
  retrieveSubscription: (stripeSubscriptionId: string) => Promise<SubscriptionSnapshot>;
  /** The credit note's total with its tax, previewed without creating it. */
  previewCreditNote: (line: CreditNoteLine) => Promise<number>;
  /**
   * Create the credit note for a record, under the record's id as the
   * idempotency key, or return the one already created for it.
   */
  createCreditNote: (
    input: CreditNoteLine & {
      suspensionCreditId: string;
      instrument: SuspensionCredit["instrument"];
      amount: number;
    },
  ) => Promise<{ id: string; stripeRefundId: string | null }>;
};

/**
 * The audited exit of a Temporary Suspension, from the records: its lift, or
 * the Termination that converted it, which `terminationId` names.
 */
export type CreditedExit = {
  userId: string;
  suspensionId: string;
  suspendedAt: Date;
  exitAt: Date;
  terminationId: string | null;
};

/**
 * The Suspension Credit Operator Action (ADR 0249): one credit note per paid
 * invoice whose period the suspension overlaps, crediting that invoice's
 * subscription line by the time-based amount, issued whenever that is at least
 * one cent. A Termination also returns the unused remainder, on the same credit
 * note.
 *
 * The money goes onto the customer credit balance when the subscription will
 * produce a future invoice to consume it, and back to the card otherwise: when
 * it is cancelled or ended, or the exit is a Termination.
 *
 * Each record is written and journaled before its credit note is created for
 * it, so a credit note created while the response was lost is still explained,
 * and a card refund it made matches the record and never revokes Paid Access. Running it again for the same exit
 * resumes unfinished records with their stored amounts and instrument, and
 * never credits an invoice twice.
 */
export async function issueSuspensionCredit(
  deps: SuspensionCreditDependencies,
  exit: CreditedExit,
  now: Date = new Date(),
) {
  const ref: SuspensionExitRef = exit.terminationId
    ? { terminationId: exit.terminationId }
    : { suspensionId: exit.suspensionId };
  const existing = await deps.credits.listSuspensionCreditsForExit(ref);
  const stripeCustomerId = await deps.findStripeCustomer({ userId: exit.userId });
  const invoices = stripeCustomerId ? await deps.listCreditableInvoices(stripeCustomerId) : [];

  const subscriptions = new Map<string, Promise<SubscriptionSnapshot>>();
  const subscriptionOf = (id: string) => {
    if (!subscriptions.has(id)) subscriptions.set(id, deps.retrieveSubscription(id));
    return subscriptions.get(id) as Promise<SubscriptionSnapshot>;
  };

  const issued: SuspensionCredit[] = [];
  for (const invoice of [...invoices].sort(
    (a, b) => a.periodStart.getTime() - b.periodStart.getTime(),
  )) {
    const record =
      existing.find((each) => each.invoiceId === invoice.invoiceId) ??
      (await openSuspensionCredit(
        deps,
        exit,
        invoice,
        await subscriptionOf(invoice.stripeSubscriptionId),
        now,
      ));
    if (!record) continue;
    issued.push(record.stripeCreditNoteId ? record : await createCreditNoteFor(deps, record));
  }

  return issued.map((record) => ({
    suspensionCreditId: record.id,
    invoiceId: record.invoiceId,
    suspendedAmount: record.suspendedAmount,
    remainderAmount: record.remainderAmount,
    amount: record.amount,
    instrument: record.instrument,
    stripeCreditNoteId: record.stripeCreditNoteId,
  }));
}

/**
 * Write the record for one invoice's credit, or return `null` when the
 * suspension earns that invoice less than a cent. The instrument is read here,
 * once: a renewing subscription takes the balance, anything else the card.
 */
async function openSuspensionCredit(
  deps: SuspensionCreditDependencies,
  exit: CreditedExit,
  invoice: CreditableInvoice,
  subscription: SubscriptionSnapshot,
  now: Date,
): Promise<SuspensionCredit | null> {
  const terminated = exit.terminationId !== null;
  const ends = [subscription.cancelAt, subscription.endedAt].filter((each) => each !== null);
  const { suspended, remainder } = suspensionCreditAmounts(
    {
      start: invoice.periodStart,
      end: invoice.periodEnd,
      lineAmount: invoice.lineAmount,
      cancelsAt: ends.length > 0 ? new Date(Math.min(...ends.map(Number))) : null,
    },
    { from: exit.suspendedAt, at: exit.exitAt, terminated },
  );
  if (suspended + remainder < 1) return null;
  if (!invoice.invoiceLineItemId) {
    throw new Error(
      `Invoice ${invoice.invoiceId} has more than one subscription line; a Suspension Credit credits exactly one.`,
    );
  }

  const line = {
    invoiceId: invoice.invoiceId,
    invoiceLineItemId: invoice.invoiceLineItemId,
    lineAmount: suspended + remainder,
  };
  return deps.credits.recordSuspensionCredit({
    userId: exit.userId,
    suspensionId: exit.suspensionId,
    terminationId: exit.terminationId,
    stripeSubscriptionId: invoice.stripeSubscriptionId,
    invoiceId: invoice.invoiceId,
    invoiceLineItemId: invoice.invoiceLineItemId,
    paymentIntentId: invoice.paymentIntentId,
    suspendedAmount: suspended,
    remainderAmount: remainder,
    amount: await deps.previewCreditNote(line),
    instrument: terminated || ends.length > 0 ? "card" : "balance",
    requestedAt: now,
  });
}

/** Journal an unfinished record, then create its credit note and store what Stripe returned. */
async function createCreditNoteFor(
  deps: SuspensionCreditDependencies,
  record: SuspensionCredit,
): Promise<SuspensionCredit> {
  await deps.journal.write({
    kind: "suspension-credit",
    accountId: record.userId,
    actionId: record.id,
    at: record.requestedAt,
  });
  const note = await deps.createCreditNote({
    invoiceId: record.invoiceId,
    invoiceLineItemId: record.invoiceLineItemId,
    lineAmount: record.suspendedAmount + record.remainderAmount,
    suspensionCreditId: record.id,
    instrument: record.instrument,
    amount: record.amount,
  });
  await deps.credits.attachSuspensionCreditNote({ id: record.id, stripeCreditNoteId: note.id });
  if (note.stripeRefundId) {
    await deps.credits.attachSuspensionCreditRefund({
      id: record.id,
      stripeRefundId: note.stripeRefundId,
    });
  }
  return { ...record, stripeCreditNoteId: note.id, stripeRefundId: note.stripeRefundId };
}
