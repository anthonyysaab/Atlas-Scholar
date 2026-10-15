import { registerAnnotationsIpc } from "./annotations";
import { registerBrowserIpc } from "./browser";
import { registerDocIpc } from "./doc";
import { registerFileIpc } from "./file";
import { registerFlashcardsIpc } from "./flashcards";
import { registerHealthIpc } from "./health";
import { registerLinksIpc } from "./links";
import { registerLlmIpc } from "./llm";
import { registerOnboardingIpc } from "./onboarding";
import { registerProvidersIpc } from "./providers";
import { registerRagIpc } from "./rag";
import { registerSettingsIpc } from "./settings";
import { registerStubIpc } from "./stubs";
import { registerThreadsIpc } from "./threads";
import { registerUpdateIpc } from "./update";
import { registerWorkspaceIpc } from "./workspace";

export function registerIpcHandlers(): void {
  registerFileIpc();
  registerSettingsIpc();
  registerProvidersIpc();
  registerLlmIpc();
  registerThreadsIpc();
  registerDocIpc();
  registerAnnotationsIpc();
  registerRagIpc();
  registerHealthIpc();
  registerOnboardingIpc();
  registerUpdateIpc();
  registerBrowserIpc();
  registerWorkspaceIpc();
  registerFlashcardsIpc();
  registerLinksIpc();
  registerStubIpc();
}
