import {parser} from "./abc.grammar.js"
import {LRLanguage, LanguageSupport} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"

export const abcLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags({
        Comment: t.lineComment,                 // % comments - gray italic
        CommentedDirective: t.lineComment,      // %%% commented directives - gray italic
        Directive: t.keyword,                   // %% directives - purple/magenta like keywords
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
