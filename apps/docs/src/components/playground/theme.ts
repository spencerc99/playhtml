// ABOUTME: CodeMirror 6 theme for the playhtml playground editor.
// ABOUTME: Tuned to the docs paper-and-ink palette (ultramarine / mustard / brick / sage).
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Mirrors the docs design tokens from apps/docs/src/styles/docs-extras.css.
// Kept as plain hex constants here (not CSS vars) so the CodeMirror theme
// resolves consistently — CM6's internal style tracking doesn't always
// recompute when CSS custom properties change.
const palette = {
  bg: "#f4efe5",        // --ph-paper
  surface: "#ebe4d5",   // --ph-paper-warm
  text: "#1c1c1c",      // --ph-ink
  textMuted: "#6a6a66", // --ph-ink-3
  border: "rgba(28, 28, 28, 0.18)", // --ph-hairline
  borderSoft: "rgba(28, 28, 28, 0.09)", // --ph-hairline-soft
  ultramarine: "#274b9e",
  mustard: "#e8a63a",
  brick: "#c0373c",
  sage: "#7a9574",       // --ph-sage-deep
  selection: "rgba(39, 75, 158, 0.14)", // ultramarine wash
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
    caretColor: palette.brick,
    padding: "12px 0",
  },
  ".cm-cursor": { borderLeftColor: palette.brick },
  ".cm-selectionBackground, ::selection": { backgroundColor: palette.selection },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: palette.selection },
  ".cm-gutters": {
    backgroundColor: palette.surface,
    color: palette.textMuted,
    border: "none",
    borderRight: `1px solid ${palette.borderSoft}`,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  ".cm-activeLine": { backgroundColor: "rgba(232, 166, 58, 0.08)" }, // mustard wash
  ".cm-activeLineGutter": { backgroundColor: "rgba(232, 166, 58, 0.16)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 10px 0 8px" },
  ".cm-scroller": { fontFamily: "inherit" },
  ".cm-foldGutter .cm-gutterElement": { color: palette.textMuted },
}, { dark: false });

export const playgroundHighlight = HighlightStyle.define([
  // Tag names get ultramarine (the docs site's primary accent)
  { tag: t.tagName, color: palette.ultramarine, fontWeight: "600" },
  // Attribute names get brick (the docs site's "warning / important" accent)
  { tag: t.attributeName, color: palette.brick },
  // Attribute values get sage-deep — quieter than the names
  { tag: t.attributeValue, color: palette.sage },
  { tag: [t.string, t.special(t.string)], color: palette.sage },
  { tag: [t.comment, t.lineComment, t.blockComment], color: palette.textMuted, fontStyle: "italic" },
  { tag: [t.keyword, t.controlKeyword], color: palette.brick, fontWeight: "600" },
  { tag: [t.number, t.bool], color: palette.mustard },
  { tag: t.function(t.variableName), color: palette.ultramarine },
  { tag: t.variableName, color: palette.text },
  { tag: t.operator, color: palette.textMuted },
  { tag: t.punctuation, color: palette.textMuted },
  { tag: t.bracket, color: palette.textMuted },
  { tag: t.angleBracket, color: palette.textMuted },
  { tag: t.propertyName, color: palette.brick },
  { tag: t.className, color: palette.ultramarine },
]);

export const playgroundSyntaxHighlighting = syntaxHighlighting(playgroundHighlight);
