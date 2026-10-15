import type { LinkInput, Thread } from "@shared/types";
import { resolveWikiAnchors } from "@shared/links/anchors";
import { stripThink } from "./think";

type ThreadMessage = Thread["messages"][number];

function userBefore(thread: Thread, messageId: string): ThreadMessage | undefined {
  const index = thread.messages.findIndex((message) => message.id === messageId);
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = thread.messages[i];
    if (message?.role === "user") return message;
  }
  return undefined;
}

function answerAfter(thread: Thread, messageId: string): ThreadMessage | undefined {
  const index = thread.messages.findIndex((message) => message.id === messageId);
  return thread.messages.slice(index + 1).find((message) => message.role === "assistant");
}

/**
 * Link inputs for one message's [[concepts]]. A user's links anchor to their highlighted passage,
 * else to the answer's first source; an answer's links anchor to the excerpts cited next to them.
 */
export function wikiInputsForMessage(
  thread: Thread,
  message: ThreadMessage,
  docPath: string,
  onlyNames?: readonly string[]
): LinkInput[] {
  const origin = { threadId: thread.id, messageId: message.id };
  if (message.role === "user") {
    const answer = answerAfter(thread, message.id);
    return resolveWikiAnchors({
      content: message.content,
      ...(message.quote ? { quote: message.quote } : {}),
      ...(answer?.citations ? { fallbackCitations: answer.citations } : {}),
      threadDocPath: docPath,
      source: "wikilink",
      origin,
      ...(onlyNames ? { onlyNames } : {})
    });
  }
  const question = userBefore(thread, message.id);
  return resolveWikiAnchors({
    content: stripThink(message.content),
    ...(message.citations ? { citations: message.citations } : {}),
    ...(question?.quote ? { quote: question.quote } : {}),
    threadDocPath: docPath,
    source: "chat",
    origin,
    ...(onlyNames ? { onlyNames } : {})
  });
}

/** What a finished turn commits: the user's own links always, the model's only when allowed. */
export function wikiInputsForTurn(thread: Thread, assistantId: string, docPath: string, commitModel: boolean): LinkInput[] {
  const answer = thread.messages.find((message) => message.id === assistantId);
  if (!answer) return [];
  const question = userBefore(thread, assistantId);
  return [
    ...(question ? wikiInputsForMessage(thread, question, docPath) : []),
    ...(commitModel ? wikiInputsForMessage(thread, answer, docPath) : [])
  ];
}
