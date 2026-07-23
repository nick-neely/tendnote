import type { AssetKind } from "@tendnote/domain";
import {
  BoxIcon,
  CarIcon,
  HomeIcon,
  type Icon,
  PlugIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";

/**
 * One quiet glyph per Asset Kind, shared by the Assets surface, profile header,
 * and kind picker so a kind reads the same everywhere. Icons stay neutral ink —
 * kind is metadata, not state (DESIGN.md §6: badges carry state or metadata,
 * never decoration).
 */
export const ASSET_KIND_ICONS: Record<AssetKind, Icon> = {
  item: BoxIcon,
  appliance: PlugIcon,
  vehicle: CarIcon,
  subscription: RefreshCwIcon,
  service: WrenchIcon,
  property: HomeIcon,
};

/** A quiet outline badge naming an asset's kind — icon + word, never color alone. */
export function AssetKindBadge({ kind, label }: { kind: AssetKind; label: string }) {
  const Icon = ASSET_KIND_ICONS[kind];
  return (
    <Badge variant="outline">
      <Icon aria-hidden data-icon="inline-start" />
      {label}
    </Badge>
  );
}

/**
 * The archived cue: a plain outline word, deliberately not clay or red — an
 * archived asset is quiet history, never an alert (DESIGN.md calm-by-default).
 */
export function AssetArchivedBadge() {
  return <Badge variant="outline">Archived</Badge>;
}
