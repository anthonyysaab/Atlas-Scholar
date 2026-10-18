import { useGatherStore, useIsGathered, type GatherItem } from "./store";

/**
 * Tick to add something to the cross-tab selection. Hidden until the row is hovered (the row needs
 * Tailwind's `group/row` class) unless ticked, or `always` is set.
 */
export function GatherToggle({
  itemKey,
  make,
  always = false,
  className = ""
}: {
  itemKey: string;
  /** Built only when ticked, so rows don't assemble items they never use. */
  make: () => GatherItem;
  always?: boolean;
  className?: string;
}) {
  const gathered = useIsGathered(itemKey);
  return (
    <input
      type="checkbox"
      checked={gathered}
      onChange={() => useGatherStore.getState().toggle(make())}
      onClick={(event) => event.stopPropagation()}
      aria-label={gathered ? "Remove from the selection" : "Add to the selection"}
      title={gathered ? "Remove from the selection" : "Add to the selection (make cards, ask, note, link…)"}
      className={`shrink-0 ${gathered || always ? "" : "opacity-0 focus:opacity-100 group-hover/row:opacity-100"} ${className}`}
    />
  );
}
