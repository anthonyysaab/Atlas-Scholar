/**
 * Viewers that autosave register a flush per open tab, so closing the tab can write what is still
 * pending instead of asking about "unsaved changes".
 */
const flushers = new Map<string, () => Promise<void>>();

export function registerFlush(docId: string, flush: () => Promise<void>): () => void {
  flushers.set(docId, flush);
  return () => {
    if (flushers.get(docId) === flush) flushers.delete(docId);
  };
}

export function flushDoc(docId: string): Promise<void> {
  const flush = flushers.get(docId);
  return flush ? flush() : Promise.resolve();
}
