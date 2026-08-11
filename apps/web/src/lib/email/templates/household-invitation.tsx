import { HOUSEHOLD_SUPPORT_EMAIL } from "@tendnote/domain/household-governance";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  render,
  Section,
  Text,
} from "react-email";
import { INVITATION_DATE_FORMAT_UTC } from "@/lib/household/invitation-copy";
import { emailColors, emailColorsDark, emailFonts, emailLayout, emailText } from "../theme";
import type { TransactionalEmailContent } from "../transactional";

export type HouseholdInvitationEmailProps = {
  householdName: string;
  /** Null when the household has no display name for whoever sent it. */
  inviterName: string | null;
  acceptUrl: string;
  expiresAt: Date;
};

/** The subject line. Names the household, so the inbox row is already specific. */
function householdInvitationSubject(householdName: string): string {
  return `You're invited to ${householdName} on Tendnote`;
}

/**
 * Turns one invitation into the three things a send needs.
 *
 * Both bodies come from the same component. Keeping a hand-written plain-text
 * body beside the HTML is how the two versions of an email quietly stop saying
 * the same thing; here the text is the HTML with its markup walked off, so a
 * change to the words is a change to both. Every transport sends both: a text
 * alternative is an accessibility requirement, and filters expect to see one
 * beside the HTML rather than instead of it.
 */
export async function renderHouseholdInvitationEmail(
  props: HouseholdInvitationEmailProps,
): Promise<TransactionalEmailContent> {
  const email = <HouseholdInvitationEmail {...props} />;
  const [html, text] = await Promise.all([render(email), render(email, { plainText: true })]);

  return { subject: householdInvitationSubject(props.householdName), html, text };
}

/**
 * One Household Invitation, as a page from the notebook.
 *
 * The layout is the argument. Almost every transactional email is a white card
 * floating on a gray page under a centered logo; DESIGN.md rules out the tinted
 * ground, the decorative shadow, and the raster wordmark independently, and what
 * is left once all three are gone is a white page with hairlines and one sage
 * control - which is what a field notebook actually looks like. The restraint is
 * not an absence of design here, it is the design.
 *
 * Three details carry the brand where a template would carry none. The wordmark
 * is live text at weight 600, the way `components/tendnote-logo.tsx` sets it,
 * which is also why it survives an inbox with images turned off. Sage appears
 * exactly once, on the one thing the reader is here to press. And mono is spent
 * only on machine facts - the deadline and the paste-in URL - never on prose,
 * which is DESIGN.md's rule rather than the "monospace means technical" habit.
 *
 * The copy is the join page's copy. Someone who presses the button lands on a
 * screen that opens with the same sentence, and the invitation reads as one
 * continuous thing rather than a hand-off between two systems.
 *
 * The transport surface is `renderHouseholdInvitationEmail`, so nothing in the
 * send path can render half an email or send the HTML without its plain-text
 * twin. The default export at the bottom is a fixed React Email preview entry
 * point; it is not used by the transactional transport.
 */
function HouseholdInvitationEmail({
  householdName,
  inviterName,
  acceptUrl,
  expiresAt,
}: HouseholdInvitationEmailProps) {
  const deadline = INVITATION_DATE_FORMAT_UTC.format(expiresAt);
  const opening = inviterName
    ? `${inviterName} invited you to join`
    : "You've been invited to join";

  return (
    <Html dir="ltr" lang="en">
      <Head>
        {/*
          Read before anything else by several clients and screen readers, and
          shown when the message is opened as a web page. It carries the subject,
          not the brand name - which is also why `Preview` is told not to emit a
          second one of these over the top of it.
        */}
        <title>{householdInvitationSubject(householdName)}</title>
        <meta content="light dark" name="color-scheme" />
        <meta content="light dark" name="supported-color-schemes" />
        {/*
          The Quiet Workbench, for the clients that ask. Apple Mail and Outlook
          force a dark rendering and derive their own colors from the light ones;
          these rules hand them the real tokens instead of a machine's guess.
          Inline styles outrank a stylesheet, so each rule has to insist.
        */}
        <style>{DARK_MODE_CSS}</style>
      </Head>
      {/*
        Reinforces rather than repeats the subject: the subject names the
        household, this names the promise and the deadline.
      */}
      <Preview useTitleTag={false}>
        {`Nothing is shared until you choose to share it. The link works until ${deadline}.`}
      </Preview>
      <Body className="tn-page" style={styles.body}>
        {/*
          `lang` and `dir` again, on a direct child of `<body>`. Several clients
          strip them from `<html>`, and a screen reader with no language is the
          single most common accessibility failure in production email.
        */}
        <Container className="tn-page" dir="ltr" lang="en" style={styles.container}>
          {/*
            The ledger header: who this is from on the left, what it is on the
            right in quiet mono. Naming the kind of message before the reader
            opens a word of it is Personal Ledger density applied to an inbox -
            and it is the row every later Tendnote template inherits, which is
            what keeps it a system rather than an eyebrow.
          */}
          <Section style={styles.masthead}>
            <Row>
              <Column>
                <Text className="tn-ink" style={styles.wordmark}>
                  Tendnote
                </Text>
              </Column>
              {/* Bottom-aligned so the 13px label sits on the wordmark's baseline. */}
              <Column align="right" style={styles.mastheadLabelCell}>
                <Text className="tn-muted" style={styles.mastheadLabel}>
                  Household invitation
                </Text>
              </Column>
            </Row>
          </Section>
          <Hr className="tn-rule" style={styles.rule} />

          <Heading as="h1" className="tn-ink" style={styles.heading}>
            You&rsquo;re invited
          </Heading>
          <Text className="tn-ink" style={styles.body_}>
            {opening} <strong>{householdName}</strong> on Tendnote.
          </Text>
          <Text className="tn-ink" style={styles.body_}>
            A household is a small shared layer for the people you live with. Nothing you write in
            Tendnote is shared until you choose to share it.
          </Text>

          <Section style={styles.actionRow}>
            <Button className="tn-action" href={acceptUrl} style={styles.action}>
              Join {householdName}
            </Button>
          </Section>

          <Text className="tn-muted" style={styles.small}>
            If the button doesn&rsquo;t work, paste this link into your browser:
          </Text>
          <Text className="tn-muted" style={styles.url}>
            {acceptUrl}
          </Text>

          <Hr className="tn-rule" style={styles.rule} />

          <Text className="tn-muted" style={styles.small}>
            This link works until {deadline}, and only for the address it was sent to.
          </Text>
          <Text className="tn-muted" style={styles.small}>
            If you weren&rsquo;t expecting this, you can ignore it. Nothing happens unless you
            accept.
          </Text>

          <Hr className="tn-rule" style={styles.rule} />

          <Text className="tn-muted" style={styles.caption}>
            Tendnote is a private notebook for remembering the people in your life.
          </Text>
          <Text className="tn-muted" style={styles.captionLast}>
            You received this because someone invited this address to their household. Reply to this
            email, or write to{" "}
            <Link
              className="tn-muted"
              href={`mailto:${HOUSEHOLD_SUPPORT_EMAIL}`}
              style={styles.footerLink}
            >
              {HOUSEHOLD_SUPPORT_EMAIL}
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const DARK_MODE_CSS = `@media (prefers-color-scheme: dark) {
  .tn-page { background-color: ${emailColorsDark.background} !important; }
  .tn-ink { color: ${emailColorsDark.foreground} !important; }
  .tn-muted { color: ${emailColorsDark.mutedForeground} !important; }
  .tn-rule { border-top-color: ${emailColorsDark.border} !important; }
  .tn-action {
    background-color: ${emailColorsDark.primary} !important;
    color: ${emailColorsDark.primaryForeground} !important;
  }
}`;

const styles = {
  body: {
    backgroundColor: emailColors.background,
    color: emailColors.foreground,
    fontFamily: emailFonts.sans,
    margin: "0",
    padding: "0",
  },
  container: {
    backgroundColor: emailColors.background,
    margin: "0 auto",
    maxWidth: emailLayout.width,
    padding: `32px ${emailLayout.gutter} 40px`,
  },
  masthead: { paddingBottom: "4px" },
  /** Live text, weight 600, tracking -0.01em - the lockup rule from DESIGN.md. */
  wordmark: {
    color: emailColors.foreground,
    fontFamily: emailFonts.sans,
    fontSize: "19px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: "1",
    margin: "0",
  },
  mastheadLabelCell: { verticalAlign: "bottom" as const },
  /** What kind of message this is. Metadata, so mono - and quiet. */
  mastheadLabel: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.mono,
    fontSize: emailText.caption.fontSize,
    lineHeight: "1",
    margin: "0",
  },
  /** Every rule on the page. One hairline weight, one hairline color. */
  rule: {
    border: "none",
    borderTop: `1px solid ${emailColors.border}`,
    margin: "20px 0",
    width: "100%",
  },
  heading: {
    color: emailColors.foreground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.h1.fontSize,
    fontWeight: 600,
    lineHeight: emailText.h1.lineHeight,
    margin: "12px 0 16px",
  },
  // `body` is taken by the outer element's style; this is the prose step.
  body_: {
    color: emailColors.foreground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.body.fontSize,
    lineHeight: emailText.body.lineHeight,
    margin: "0 0 16px",
  },
  actionRow: { padding: "8px 0 24px" },
  /**
   * The one sage moment. Inline-block rather than full width: a banner-width
   * button is a marketing reflex, and this is a notebook asking a question. The
   * padding alone clears the 44px tap target.
   */
  action: {
    backgroundColor: emailColors.primary,
    borderRadius: "8px",
    color: emailColors.primaryForeground,
    display: "inline-block",
    fontFamily: emailFonts.sans,
    fontSize: emailText.body.fontSize,
    fontWeight: 500,
    lineHeight: "24px",
    padding: "12px 24px",
    textDecoration: "none",
  },
  small: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.small.fontSize,
    lineHeight: emailText.small.lineHeight,
    margin: "0 0 8px",
  },
  /** A machine fact, so mono - and it has to survive a narrow phone intact. */
  url: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.mono,
    fontSize: emailText.caption.fontSize,
    lineHeight: emailText.caption.lineHeight,
    margin: "0 0 8px",
    wordBreak: "break-all" as const,
  },
  caption: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.caption.fontSize,
    lineHeight: emailText.caption.lineHeight,
    margin: "0 0 8px",
  },
  captionLast: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.caption.fontSize,
    lineHeight: emailText.caption.lineHeight,
    margin: "0",
  },
  footerLink: { color: emailColors.mutedForeground, textDecoration: "underline" },
};

/**
 * React Email's preview server discovers templates through a default export.
 * Keep the fixture here so the preview exercises the same component and styles
 * as production without making the send path invent display-only defaults.
 */
export default function HouseholdInvitationEmailPreview() {
  return (
    <HouseholdInvitationEmail
      householdName="The Field Notebook"
      inviterName="Alex"
      acceptUrl="http://localhost:3000/join/preview-token"
      expiresAt={new Date("2026-08-15T09:00:00Z")}
    />
  );
}
