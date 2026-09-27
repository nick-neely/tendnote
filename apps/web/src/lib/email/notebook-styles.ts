import { emailColors, emailColorsDark, emailFonts, emailLayout, emailText } from "./theme";

/**
 * The notebook page every Tendnote email is laid out on: a white page with
 * hairlines and one sage control, restated as inline styles because that is
 * the only styling email clients agree on. See `templates/household-invitation.tsx` for
 * why the page looks the way it does.
 */

/**
 * The Quiet Workbench for clients that ask for dark mode. Inline styles outrank
 * a stylesheet, so each rule has to insist.
 */
export const NOTEBOOK_DARK_MODE_CSS = `@media (prefers-color-scheme: dark) {
  .tn-page { background-color: ${emailColorsDark.background} !important; }
  .tn-ink { color: ${emailColorsDark.foreground} !important; }
  .tn-muted { color: ${emailColorsDark.mutedForeground} !important; }
  .tn-rule { border-top-color: ${emailColorsDark.border} !important; }
  .tn-panel { background-color: ${emailColorsDark.surface} !important; }
  .tn-link { color: ${emailColorsDark.foreground} !important; }
  .tn-action {
    background-color: ${emailColorsDark.primary} !important;
    color: ${emailColorsDark.primaryForeground} !important;
  }
}
@media only screen and (max-width: 480px) {
  .tn-action { display: block !important; text-align: center !important; }
}`;

export const notebookStyles = {
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
    padding: `40px ${emailLayout.gutter} 36px`,
  },
  masthead: { paddingBottom: "40px" },
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
  content: { paddingBottom: "32px" },
  invitationLine: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.body.fontSize,
    lineHeight: emailText.body.lineHeight,
    margin: "0 0 4px",
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
    margin: "0 0 16px",
  },
  // `body` is taken by the outer element's style; this is the prose step.
  body_: {
    color: emailColors.foreground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.body.fontSize,
    lineHeight: emailText.body.lineHeight,
    margin: "0 0 16px",
  },
  actionRow: { padding: "8px 0 10px" },
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
  deadline: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.small.fontSize,
    lineHeight: emailText.small.lineHeight,
    margin: "0",
  },
  fallback: {
    backgroundColor: emailColors.surface,
    borderRadius: "10px",
    padding: "16px",
  },
  fallbackTitle: {
    color: emailColors.foreground,
    fontFamily: emailFonts.sans,
    fontSize: emailText.small.fontSize,
    fontWeight: 600,
    lineHeight: emailText.small.lineHeight,
    margin: "0 0 4px",
  },
  fallbackLink: {
    color: emailColors.foreground,
    textDecoration: "underline",
  },
  /** A machine fact, so mono - and it has to survive a narrow phone intact. */
  url: {
    color: emailColors.mutedForeground,
    fontFamily: emailFonts.mono,
    fontSize: emailText.caption.fontSize,
    lineHeight: emailText.caption.lineHeight,
    margin: "0",
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
