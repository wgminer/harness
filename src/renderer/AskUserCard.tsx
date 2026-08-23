import { useCallback, useMemo, useState } from "react";
import type { ToolCallDisplay } from "./chatHelpers";

export type AskUserOption = {
  label: string;
  description?: string;
};

export type AskUserQuestion = {
  question: string;
  header?: string;
  options: AskUserOption[];
  multiSelect?: boolean;
};

export type AskUserAnswers = Record<string, string | string[]>;

type AskUserPayload = {
  pending?: boolean;
  tool?: string;
  args?: { questions?: AskUserQuestion[] };
  pendingId?: string;
  answers?: AskUserAnswers;
  declined?: boolean;
};

function parseAskUserPayload(payload: unknown): AskUserPayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as AskUserPayload;
}

export function getAskUserToolCall(toolCalls?: ToolCallDisplay[]): ToolCallDisplay | null {
  if (!toolCalls?.length) return null;
  return toolCalls.find((tc) => tc.toolName === "ask_user") ?? null;
}

export function getAskUserQuestions(call: ToolCallDisplay): AskUserQuestion[] {
  const payload = parseAskUserPayload(call.payload);
  const questions = payload?.args?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.filter(
    (q) =>
      typeof q?.question === "string" &&
      q.question.trim().length > 0 &&
      Array.isArray(q.options) &&
      q.options.length >= 2,
  );
}

function formatAnswer(value: string | string[] | undefined): string {
  if (value == null) return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  return value.trim() || "—";
}

interface AskUserCardProps {
  call: ToolCallDisplay;
  interactive: boolean;
  onSubmit: (call: ToolCallDisplay, answers: AskUserAnswers) => void | Promise<void>;
  onDecline: (call: ToolCallDisplay) => void | Promise<void>;
}

export function AskUserCard({ call, interactive, onSubmit, onDecline }: AskUserCardProps) {
  const payload = parseAskUserPayload(call.payload);
  const questions = getAskUserQuestions(call);
  const answered = payload?.pending === false;
  const storedAnswers = payload?.answers;
  const declined = payload?.declined === true;

  const [selections, setSelections] = useState<Record<number, string[]>>(() => ({}));
  const [otherText, setOtherText] = useState<Record<number, string>>(() => ({}));
  const [otherActive, setOtherActive] = useState<Record<number, boolean>>(() => ({}));

  const toggleOption = useCallback((qIndex: number, label: string, multiSelect: boolean) => {
    setSelections((prev) => {
      const current = prev[qIndex] ?? [];
      if (multiSelect) {
        const next = current.includes(label)
          ? current.filter((x) => x !== label)
          : [...current, label];
        return { ...prev, [qIndex]: next };
      }
      return { ...prev, [qIndex]: [label] };
    });
    setOtherActive((prev) => ({ ...prev, [qIndex]: false }));
  }, []);

  const toggleOther = useCallback((qIndex: number, multiSelect: boolean) => {
    setOtherActive((prev) => {
      const nextActive = !prev[qIndex];
      if (nextActive && !multiSelect) {
        setSelections((s) => ({ ...s, [qIndex]: [] }));
      }
      return { ...prev, [qIndex]: nextActive };
    });
  }, []);

  const buildAnswers = useCallback((): AskUserAnswers => {
    const answers: AskUserAnswers = {};
    questions.forEach((q, index) => {
      const key = q.question.trim();
      if (otherActive[index]) {
        const custom = otherText[index]?.trim() ?? "";
        if (q.multiSelect) {
          const selected = selections[index] ?? [];
          answers[key] = custom ? [...selected, custom] : selected;
        } else {
          answers[key] = custom;
        }
        return;
      }
      const selected = selections[index] ?? [];
      answers[key] = q.multiSelect ? selected : (selected[0] ?? "");
    });
    return answers;
  }, [otherActive, otherText, questions, selections]);

  const canSubmit = useMemo(() => {
    if (!interactive || answered) return false;
    return questions.every((q, index) => {
      if (otherActive[index]) {
        return (otherText[index]?.trim() ?? "").length > 0;
      }
      const selected = selections[index] ?? [];
      return q.multiSelect ? selected.length > 0 : selected.length === 1;
    });
  }, [answered, interactive, otherActive, otherText, questions, selections]);

  if (questions.length === 0) return null;

  return (
    <div className="ask-user-card" data-testid="ask-user-card">
      {questions.map((q, index) => {
        const header = q.header?.trim();
        const answerDisplay = storedAnswers?.[q.question.trim()];
        return (
          <section key={`${q.question}-${index}`} className="ask-user-card__question">
            {header ? <span className="ask-user-card__header">{header}</span> : null}
            <p className="ask-user-card__prompt">{q.question}</p>
            {answered ? (
              <p className="ask-user-card__answer">
                {declined ? "Skipped" : formatAnswer(answerDisplay)}
              </p>
            ) : (
              <>
                <div className="ask-user-card__options" role="group" aria-label={q.question}>
                  {q.options.map((option) => {
                    const selected = (selections[index] ?? []).includes(option.label);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        className={[
                          "btn",
                          "ask-user-card__option",
                          selected ? "ask-user-card__option--selected" : null,
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={!interactive}
                        aria-pressed={selected}
                        onClick={() => toggleOption(index, option.label, !!q.multiSelect)}
                      >
                        <span className="ask-user-card__option-label">{option.label}</span>
                        {option.description ? (
                          <span className="ask-user-card__option-desc">{option.description}</span>
                        ) : null}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={[
                      "btn",
                      "ask-user-card__option",
                      otherActive[index] ? "ask-user-card__option--selected" : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!interactive}
                    aria-pressed={!!otherActive[index]}
                    onClick={() => toggleOther(index, !!q.multiSelect)}
                  >
                    Other
                  </button>
                </div>
                {otherActive[index] ? (
                  <input
                    type="text"
                    className="ask-user-card__other-input"
                    placeholder="Your answer…"
                    value={otherText[index] ?? ""}
                    disabled={!interactive}
                    onChange={(e) =>
                      setOtherText((prev) => ({ ...prev, [index]: e.target.value }))
                    }
                  />
                ) : null}
              </>
            )}
          </section>
        );
      })}
      {!answered && interactive ? (
        <div className="ask-user-card__actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => void onSubmit(call, buildAnswers())}
          >
            Submit
          </button>
          <button type="button" className="btn" onClick={() => void onDecline(call)}>
            Skip
          </button>
        </div>
      ) : null}
    </div>
  );
}
