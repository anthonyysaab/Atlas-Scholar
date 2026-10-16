import { nextLevel, setThinkingLevel, thinkingDescription, thinkingLabel, useThinkingLevel, useThinkingSupport } from "./thinking";

/** Footer chip: the chat's thinking level, cycling through what the current model supports. */
export function ThinkChip() {
  const level = useThinkingLevel();
  const support = useThinkingSupport();
  const label = thinkingLabel(level, support);
  const unsupported = support.kind === "none";
  const title = unsupported
    ? "This model has no thinking switch. /think sets the level for models that do."
    : `Thinking: ${label} — ${thinkingDescription(level).toLowerCase()}. Click to change, or type /think.`;
  return (
    <button
      type="button"
      onClick={() => void setThinkingLevel(nextLevel(level, support), support)}
      title={title}
      aria-label={`Thinking ${label}`}
      className={`rounded border px-1.5 py-px ${
        level !== "auto" && !unsupported ? "border-accent text-accent" : "border-border hover:text-text"
      } ${unsupported ? "opacity-50" : ""}`}
    >
      Think: {label}
    </button>
  );
}
