// ABOUTME: CodeMirror 6 theme for the playhtml playground editor. Tuned to
// ABOUTME: match the dev panel's warm-linen + teal/rust/blue/gold palette.

// We deliberately use the dev panel's internal palette here (not the
// docs-extras tokens) so the editor and the dev panel inside the
// preview iframe feel like one coherent tool. The outer chrome (top
// bar, pane headers, buttons) follows the docs-extras design tokens —
// see playground.css. This file only owns the editor pane interior.
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const palette = {
  bg: "#faf7f2",        // warm linen
  surface: "#f5f0e8",   // aged paper
  text: "#3d3833",      // warm dark brown
  textMuted: "#8a8279",
  border: "#d4cfc7",
  accentTeal: "#4a9a8a",
  accentRust: "#c4724e",
  accentBlue: "#5b8db8",
  accentGold: "#d4b85c",
  selection: "rgba(74, 154, 138, 0.18)",
};

export const playgroundTheme = EditorView.theme({
  "&": {
    color: palette.text,
    backgroundColor: palette.bg,
    fontFamily: "'Martian Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-content": {
    caretColor: palette.accentRust,
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: palette.accentRust },
  ".cm-selectionBackground, ::selection": { backgroundColor: palette.selection },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: palette.selection },
  ".cm-gutters": {
    backgroundColor: palette.surface,
    color: palette.textMuted,
    border: "none",
    borderRight: `1px solid ${palette.border}`,
  },
  ".cm-activeLine": { backgroundColor: "rgba(74, 154, 138, 0.06)" },
  ".cm-activeLineGutter": { backgroundColor: "rgba(74, 154, 138, 0.10)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 6px" },
  ".cm-scroller": { fontFamily: "inherit" },
}, { dark: false });

export const playgroundHighlight = HighlightStyle.define([
  { tag: t.tagName, color: palette.accentTeal },
  { tag: t.attributeName, color: palette.accentRust },
  { tag: t.attributeValue, color: palette.accentBlue },
  { tag: [t.string, t.special(t.string)], color: palette.accentBlue },
  { tag: [t.comment, t.lineComment, t.blockComment], color: palette.textMuted, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword], color: palette.accentRust },
  { tag: [t.number, t.bool], color: palette.accentGold },
  { tag: t.function(t.variableName), color: palette.accentTeal },
  { tag: t.variableName, color: palette.text },
  { tag: t.operator, color: palette.textMuted },
  { tag: t.punctuation, color: palette.textMuted },
  { tag: t.bracket, color: palette.textMuted },
  { tag: t.angleBracket, color: palette.textMuted },
  { tag: t.propertyName, color: palette.accentRust },
  { tag: t.className, color: palette.accentTeal },
]);

export const playgroundSyntaxHighlighting = syntaxHighlighting(playgroundHighlight);
