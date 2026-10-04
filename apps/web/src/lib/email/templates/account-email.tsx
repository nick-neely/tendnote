import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  render,
  Section,
  Text,
} from "react-email";
import { NOTEBOOK_DARK_MODE_CSS, notebookStyles as styles } from "../notebook-styles";
import type { TransactionalEmailContent } from "../transactional";

/**
 * The account and sign-in emails: the two Better Auth asks Tendnote to deliver,
 * the "you're in" message sent on admission (#607), the confirmation of a
 * cancellation scheduled in the portal (#609), the reminder before an annual
 * renewal (#611), and the confirmation of a refund (#617).
 */
export type AccountEmailPurpose =
  | "verify-email"
  | "reset-password"
  | "admitted"
  | "cancellation"
  | "renewal-reminder"
  | "refund";

export type AccountEmailProps = {
  purpose: AccountEmailPurpose;
  actionUrl: string;
  supportEmail: string;
};

/**
 * The words for each purpose. Deliberately content-free: no name, no record,
 * nothing about the account beyond the address it was sent to, so a message
 * read by the wrong person tells them nothing but that the address was used.
 */
const COPY = {
  "verify-email": {
    subject: "Confirm your email for Tendnote",
    preview: "One step to finish setting up your account.",
    heading: "Confirm your email",
    body: "Confirm this address to finish setting up your Tendnote account.",
    action: "Confirm email",
    fallback: "Confirm in your browser",
    reason:
      "Someone signed up for Tendnote with this email address. If it wasn’t you, you can ignore this email.",
  },
  "reset-password": {
    subject: "Reset your Tendnote password",
    preview: "Choose a new password for your account.",
    heading: "Reset your password",
    body: "Choose a new password for your Tendnote account. The link works once.",
    action: "Choose a new password",
    fallback: "Reset in your browser",
    reason:
      "Someone asked to reset the password for the Tendnote account at this address. If it wasn’t you, you can ignore this email; your password stays the same.",
  },
  admitted: {
    subject: "You’re in: your Tendnote account is ready",
    preview: "Your payment is confirmed. Tendnote is ready when you are.",
    heading: "You’re in",
    body: "Your payment is confirmed and your Tendnote account is ready. Stripe sends your receipt separately.",
    action: "Open Tendnote",
    fallback: "Open Tendnote in your browser",
    reason:
      "This email address subscribed to Tendnote. If you didn’t, reply to this email and we’ll look into it.",
  },
  cancellation: {
    subject: "Your Tendnote subscription is cancelled",
    preview: "You keep full access until the end of the period you’ve paid for.",
    heading: "Your subscription is cancelled",
    body: "Your Tendnote subscription won’t renew. You keep full access until the end of the period you’ve already paid for; your account page shows the date. Changed your mind? You can undo this from Billing on your account page until then.",
    action: "Manage billing",
    fallback: "Open your account in your browser",
    reason:
      "The Tendnote subscription for this email address was cancelled. If you didn’t do this, reply to this email and we’ll look into it.",
  },
  "renewal-reminder": {
    subject: "Your Tendnote subscription renews soon",
    preview: "Nothing to do if you’d like to keep it.",
    heading: "Your subscription renews soon",
    body: "Your Tendnote subscription will renew soon, and Stripe will charge the card on file. There’s nothing to do if you’d like to keep it. To see the date and amount, change your card, or cancel, go to Billing on your account page.",
    action: "Manage billing",
    fallback: "Open your account in your browser",
    reason:
      "This email address has a Tendnote subscription that renews automatically. We send this reminder before it renews, so the charge is never a surprise.",
  },
  refund: {
    subject: "Your Tendnote refund is on its way",
    preview: "Your payment is being returned to the card you paid with.",
    heading: "Your refund is on its way",
    body: "We’ve refunded your Tendnote payment to the card you paid with. When it appears is up to your card issuer, and often takes 5 to 10 business days. Your subscription has ended and won’t charge you again. Your account page shows how long your data is kept, and you can export it or resubscribe from there.",
    action: "Open your account",
    fallback: "Open your account in your browser",
    reason:
      "A payment for the Tendnote subscription at this email address was refunded. If you didn’t ask for this, reply to this email and we’ll look into it.",
  },
} as const satisfies Record<AccountEmailPurpose, NotebookEmailCopy>;

/** Renders one account email as both bodies from the same component. */
export function renderAccountEmail(props: AccountEmailProps): Promise<TransactionalEmailContent> {
  return renderNotebookEmail({
    copy: COPY[props.purpose],
    actionUrl: props.actionUrl,
    supportEmail: props.supportEmail,
  });
}

/**
 * The words of one notebook-page email. `action` and `fallback` come as a
 * pair: an email without an action, such as a deletion confirmation, has
 * neither, and renders no button.
 */
export type NotebookEmailCopy = {
  subject: string;
  preview: string;
  heading: string;
  body: string;
  reason: string;
} & ({ action: string; fallback: string } | { action?: never; fallback?: never });

type NotebookEmailProps = {
  copy: NotebookEmailCopy;
  /** Required exactly when the copy has an action. */
  actionUrl?: string;
  supportEmail: string;
};

/** Renders a notebook-page email as both bodies from the same component. */
export async function renderNotebookEmail(
  props: NotebookEmailProps,
): Promise<TransactionalEmailContent> {
  const email = <NotebookEmail {...props} />;
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })]);

  return { subject: props.copy.subject, html, text };
}

/** Laid out on the same notebook page as a Household Invitation. */
export function NotebookEmail({ copy, actionUrl, supportEmail }: NotebookEmailProps) {
  const action = copy.action && actionUrl ? { label: copy.action, url: actionUrl } : null;

  return (
    <Html dir="ltr" lang="en">
      <Head>
        <title>{copy.subject}</title>
        <meta content="light dark" name="color-scheme" />
        <meta content="light dark" name="supported-color-schemes" />
        <style>{NOTEBOOK_DARK_MODE_CSS}</style>
      </Head>
      <Preview useTitleTag={false}>{copy.preview}</Preview>
      <Body className="tn-page" style={styles.body}>
        <Container className="tn-page" dir="ltr" lang="en" style={styles.container}>
          <Section style={styles.masthead}>
            <Text className="tn-ink" style={styles.wordmark}>
              Tendnote
            </Text>
          </Section>
          <Section style={styles.content}>
            <Heading as="h1" className="tn-ink" style={styles.heading}>
              {copy.heading}
            </Heading>
            <Text className="tn-ink" style={styles.body_}>
              {copy.body}
            </Text>
            {action ? (
              <Section style={styles.actionRow}>
                <Button className="tn-action" href={action.url} style={styles.action}>
                  {action.label}
                </Button>
              </Section>
            ) : null}
          </Section>

          {action ? (
            <Section className="tn-panel" style={styles.fallback}>
              <Text className="tn-ink" style={styles.fallbackTitle}>
                Button not working?
              </Text>
              <Text className="tn-muted" style={styles.small}>
                <Link className="tn-link" href={action.url} style={styles.fallbackLink}>
                  {copy.fallback}
                </Link>
                , or copy and paste this address:
              </Text>
              <Text className="tn-muted" style={styles.url}>
                {action.url}
              </Text>
            </Section>
          ) : null}

          <Hr className="tn-rule" style={styles.rule} />

          <Text className="tn-muted" style={styles.caption}>
            Why you received this: {copy.reason}
          </Text>
          <Text className="tn-muted" style={styles.captionLast}>
            Need help? Reply to this email or write to{" "}
            <Link className="tn-muted" href={`mailto:${supportEmail}`} style={styles.footerLink}>
              {supportEmail}
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** React Email preview entry point; not used by the transport. */
export default function AccountEmailPreview() {
  return (
    <NotebookEmail
      copy={COPY["verify-email"]}
      actionUrl="http://localhost:3000/api/auth/verify-email?token=preview-token"
      supportEmail="support@example.test"
    />
  );
}
