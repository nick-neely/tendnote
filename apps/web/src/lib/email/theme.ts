/**
 * Tendnote's Field Notebook, in the only vocabulary email clients agree on.
 *
 * `globals.css` is the product's token layer, but none of it survives the trip
 * into an inbox: `oklch()`, custom properties, and cascading stylesheets are all
 * unreliable across Gmail, Outlook, and the rest. So the same decisions are
 * restated here as literal hex and pixel values, converted from the oklch
 * originals rather than re-picked by eye. When a token moves in `globals.css`,
 * it moves here too - these are one design system in two runtimes, not two
 * palettes.
 *
 * What is deliberately *not* carried over: the app's soft `--surface` and
 * `--panel` fills. Email templates default to a tinted card floating on a gray
 * page, and DESIGN.md rules that out twice over (pure surfaces, no decorative
 * shadows). A Tendnote email is a white page with hairlines, the way a field
 * notebook is a white page with rules.
 */

/** Light: Field Notebook. The default every client sees. */
export const emailColors = {
  /** `--background`: oklch(1 0 0) */
  background: "#ffffff",
  /** `--foreground`: oklch(0.18 0.018 145). 18.7:1 on the background. */
  foreground: "#0d140d",
  /** `--muted-foreground`: oklch(0.43 0.018 145). 8:1 - readable, not "elegant gray". */
  mutedForeground: "#4a534a",
  /** `--primary`: oklch(0.39 0.085 142). The sage, spent on exactly one control. */
  primary: "#285024",
  /** `--primary-foreground`: oklch(0.99 0 0). 9:1 on the sage. */
  primaryForeground: "#fcfcfc",
  /** `--border`: oklch(0.88 0.006 145). Every rule on the page is this hairline. */
  border: "#d5d8d5",
} as const;

/**
 * Dark: Quiet Workbench.
 *
 * Apple Mail and Outlook force dark mode and derive their own colors from the
 * light ones. Tendnote's real dark mode is near-black under near-white, which is
 * roughly where an auto-inversion lands anyway - so this block is a correction,
 * not a rescue: clients that honor `prefers-color-scheme` get the actual sage
 * and the actual ink instead of a machine's guess at them. `--border` is
 * `oklch(1 0 0 / 12%)` in the app; alpha does not survive here, so it is
 * flattened against the dark background.
 */
export const emailColorsDark = {
  background: "#020202",
  foreground: "#f2f2f2",
  mutedForeground: "#a2a6a2",
  primary: "#6ca366",
  primaryForeground: "#020202",
  border: "#161616",
} as const;

/**
 * The IBM Plex superfamily with a full fallback chain.
 *
 * No `@font-face` and no hosted web font: most clients strip them, the ones that
 * do not pay a round trip before first paint, and a message that arrives
 * unstyled is worse than one that arrives in the system sans. Plex renders for
 * anyone who has it; everyone else gets their platform's humanist sans, which is
 * the same register.
 */
export const emailFonts = {
  sans: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  /** Machine facts only - the deadline and the fallback URL. Never prose. */
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/**
 * DESIGN.md's product scale, stepped up for the medium.
 *
 * Body is 15/24 in the app and 16/26 here, and small is 13/20 there and 14/22
 * here. That is not drift: the app is read on a screen the reader chose to open,
 * an email is read in whatever list they were already scrolling, and 16px is the
 * floor below which mobile clients start zooming on their own. The hierarchy -
 * one display step, one body step, one supporting step - is unchanged.
 */
export const emailText = {
  h1: { fontSize: "24px", lineHeight: "32px" },
  body: { fontSize: "16px", lineHeight: "26px" },
  small: { fontSize: "14px", lineHeight: "22px" },
  caption: { fontSize: "13px", lineHeight: "20px" },
} as const;

/**
 * 600px outer, inset by the 20px phone gutter, leaving a 560px measure.
 *
 * 600 is the width every client is built around; 20px is `--tn-gutter`, the
 * app's one layout constant; and what falls out is about 65 characters at 16px,
 * which is the bottom of DESIGN.md's prose measure. The email is as wide as it
 * is because the reading line says so.
 */
export const emailLayout = {
  width: "600px",
  gutter: "20px",
} as const;
