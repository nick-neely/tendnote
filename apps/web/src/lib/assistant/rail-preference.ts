/**
 * Whether the conversation rail is collapsed, remembered per device.
 *
 * A rail the owner folded away must stay folded across a reload, and it is a
 * per-device preference rather than account state: the same person wants it open
 * on a wide monitor and closed on a laptop. Local storage is therefore the right
 * home and a blocked store is not a failure — an unreadable preference simply
 * means the rail opens, which is the state that shows the owner their threads.
 */

const RAIL_COLLAPSED_KEY = "tendnote.assistant.rail-collapsed";

/** Reads the stored preference, defaulting to "open" whenever it cannot be read. */
export function loadAssistantRailCollapsed(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(RAIL_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAssistantRailCollapsed(storage: Storage | undefined, collapsed: boolean): void {
  try {
    storage?.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // A blocked local store costs the owner a fold, never a conversation.
  }
}
