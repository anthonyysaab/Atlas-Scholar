import { useDeferredValue, useState } from "react";
import { Markdown } from "@renderer/components/Markdown";

const MATH_HINT = /[$\\]/;

const fieldClass =
  "w-full resize-y rounded border border-border bg-bg px-2 py-1 text-xs text-text outline-none placeholder:text-text-weak focus:border-accent";

interface CardEditorProps {
  initialQuestion?: string;
  initialAnswer?: string;
  submitLabel: string;
  onSubmit: (question: string, answer: string) => void;
  onCancel: () => void;
}

/** Question/answer form shared by "new card" and "edit card". Ctrl+Enter submits, Escape cancels. */
export function CardEditor({ initialQuestion = "", initialAnswer = "", submitLabel, onSubmit, onCancel }: CardEditorProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState(initialAnswer);
  const valid = question.trim().length > 0 && answer.trim().length > 0;
  // Deferred so KaTeX re-renders lag behind typing instead of blocking it.
  const previewQuestion = useDeferredValue(question);
  const previewAnswer = useDeferredValue(answer);
  const showPreview = MATH_HINT.test(previewQuestion) || MATH_HINT.test(previewAnswer);

  const submit = (): void => {
    if (valid) onSubmit(question.trim(), answer.trim());
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-bg-subtle p-2" onKeyDown={onKeyDown}>
      <textarea
        autoFocus
        rows={2}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Question (Markdown; LaTeX in $...$ or $$...$$)"
        className={fieldClass}
      />
      <textarea
        rows={2}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        placeholder="Answer"
        className={fieldClass}
      />
      {showPreview ? (
        <div className="flex flex-col gap-1 rounded border border-dashed border-border px-2 py-1" aria-label="Preview">
          <span className="text-[10px] uppercase tracking-wide text-text-weak">Preview</span>
          {previewQuestion.trim() ? <Markdown content={previewQuestion} className="text-xs text-text" /> : null}
          {previewAnswer.trim() ? (
            <Markdown content={previewAnswer} className="border-t border-border pt-1 text-xs text-text-weak" />
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-1">
        <button type="button" onClick={onCancel} className="rounded px-2 py-0.5 text-xs text-text-weak hover:text-text">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="rounded border border-border px-2 py-0.5 text-xs text-text hover:bg-panel disabled:opacity-40"
          title="Ctrl+Enter"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
