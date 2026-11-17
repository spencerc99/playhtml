// ABOUTME: CodeMirror 6 theme for the playhtml playground editor. Matches the docs
// ABOUTME: code blocks: near-white card paper, Plex Mono, GitHub-light syntax colors.

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const palette = {
  bg: "#fffff9", // docs code paper (the homepage toy box color)
  surface: "#f4efe5", // gutter: the docs page paper
  text: "#24292e",
  textMuted: "#6a737d",
  border: "rgba(28, 28, 28, 0.12)",
  tag: "#22863a",
  attribute: "#6f42c1",
  string: "#032f62",
  keyword: "#d73a49",
  number: "#005cc5",
  cursor: "#c0373c",
  selection: "rgba(39, 75, 158, 0.16)",
  activeLine: "rgba(232, 166, 58, 0.1)",
};

export const playgroundTheme = EditorView.theme({
  "&": {
    color: palette.text,
    backgroundColor: palette.bg,
    fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-content": {
    caretColor: palette.cursor,
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: palette.cursor },
  ".cm-selectionBackground, ::selection": { backgroundColor: palette.selection },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: palette.selection },
  ".cm-gutters": {
    backgroundColor: palette.surface,
    color: palette.textMuted,
    border: "none",
    borderRight: `1px solid ${palette.border}`,
  },
  ".cm-activeLine": { backgroundColor: palette.activeLine },
  ".cm-activeLineGutter": { backgroundColor: palette.activeLine, color: palette.text },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 6px" },
  ".cm-scroller": { fontFamily: "inherit" },
}, { dark: false });

export const playgroundHighlight = HighlightStyle.define([
  { tag: t.tagName, color: palette.tag },
  { tag: t.attributeName, color: palette.attribute },
  { tag: t.attributeValue, color: palette.string },
  { tag: [t.string, t.special(t.string)], color: palette.string },
  { tag: [t.comment, t.lineComment, t.blockComment], color: palette.textMuted, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword], color: palette.keyword },
  { tag: [t.number, t.bool], color: palette.number },
  { tag: t.function(t.variableName), color: palette.attribute },
  { tag: t.variableName, color: palette.text },
  { tag: t.operator, color: palette.textMuted },
  { tag: t.punctuation, color: palette.textMuted },
  { tag: t.bracket, color: palette.textMuted },
  { tag: t.angleBracket, color: palette.textMuted },
  { tag: t.propertyName, color: palette.number },
  { tag: t.className, color: palette.attribute },
]);

export const playgroundSyntaxHighlighting = syntaxHighlighting(playgroundHighlight);
