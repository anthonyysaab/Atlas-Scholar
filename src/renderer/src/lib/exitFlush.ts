import { flushAllDocs } from "@renderer/viewer/flushRegistry";

type Flush = () => Promise<unknown> | void;

/**
 * Writers that hold changes back (debounced saves, a streaming reply) register here, so main can
 * have them write before the app closes, updates or Windows shuts down.
 */
const flushers = new Set<Flush>();

export function onExitFlush(flush: Flush): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export async function flushForExit(): Promise<void> {
  await Promise.allSettled([flushAllDocs(), ...[...flushers].map(async (flush) => flush())]);
}

let listening = false;

function listen(): void {
  if (listening || typeof window === "undefined" || !window.api?.events?.onFlushRequest) return;
  listening = true;
  window.api.events.onFlushRequest(({ requestId }) => {
    void flushForExit().finally(() => void window.api.workspace.flushed(requestId).catch(() => undefined));
  });
}

listen();
