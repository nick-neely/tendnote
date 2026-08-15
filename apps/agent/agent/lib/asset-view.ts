import {
  type Asset,
  type AssetKind,
  type AssetStatus,
  assetLabelForKind,
  type PrivacyScope,
  visibilityLabelForScope,
} from "@tendnote/domain";

/**
 * The compact reference an Asset mutation hands back - the shape both a channel
 * and the model can read, mirroring `general-action-view.ts` for the same reason:
 * two tools that write the same record must describe it identically, or the chat
 * learns two vocabularies for one thing.
 */
export type AssetRef = {
  id: string;
  name: string;
  kind: AssetKind;
  kindLabel: string;
  status: AssetStatus;
  scope: PrivacyScope;
  visibilityLabel: string;
  /** The optimistic-concurrency fence a later edit may quote back (ADR 0153, #386). */
  revision: number;
};

export function toAssetRef(asset: Asset): AssetRef {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    kindLabel: assetLabelForKind(asset.kind),
    status: asset.status,
    scope: asset.scope,
    visibilityLabel: visibilityLabelForScope(asset.scope),
    revision: asset.revision,
  };
}

/**
 * The same reference as the model sees it.
 *
 * The `id` travels because `edit_asset`, `get_asset_context`, and
 * `propose_asset_actions` all take one and a guessed id is a failed call - the
 * lesson `search_assets` already wrote down. `revision` does not: it is a write
 * fence for a surface that rendered a form, and a model quoting a number it read
 * one turn ago would turn an ordinary edit into a conflict the user never caused.
 */
export function toAssetModelRef(ref: AssetRef) {
  return {
    assetId: ref.id,
    name: ref.name,
    kind: ref.kindLabel,
    status: ref.status,
    visibleTo: ref.visibilityLabel,
  };
}
