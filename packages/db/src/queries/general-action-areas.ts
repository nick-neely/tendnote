import { createDrizzleGeneralActionAreaStore } from "./general-action-areas/drizzle-store";
import { createGeneralActionAreaManager } from "./general-action-areas/lifecycle";
import type {
  CreateGeneralActionAreaManagerInput,
  GeneralActionAreaActionInput,
  ListGeneralActionAreasInput,
  RenameGeneralActionAreaInput,
} from "./general-action-areas/types";

export { createDrizzleGeneralActionAreaStore } from "./general-action-areas/drizzle-store";
export { createInMemoryGeneralActionAreaStore } from "./general-action-areas/in-memory-store";
export { createGeneralActionAreaManager } from "./general-action-areas/lifecycle";
export type * from "./general-action-areas/types";

const defaultAreaStore = createDrizzleGeneralActionAreaStore();
const defaultAreaManager = createGeneralActionAreaManager(defaultAreaStore);

export async function ensureDefaultGeneralActionAreas(input: { ownerUserId: string }) {
  return defaultAreaManager.ensureDefaultAreas(input);
}

export async function listGeneralActionAreas(input: ListGeneralActionAreasInput) {
  return defaultAreaManager.listAreas(input);
}

export async function createGeneralActionArea(input: CreateGeneralActionAreaManagerInput) {
  return defaultAreaManager.createArea(input);
}

export async function renameGeneralActionArea(input: RenameGeneralActionAreaInput) {
  return defaultAreaManager.renameArea(input);
}

export async function archiveGeneralActionArea(input: GeneralActionAreaActionInput) {
  return defaultAreaManager.archiveArea(input);
}

export async function unarchiveGeneralActionArea(input: GeneralActionAreaActionInput) {
  return defaultAreaManager.unarchiveArea(input);
}

export async function getGeneralActionArea(input: GeneralActionAreaActionInput) {
  return defaultAreaManager.getArea(input);
}
