import { AnnotationsTab } from "./AnnotationsTab";
import { BookmarksTab } from "./BookmarksTab";
import { ChatTab } from "./ChatTab";
import { ContextTab } from "./ContextTab";
import { FlashcardsTab } from "./FlashcardsTab";
import { LinksTab } from "./LinksTab";
import { NotesTab } from "./NotesTab";
import { SearchTab } from "./SearchTab";
import { registerSidePanelTab } from "./sidePanelRegistry";

let registered = false;

export function registerDefaultSidePanelTabs(): void {
  if (registered) return;
  registered = true;
  registerSidePanelTab({ id: "chat", label: "Chat", order: 0, render: () => <ChatTab /> });
  registerSidePanelTab({ id: "annotations", label: "Annotations", order: 1, render: () => <AnnotationsTab /> });
  registerSidePanelTab({ id: "notes", label: "Notes", order: 1.5, render: () => <NotesTab /> });
  registerSidePanelTab({ id: "bookmarks", label: "Bookmarks", order: 2, render: () => <BookmarksTab /> });
  registerSidePanelTab({ id: "flashcards", label: "Cards", order: 3, render: () => <FlashcardsTab /> });
  registerSidePanelTab({ id: "links", label: "Links", order: 4, render: () => <LinksTab /> });
  registerSidePanelTab({ id: "context", label: "Context", order: 5, render: () => <ContextTab /> });
  registerSidePanelTab({ id: "search", label: "Search", order: 6, render: () => <SearchTab /> });
}
