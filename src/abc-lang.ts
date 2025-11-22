import {parser} from "./abc.grammar.js"
import {LRLanguage, LanguageSupport, syntaxTree} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"
import {autocompletion, CompletionContext} from "@codemirror/autocomplete"
import {linter, Diagnostic} from "@codemirror/lint"

// Valid ABC directives (without %% prefix)
const validDirectives = new Set([
  "MIDI",
  //Page format
  "pageheight", "pagewidth", "topmargin", "botmargin",
    "leftmargin", "rightmargin", "indent", "landscape",
    "staffwidth",
  // Font directives
  "titlefont", "subtitlefont", "composerfont", "partsfont", "tempofont",
  "gchordfont", "headerfont", "historyfont", "footerfont",
  "annotationfont", "infofont", "measurefont", "repeatfont",
  "textfont", "voicefont", "vocalfont", "wordsfont",
  // Inline font selectors (optional)
  "setfont-1", "setfont-2", "setfont-3", "setfont-4",

  // Spacing directives
  "topspace", "titlespace", "titleleft", "subtitlespace", "textspace",
  "aligncomposer", "musicspace", "composerspace", "wordsspace",
  "vocalspace", "infospace", "partsspace", "staffsep",
  "sysstaffsep", "barsperstaff", "parskipfac", "lineskipfac",
  "stretchstaff", "stretchlast", "maxshrink", "maxstaffsep",
  "maxsysstaffsep", "newpage", "scale", "staves", "vskip",
  "splittune",

  //Measures/Bars 
  "measurefirst", "barnumbers", "measurenb", "measurebox",
  "setbarnb","contbarnb","alignbars",


])

// Valid ABC info keys (without : suffix)
const validInfoKeys = new Set([
    "A", "B", "C", "D", "F", "G", "H", "I", "K",
    "L", "M","m", "N", "O", "P", "Q", "R", "S","s", "T",
    "V", "W", "X", "Z", "w"
])

// Autocompletion for directives and info keys
function abcCompletions(context: CompletionContext) {
  let word = context.matchBefore(/%%\w*|[A-Za-z]:?/)
  if (!word) return null
  
  // Complete directives starting with %%
  if (word.text.startsWith("%%")) {
    return {
      from: word.from,
      options: Array.from(validDirectives).map(d => ({ 
        label: `%%${d}`, 
        type: "keyword",
        info: "ABC directive"
      }))
    }
  }
  
  // Complete info keys at start of line
  if (word.text.match(/^[A-Za-z]:?$/)) {
    return {
      from: word.from,
      options: Array.from(validInfoKeys).map(k => ({ 
        label: `${k}:`, 
        type: "variable",
        info: "ABC info field"
      }))
    }
  }
  
  return null
}

// Linter to validate directives and info keys
const abcLinter = linter(view => {
  const diagnostics: Diagnostic[] = []
  const tree = syntaxTree(view.state)
  const doc = view.state.doc
  
  tree.cursor().iterate(node => {
    // Check DirectiveKeyword tokens
    if (node.name === "DirectiveKeyword") {
      const text = view.state.doc.sliceString(node.from, node.to)
      const keyword = text.slice(2).trim() // Remove %% and trim
      
      if (!validDirectives.has(keyword)) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "warning",
          message: `Unknown directive: %%${keyword}`
        })
      }
    }
    
    // Check InfoKey tokens
    if (node.name === "InfoKey") {
      const text = view.state.doc.sliceString(node.from, node.to)
      const key = text.slice(0, -1) // Remove :
      
      if (!validInfoKeys.has(key)) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "warning",
          message: `Unknown info key: ${key}:`
        })
      }
    }
  })
  
  // Check for blank lines (empty lines or lines with only whitespace)
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum)
    const lineText = doc.sliceString(line.from, line.to)
    
    // Check if line is empty or contains only whitespace
    if (lineText.trim() === "") {
      diagnostics.push({
        from: line.from,
        to: line.to === line.from ? line.to + 1 : line.to, // Ensure at least 1 char width
        severity: "error",
        message: "Blank lines are not allowed in ABC notation"
      })
    }
  }
  
  return diagnostics
})

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
  return new LanguageSupport(abcLanguage, [
    autocompletion({ override: [abcCompletions] }),
    abcLinter
  ])
}
