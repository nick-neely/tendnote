import { z } from "zod";

/**
 * Prompt nudges (Phase 2C, #114). A generic, reusable read shape for one-click
 * conversation starters: clicking a nudge SENDS TEXT TO EVE and begins a flow — it
 * never accepts/dismisses a persisted suggestion or mutates product state directly
 * (persisted review cards remain that surface). The shape is deliberately NOT
 * Calendar-specific so future sources (follow-ups, briefs, recommendations,
 * relationship context) can reuse it; Phase 2C populates only Calendar-derived
 * nudges and does not become a broad recommendations system.
 */

export const promptNudgeSourceSchema = z.enum(["calendar"]);
export type PromptNudgeSource = z.infer<typeof promptNudgeSourceSchema>;

export const promptNudgeSchema = z.object({
  id: z.string().min(1),
  /** Short button label shown to the user. */
  label: z.string().min(1).max(120),
  /** The exact text sent to Eve when the nudge is clicked. */
  prompt: z.string().min(1).max(500),
  source: promptNudgeSourceSchema,
});
export type PromptNudge = z.infer<typeof promptNudgeSchema>;

/** How many nudges a surface shows at once — a calm few, never a backlog. */
export const PROMPT_NUDGE_DISPLAY_CAP = 3;
