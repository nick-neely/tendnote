import { RETENTION } from "@tendnote/domain/retention";
import { DeleteAccountButton } from "@/components/account/delete-account-button";

/**
 * What deleting the account does, in the customer's words (#619).
 *
 * Each line restates the account-deletion disposition rather than an ideal:
 * private records and Provider Connections go with the account; household-native
 * records stay with the Household under its Owners (ADR 0214), and a sole
 * member's Household is dissolved with the account; the member's
 * name is cleared from shared provenance; and backup copies age out within the
 * Backup Window, while the Recovery Journal stops a restore resurrecting the
 * account (ADR 0250). Changing what deletion does means changing this list.
 */
export const DELETION_PROMISE = [
  "Your private records and connected services are deleted now.",
  "Household records stay with the household's other members. If you're its only member, the household ends with your account.",
  "Your name is removed from the household's shared history.",
  `Backup copies expire within ${RETENTION.backupWindow.days} days, and restoring a backup never brings the account back.`,
] as const;

export const DELETION_BILLING_LINE =
  "An active subscription ends now. The rest of the paid period isn't refunded.";

/**
 * The deletion screen: Delete beside the export above it, with no forced
 * export and no cooling-off. The billing line shows only where hosted
 * Tendnote takes payment, so a self-hosted account never reads about a
 * subscription it cannot have.
 */
export function AccountDeletionSection({
  email,
  billingOffered,
}: {
  email: string;
  billingOffered: boolean;
}) {
  return (
    <section aria-labelledby="account-deletion-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="account-deletion-heading"
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
        >
          Delete account
        </h2>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Deletion happens right away. There's no waiting period, and you don't need to export
          first.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-surface px-3.5 py-3">
        <ul className="flex flex-col divide-y" data-deletion-promise>
          {DELETION_PROMISE.map((line) => (
            <li
              className="py-2 text-[length:var(--text-body)] leading-[var(--text-body-line)] first:pt-0 last:pb-0"
              key={line}
            >
              {line}
            </li>
          ))}
        </ul>
        {billingOffered ? (
          <p className="border-t pt-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {DELETION_BILLING_LINE}
          </p>
        ) : null}
        <DeleteAccountButton className="self-start" email={email} variant="destructive" />
      </div>
    </section>
  );
}
