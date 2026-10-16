import { IPC } from "@shared/channels";
import { SidecarAnnotationStore } from "@main/annotations";
import { emitToRenderer } from "@main/events";
import { LinksStore } from "@main/links/store";
import { ThreadStore } from "@main/llm/threadStore";
import { FlashcardStore } from "@main/study/flashcards";
import { NotesStore } from "@main/notes/store";
import { WorkspaceStore } from "@main/workspace";
import { libraryScoped } from "./context";
import { hashFileMemo } from "./hash";

/** The open library's stores; each is rebuilt when another library opens. */
export const getLinksStore = libraryScoped(
  (ctx) =>
    new LinksStore(ctx.location("links"), {
      onChange: (event) => emitToRenderer(IPC.links.changed, event),
      hashFile: hashFileMemo,
      codec: ctx.codec
    })
);

export const getThreadStore = libraryScoped((ctx) => new ThreadStore(ctx.location("threads"), { codec: ctx.codec }));

export const getWorkspaceStore = libraryScoped((ctx) => new WorkspaceStore(ctx.location("workspace"), { codec: ctx.codec }));

export const getFlashcardStore = libraryScoped(
  (ctx) => new FlashcardStore(ctx.location("flashcards"), () => new Date(), { codec: ctx.codec })
);

export const getAnnotationStore = libraryScoped(
  (ctx) =>
    new SidecarAnnotationStore(ctx.location("externalAnnotations"), {
      codec: ctx.codec,
      ...(ctx.kind === "library" ? { libraryDir: ctx.location("annotations") } : {})
    })
);

export const getNotesStore = libraryScoped((ctx) => new NotesStore(ctx.location("notes"), { codec: ctx.codec }));
