// ABOUTME: CodeMirror 6 wrapper for the playground editor pane. HTML mode,
// ABOUTME: docs-palette theme, debounced onChange.
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { playgroundTheme, playgroundSyntaxHighlighting } from "./theme";

export type EditorProps = {
  /** Initial source. Changes to this prop after mount are ignored unless
      the `seedNonce` also changes — that's the signal "load a fresh
      document into the editor." */
  initialValue: string;
  /** Bumped externally to force a re-seed of the editor (e.g., after
      "discard draft" or remix navigation). */
  seedNonce: number;
  /** Called with the new source on every change, debounced 300ms. */
  onChange: (source: string) => void;
  /** Called with the new source on every change, NOT debounced (use for
      live preview reload triggers if needed). Optional. */
  onChangeImmediate?: (source: string) => void;
  /** When true, editor is uneditable. Default false. */
  readOnly?: boolean;
};

const DEBOUNCE_MS = 300;

export function Editor(props: EditorProps) {
  const {
    initialValue,
    seedNonce,
    onChange,
    onChangeImmediate,
    readOnly = false,
  } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Always read the latest callbacks via a ref so the EditorState's
  // updateListener doesn't capture stale closures.
  const onChangeRef = useRef(onChange);
  const onChangeImmediateRef = useRef(onChangeImmediate);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onChangeImmediateRef.current = onChangeImmediate;
  }, [onChangeImmediate]);

  // Mount / re-seed the EditorView when seedNonce changes.
  useEffect(() => {
    if (!hostRef.current) return;

    // Tear down any existing view (re-seed)
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        foldGutter(),
        indentOnInput(),
        highlightSelectionMatches(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...foldKeymap,
        ]),
        html({ matchClosingTags: true, autoCloseTags: true }),
        playgroundTheme,
        playgroundSyntaxHighlighting,
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const source = update.state.doc.toString();
          onChangeImmediateRef.current?.(source);
          if (debounceRef.current !== null) {
            window.clearTimeout(debounceRef.current);
          }
          debounceRef.current = window.setTimeout(() => {
            onChangeRef.current(source);
            debounceRef.current = null;
          }, DEBOUNCE_MS);
        }),
      ],
    });

    viewRef.current = new EditorView({ state, parent: hostRef.current });

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedNonce, readOnly]);

  return <div ref={hostRef} style={{ height: "100%", overflow: "hidden" }} />;
}
