import type { SavedItemConflict } from "@tendnote/domain";

/**
 * The authoritative current value a stale household-native writer is shown beside
 * their kept draft.
 *
 * Serialized shape rather than the domain record: it crosses the Server Action
 * boundary, so instants are ISO strings like every other view in `lib`. It names
 * the last actor by id and not by name on purpose — the surface already holds the
 * household member list and resolves the name there, so nothing here can leak a
 * raw id into the page (ADR 0209, `docs/phase-8/household-saved-items.md`).
 */
export type SavedItemConflictView = {
  savedItemId: string;
  version: number;
  title: string;
  content: string | null;
  url: string | null;
  bringBackAt: string | null;
  status: "active" | "archived";
  lastActorUserId: string | null;
  updatedAt: string;
};

export function toSavedItemConflictView(conflict: SavedItemConflict): SavedItemConflictView {
  return {
    savedItemId: conflict.savedItemId,
    version: conflict.version,
    title: conflict.title,
    content: conflict.content,
    url: conflict.url,
    bringBackAt: conflict.bringBackAt?.toISOString() ?? null,
    status: conflict.status,
    lastActorUserId: conflict.lastActorUserId,
    updatedAt: conflict.updatedAt.toISOString(),
  };
}
