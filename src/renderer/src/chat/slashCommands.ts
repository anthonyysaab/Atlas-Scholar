import type { ChatScope, OpenDoc, ThinkingLevel, ThinkingSupport } from "@shared/types";
import { openSettings, requestReindex } from "@renderer/lib/commands";
import { linkSelection, openConceptGraph } from "@renderer/links/actions";
import { useAppStore } from "@renderer/state/appStore";
import { selectActiveThread, useChatStore } from "@renderer/state/chatStore";
import { useSettingsStore } from "@renderer/state/settingsStore";
import { toast } from "@renderer/state/toastStore";
import { addSelectionToFlashcards } from "@renderer/study/flashcardActions";
import { setThinkingLevel, thinkingDescription, thinkingLabel, toggledLevel } from "./thinking";

export type SlashSurface = "chat" | "links";

export interface LinksSlashActions {
  apply: () => void;
  discard: () => void;
  clear: () => void;
}

export interface SlashContext {
  surface: SlashSurface;
  doc: OpenDoc | null;
  thinking: { level: ThinkingLevel; support: ThinkingSupport };
  links?: LinksSlashActions;
}

export interface SlashArg {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  current?: boolean;
}

export interface SlashCommand {
  command: string;
  description: string;
  surfaces: SlashSurface[];
  /** Offered as a second menu once the command and a space are typed. */
  args?: (ctx: SlashContext) => SlashArg[];
  run: (ctx: SlashContext, arg?: string) => void;
}

export const NEXT_SCOPE: Record<ChatScope, ChatScope> = { document: "extended", extended: "library", library: "document" };

function setScope(next: ChatScope): void {
  const settings = useSettingsStore.getState().settings;
  void useSettingsStore.getState().patch({ chat: { ...(settings?.chat ?? { scope: next }), scope: next } });
}

export function toggleScope(): void {
  setScope(NEXT_SCOPE[useSettingsStore.getState().settings?.chat.scope ?? "document"]);
}

export function toggleStudy(doc: OpenDoc): void {
  const study = selectActiveThread(useChatStore.getState(), doc.id)?.study === true;
  useChatStore.getState().toggleStudy(doc.id);
  toast.info(study ? "Study mode off for this thread" : "Study mode on: answers will guide you step by step");
}

export async function indexDocument(doc: OpenDoc): Promise<void> {
  toast.info("Indexing document…");
  try {
    const status = await window.api.rag.index(doc.ref.path);
    if (status.state === "ready") {
      useChatStore.getState().clearNotice(doc.id);
      toast.success(`Indexed ${status.chunks} chunks`);
    } else if (status.state === "error") {
      toast.error(status.error ?? "Indexing failed");
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

const THINKING_ORDER: ThinkingLevel[] = ["auto", "off", "low", "medium", "high"];

function withDoc(run: (doc: OpenDoc) => void): (ctx: SlashContext) => void {
  return (ctx) => {
    if (ctx.doc) run(ctx.doc);
    else toast.info("Open a document first.");
  };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/think",
    description: "Thinking: /think toggles off/on, /think <level> sets it",
    surfaces: ["chat", "links"],
    args: ({ thinking }) =>
      THINKING_ORDER.filter((level) => thinking.support.kind !== "toggle" || level === "auto" || level === "off" || level === "medium").map(
        (level) => ({
          value: level === "medium" && thinking.support.kind === "toggle" ? "on" : level,
          label: thinkingLabel(level, thinking.support),
          description: thinkingDescription(level),
          current: thinking.level === level,
          disabled: thinking.support.kind !== "none" && !thinking.support.levels.includes(level)
        })
      ),
    run: ({ thinking }, arg) => {
      const wanted = arg === "on" ? "medium" : (THINKING_ORDER.find((level) => level === arg) ?? null);
      if (arg && !wanted) {
        toast.error(`Unknown thinking level “${arg}”. Use auto, off, low, medium or high.`);
        return;
      }
      void setThinkingLevel(wanted ?? toggledLevel(thinking.level, thinking.support), thinking.support);
    }
  },
  {
    command: "/models",
    description: "Choose the model",
    surfaces: ["chat", "links"],
    run: () => useAppStore.getState().setModelPaletteOpen(true)
  },
  { command: "/new", description: "New thread", surfaces: ["chat"], run: withDoc((doc) => void useChatStore.getState().newThread(doc.id)) },
  {
    command: "/clear",
    description: "Clear this thread",
    surfaces: ["chat"],
    run: withDoc((doc) => useChatStore.getState().clearActiveThread(doc.id))
  },
  { command: "/index", description: "Index this document", surfaces: ["chat"], run: withDoc((doc) => void indexDocument(doc)) },
  { command: "/reindex", description: "Re-index this document", surfaces: ["chat"], run: () => void requestReindex() },
  {
    command: "/scope",
    description: "Cycle Doc only → Doc + outside → Library (all indexed PDFs)",
    surfaces: ["chat"],
    run: () => toggleScope()
  },
  {
    command: "/library",
    description: "Toggle library scope: answer from all your indexed PDFs",
    surfaces: ["chat"],
    run: () => setScope(useSettingsStore.getState().settings?.chat.scope === "library" ? "document" : "library")
  },
  { command: "/study", description: "Toggle study mode for this thread (guided tutoring)", surfaces: ["chat"], run: withDoc(toggleStudy) },
  { command: "/card", description: "Add the selected passage to the selection, to make cards from it", surfaces: ["chat"], run: () => addSelectionToFlashcards() },
  { command: "/link", description: "Link the selected passage to a concept or another PDF", surfaces: ["chat"], run: () => linkSelection() },
  {
    command: "/graph",
    description: "Open the concept graph",
    surfaces: ["chat", "links"],
    run: (ctx) => openConceptGraph(ctx.doc ? { docPath: ctx.doc.ref.path } : undefined)
  },
  {
    command: "/export",
    description: "Export thread to Markdown",
    surfaces: ["chat"],
    run: withDoc((doc) => {
      const threadId = useChatStore.getState().activeThreadByDoc[doc.id];
      if (!threadId) return;
      void useChatStore.getState().exportThread(doc.id, threadId).then((path) => {
        if (path) toast.success(`Exported thread to ${path}`);
      });
    })
  },
  { command: "/apply", description: "Apply the checked changes of the last proposal", surfaces: ["links"], run: (ctx) => ctx.links?.apply() },
  { command: "/discard", description: "Discard the last proposal", surfaces: ["links"], run: (ctx) => ctx.links?.discard() },
  { command: "/clear", description: "Clear this conversation", surfaces: ["links"], run: (ctx) => ctx.links?.clear() },
  { command: "/settings", description: "Open settings", surfaces: ["chat", "links"], run: () => openSettings() }
];

export function commandsFor(surface: SlashSurface): SlashCommand[] {
  return SLASH_COMMANDS.filter((entry) => entry.surfaces.includes(surface));
}

export interface SlashMenuEntry {
  key: string;
  label: string;
  description: string;
  disabled: boolean;
  current: boolean;
  /** Text the input takes on Tab. */
  completion: string;
  run: () => void;
}

export interface ParsedSlash {
  command: SlashCommand | null;
  name: string;
  arg: string | null;
}

/** "/think hi" → the /think command with the argument prefix "hi"; "/thi" → no argument yet. */
export function parseSlash(text: string, surface: SlashSurface): ParsedSlash | null {
  if (!text.startsWith("/")) return null;
  const match = /^\/(\S*)(?:\s+(\S*))?\s*$/.exec(text);
  if (!match) return null;
  const name = (match[1] ?? "").toLowerCase();
  const command = commandsFor(surface).find((entry) => entry.command === `/${name}`) ?? null;
  return { command, name, arg: match[2] === undefined ? null : match[2].toLowerCase() };
}

/** What the slash menu lists for the current input: commands, or a command's arguments. */
export function slashMenu(text: string, ctx: SlashContext): SlashMenuEntry[] {
  const parsed = parseSlash(text, ctx.surface);
  if (!parsed) return [];
  const typedSpace = /\s/.test(text);
  if (!typedSpace) {
    return commandsFor(ctx.surface)
      .filter((entry) => entry.command.slice(1).startsWith(parsed.name))
      .map((entry) => ({
        key: entry.command,
        label: entry.command,
        description: entry.description,
        disabled: false,
        current: false,
        completion: `${entry.command} `,
        run: () => entry.run(ctx)
      }));
  }
  const command = parsed.command;
  if (!command?.args) return [];
  const prefix = parsed.arg ?? "";
  return command
    .args(ctx)
    .filter((arg) => arg.value.startsWith(prefix))
    .map((arg) => ({
      key: `${command.command}:${arg.value}`,
      label: arg.label,
      description: arg.description ?? "",
      disabled: arg.disabled === true,
      current: arg.current === true,
      completion: `${command.command} ${arg.value}`,
      run: () => command.run(ctx, arg.value)
    }));
}

/** Run a fully typed command line; false when it is not a known command. */
export function runSlash(text: string, ctx: SlashContext): boolean {
  const parsed = parseSlash(text.trim(), ctx.surface);
  if (!parsed?.command) return false;
  parsed.command.run(ctx, parsed.arg ?? undefined);
  return true;
}
