import { createDrizzleAssetLifecycleStore } from "./assets/drizzle-store";
import { createAssetLifecycle } from "./assets/lifecycle";
import type {
  AssetActionInput,
  CreateActiveAssetInput,
  EditAssetInput,
  ListAssetAuditInput,
  ListAssetsInput,
} from "./assets/types";

export {
  createDrizzleAssetLifecycleStore,
  createDrizzleAssetStore,
} from "./assets/drizzle-store";
export { createInMemoryAssetStore } from "./assets/in-memory-store";
export { createAssetLifecycle } from "./assets/lifecycle";
export type * from "./assets/types";

const defaultAssetLifecycle = createAssetLifecycle(createDrizzleAssetLifecycleStore());

export async function createAsset(input: CreateActiveAssetInput) {
  return defaultAssetLifecycle.createAsset(input);
}

export async function editAsset(input: EditAssetInput) {
  return defaultAssetLifecycle.editAsset(input);
}

export async function archiveAsset(input: AssetActionInput) {
  return defaultAssetLifecycle.archiveAsset(input);
}

export async function restoreAsset(input: AssetActionInput) {
  return defaultAssetLifecycle.restoreAsset(input);
}

export async function getAsset(input: { callerUserId: string; assetId: string }) {
  return defaultAssetLifecycle.getAsset(input);
}

export async function listAssets(input: ListAssetsInput) {
  return defaultAssetLifecycle.listAssets(input);
}

export async function listAssetAudit(input: ListAssetAuditInput) {
  return defaultAssetLifecycle.listAssetAudit(input);
}
