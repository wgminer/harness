import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createNotesCodeEditorExtensions } from "./notesEditorExtensions";

export interface NotesCodeEditorHandle {
  focus: () => void;
  setSelection: (from: number, to?: number) => void;
  getView: () => EditorView | null;
  insertAtCursor: (text: string) => void;
}

interface NotesCodeEditorProps {
  value: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  "data-testid"?: string;
  "aria-label"?: string;
  onChange: (value: string) => void;
  onSelectionChange?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onScroll?: () => void;
}

export const NotesCodeEditor = forwardRef<NotesCodeEditorHandle, NotesCodeEditorProps>(function NotesCodeEditor(
  {
    value,
    placeholder: placeholderText,
    readOnly = false,
    className,
    "data-testid": testId,
    "aria-label": ariaLabel,
    onChange,
    onSelectionChange,
    onFocus,
    onBlur,
    onScroll,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const onFocusRef = useRef(onFocus);
  const onBlurRef = useRef(onBlur);
  const onScrollRef = useRef(onScroll);
  const syncingExternalValueRef = useRef(false);

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onFocusRef.current = onFocus;
  onBlurRef.current = onBlur;
  onScrollRef.current = onScroll;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      setSelection: (from: number, to = from) => {
        const view = viewRef.current;
        if (!view) return;
        const docLength = view.state.doc.length;
        const anchor = Math.max(0, Math.min(from, docLength));
        const head = Math.max(0, Math.min(to, docLength));
        view.dispatch({
          selection: { anchor, head },
          scrollIntoView: true,
        });
      },
      getView: () => viewRef.current,
      insertAtCursor: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          scrollIntoView: true,
        });
        view.focus();
      },
    }),
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: createNotesCodeEditorExtensions({
          placeholder: placeholderText,
          readOnly,
          onDocChange: (nextValue) => {
            if (syncingExternalValueRef.current) return;
            onChangeRef.current(nextValue);
          },
          onSelectionChange: () => onSelectionChangeRef.current?.(),
          onFocusChange: (focused) => {
            if (focused) onFocusRef.current?.();
            else onBlurRef.current?.();
          },
          onScroll: () => onScrollRef.current?.(),
        }),
      }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Initial doc comes from `value`; ongoing sync is handled in the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- remount editor only when chrome changes
  }, [placeholderText, readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    syncingExternalValueRef.current = true;
    const anchor = Math.min(view.state.selection.main.anchor, value.length);
    const head = Math.min(view.state.selection.main.head, value.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor, head },
    });
    syncingExternalValueRef.current = false;
  }, [value]);

  return (
    <div
      ref={hostRef}
      className={className}
      data-testid={testId}
      aria-label={ariaLabel}
      role="textbox"
      aria-multiline="true"
    />
  );
});
