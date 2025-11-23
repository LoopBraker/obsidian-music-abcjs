/**
 * CodeMirror Themes for ABC Editor
 * Provides theme switching capability
 */

import { EditorView } from '@codemirror/view';

// Solarized Light Theme
export const solarizedLight = EditorView.theme({
  "&": {
    backgroundColor: "#fdf6e3",
    color: "#657b83"
  },
  ".cm-content": {
    caretColor: "#657b83"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#657b83"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#eee8d5"
  },
  ".cm-panels": {
    backgroundColor: "#eee8d5",
    color: "#657b83"
  },
  ".cm-searchMatch": {
    backgroundColor: "#b58900",
    outline: "1px solid #93a1a1"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#cb4b16"
  },
  ".cm-activeLine": {
    backgroundColor: "#eee8d5"
  },
  ".cm-selectionMatch": {
    backgroundColor: "#eee8d5"
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#eee8d5",
    outline: "1px solid #93a1a1"
  },
  ".cm-gutters": {
    backgroundColor: "#eee8d5",
    color: "#93a1a1",
    border: "none"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#eee8d5"
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "#93a1a1"
  },
  ".cm-tooltip": {
    border: "1px solid #93a1a1",
    backgroundColor: "#fdf6e3"
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent"
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "#fdf6e3",
    borderBottomColor: "#fdf6e3"
  }
}, { dark: false });

// GitHub Light Theme
export const githubLight = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#24292e"
  },
  ".cm-content": {
    caretColor: "#24292e"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#24292e"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#c8e1ff"
  },
  ".cm-panels": {
    backgroundColor: "#f6f8fa",
    color: "#24292e"
  },
  ".cm-searchMatch": {
    backgroundColor: "#ffdf5d",
    outline: "1px solid #d1d5da"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#ffdf5d"
  },
  ".cm-activeLine": {
    backgroundColor: "#f6f8fa"
  },
  ".cm-selectionMatch": {
    backgroundColor: "#c8e1ff"
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#f6f8fa",
    outline: "1px solid #d1d5da"
  },
  ".cm-gutters": {
    backgroundColor: "#f6f8fa",
    color: "#6a737d",
    border: "none"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f6f8fa"
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "#6a737d"
  },
  ".cm-tooltip": {
    border: "1px solid #d1d5da",
    backgroundColor: "#ffffff"
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent"
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "#ffffff",
    borderBottomColor: "#ffffff"
  }
}, { dark: false });

// Solarized Dark Theme
export const solarizedDark = EditorView.theme({
  "&": {
    backgroundColor: "#002b36",
    color: "#839496"
  },
  ".cm-content": {
    caretColor: "#839496"
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#839496"
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#073642"
  },
  ".cm-panels": {
    backgroundColor: "#073642",
    color: "#839496"
  },
  ".cm-searchMatch": {
    backgroundColor: "#b58900",
    outline: "1px solid #586e75"
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "#cb4b16"
  },
  ".cm-activeLine": {
    backgroundColor: "#073642"
  },
  ".cm-selectionMatch": {
    backgroundColor: "#073642"
  },
  "&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "#073642",
    outline: "1px solid #586e75"
  },
  ".cm-gutters": {
    backgroundColor: "#073642",
    color: "#586e75",
    border: "none"
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#073642"
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    color: "#586e75"
  },
  ".cm-tooltip": {
    border: "1px solid #586e75",
    backgroundColor: "#002b36"
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent"
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "#002b36",
    borderBottomColor: "#002b36"
  }
}, { dark: true });
