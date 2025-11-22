import {parser} from "./abc.grammar.js"
import {LRLanguage, LanguageSupport} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"

export const abcLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        DirectiveKeyword: t.keyword,            // %%keyword - purple
        InfoKey: t.variableName,                // T:, M:, K: - purple/blue
        DirectiveArgs: t.string,                // arguments/values - green
        Comment: t.lineComment,                 // % comments - gray italic
        InlineComment: t.lineComment,           // % at end of line - gray italic
        CommentedDirective: t.lineComment,      // %%% commented directives - gray italic
      })
    ]
  }),
  languageData: {
    commentTokens: {line: "%"}
  }
})

export function abc() {
  return new LanguageSupport(abcLanguage)
}
