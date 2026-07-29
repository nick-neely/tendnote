import { vi } from "vitest";

/**
 * The two client seams every follow-up surface reaches for, redirected so a render
 * test needs neither a Next.js router context nor the draft pipeline. Importing
 * this module registers both - so import it above the surface under test:
 *
 *   import "@/test/followup-surface-mocks";
 *   import { PersonFollowups } from "./person-followups";
 *
 * Both stand-ins are inert on purpose. These suites are statements about what a
 * surface *renders*; the refresh that follows a mutation and the draft a Draft
 * control creates are behavior, and belong to the click-through suites that drive
 * those controls.
 */

vi.mock("@/components/use-create-draft", () => ({
  useCreateDraft: () => ({ create: vi.fn(), pending: false, error: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
