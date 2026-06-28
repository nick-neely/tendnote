import { createDrizzleBriefLifecycleStore, createDrizzleBriefStore } from "./briefs/drizzle-store";
import type { GenerateBriefInput } from "./briefs/generator";
import { createBriefGenerator } from "./briefs/generator";
import type { ManualBriefInput } from "./briefs/manual";
import { createManualBriefGeneration } from "./briefs/manual";
import { getRelationshipAgenda } from "./relationship-agenda";

export {
  createDrizzleBriefLifecycleStore,
  createDrizzleBriefStore,
} from "./briefs/drizzle-store";
export {
  type BriefAgendaSource,
  createBriefGenerator,
  type GenerateBriefInput,
} from "./briefs/generator";
export {
  createInMemoryBriefLifecycleStore,
  createInMemoryBriefStore,
} from "./briefs/in-memory-store";
export {
  type BriefItemActionInput,
  createBriefLifecycle,
  type SnoozeBriefItemInput,
} from "./briefs/lifecycle";
export {
  createManualBriefGeneration,
  type ManualBriefInput,
  type ManualBriefOutcome,
  type ManualBriefResult,
} from "./briefs/manual";
export type * from "./briefs/types";

// Production wiring lives in the barrel (mirroring relationship-agenda.ts): the
// generator builder stays a pure DI seam, and the composed default reads the
// drizzle brief store and the drizzle relationship agenda. Schedule dispatch
// (#72) and the manual web action (#69) call this shared default so they cannot
// fork generator behavior.
const defaultBriefGenerator = createBriefGenerator(createDrizzleBriefStore(), {
  getRelationshipAgenda,
});

export function generateBrief(input: GenerateBriefInput) {
  return defaultBriefGenerator.generateBrief(input);
}

// Manual generate/regenerate default: the audited owner-scoped seam the web action
// (#69) calls. It wires the drizzle lifecycle store (brief persistence + audit) and
// the same default agenda, building the shared generator internally so the manual
// path and schedule dispatch cannot fork generator behavior.
const defaultManualBriefGeneration = createManualBriefGeneration(
  createDrizzleBriefLifecycleStore(),
  { getRelationshipAgenda },
);

export function generateManualBrief(input: ManualBriefInput) {
  return defaultManualBriefGeneration.generateCurrentBrief(input);
}
