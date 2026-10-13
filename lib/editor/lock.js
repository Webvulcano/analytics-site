// Per-site kill switch for the content editor (Szerkesztés): sites.editing_locked, set by the
// superadmin in the DB (clients cannot write the sites table). Locked → the panel opens but is
// covered by an overlay, and the save/reset actions refuse. Portfólió / Blog are not affected.
export const EDITING_LOCKED_MESSAGE = "Jelenleg le van tiltva a szerkesztés.";

export function editingLocked(site) {
  return site?.editing_locked !== false;
}
