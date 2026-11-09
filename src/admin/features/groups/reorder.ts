export type Sortable = { id: string; sort: number };

/**
 * Moves the item at `index` one step (`-1` up, `1` down) and returns the `sort` patches needed.
 * Every item is renumbered to its index, so lists with duplicate or gappy `sort` values still move.
 */
export const reorderPatches = (items: Sortable[], index: number, dir: -1 | 1): Sortable[] => {
  const target = index + dir;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [];
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next.flatMap((item, i) => (item.sort === i ? [] : [{ id: item.id, sort: i }]));
};
