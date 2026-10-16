import { useEffect, useState } from "react";
import type { ThinkingLevel, ThinkingSupport } from "@shared/types";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";

export const NO_THINKING: ThinkingSupport = { kind: "none", levels: ["auto"] };

const DESCRIPTIONS: Record<ThinkingLevel, string> = {
  auto: "The model decides whether to think",
  off: "Answer directly, without reasoning first",
  low: "Think briefly",
  medium: "Think",
  high: "Think at length before answering"
};

export function thinkingLabel(level: ThinkingLevel, support: ThinkingSupport): string {
  if (support.kind === "toggle" && level === "medium") return "on";
  return level;
}

export function thinkingDescription(level: ThinkingLevel): string {
  return DESCRIPTIONS[level];
}

const cache = new Map<string, Promise<ThinkingSupport>>();

export function fetchThinkingSupport(providerId: string, model: string): Promise<ThinkingSupport> {
  if (!model) return Promise.resolve(NO_THINKING);
  const key = `${providerId}\u0000${model}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = window.api.llm.thinkingSupport(providerId, model).catch(() => NO_THINKING);
    cache.set(key, pending);
  }
  return pending;
}

/** What the active chat model can do with a thinking level. */
export function useThinkingSupport(): ThinkingSupport {
  const providerId = useSettingsStore((state) => state.settings?.activeProviderId ?? "");
  const model = useSettingsStore((state) => state.settings?.activeChatModel ?? "");
  const [support, setSupport] = useState<ThinkingSupport>(NO_THINKING);
  useEffect(() => {
    let live = true;
    void fetchThinkingSupport(providerId, model).then((result) => {
      if (live) setSupport(result);
    });
    return () => {
      live = false;
    };
  }, [providerId, model]);
  return support;
}

export function useThinkingLevel(): ThinkingLevel {
  return useSettingsStore((state) => state.settings?.chat.thinking ?? "auto");
}

let lastOn: ThinkingLevel = "medium";

/** Save the level for chat; say so when the model only has a nearer one. */
export async function setThinkingLevel(level: ThinkingLevel, support: ThinkingSupport): Promise<void> {
  const settings = useSettingsStore.getState().settings;
  if (!settings) return;
  if (level !== "off" && level !== "auto") lastOn = level;
  await useSettingsStore.getState().patch({ chat: { ...settings.chat, thinking: level } });
  const model = settings.activeChatModel || "This model";
  if (support.kind === "none" && level !== "auto") {
    toast.info(`${model} has no thinking switch; the setting applies when you pick a model that does.`);
  } else if (!support.levels.includes(level)) {
    const nearest = level === "off" ? (support.levels.includes("low") ? "low" : "auto") : support.kind === "toggle" ? "medium" : "auto";
    toast.info(`${model} only has thinking ${support.levels.map((entry) => thinkingLabel(entry, support)).join("/")} — using ${thinkingLabel(nearest, support)}.`);
  } else {
    toast.info(`Thinking: ${thinkingLabel(level, support)} — ${thinkingDescription(level).toLowerCase()}`);
  }
}

/** `/think` without a level: off, or back to the last level that was on. */
export function toggledLevel(current: ThinkingLevel, support: ThinkingSupport): ThinkingLevel {
  if (current !== "off") return support.levels.includes("off") || support.kind === "none" ? "off" : "low";
  return support.levels.includes(lastOn) ? lastOn : support.kind === "toggle" ? "medium" : "auto";
}

/** The chip cycles through the levels this model has. */
export function nextLevel(current: ThinkingLevel, support: ThinkingSupport): ThinkingLevel {
  const levels = support.levels.length > 1 ? support.levels : (["auto", "off"] as ThinkingLevel[]);
  const index = levels.indexOf(current);
  return levels[(index + 1) % levels.length] ?? "auto";
}
