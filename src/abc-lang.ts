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

  "score","percmap",


])

// Valid ABC info keys (without : suffix)
const validInfoKeys = new Set([
    "A", "B", "C", "D", "F", "G", "H", "I", "K",
    "L", "M","m", "N", "O", "P", "Q", "R", "S","s", "T",
    "V", "W", "X", "Z", "w"
])

// Valid clef values for V: info line
const validClefs = new Set([
  "treble", "treble-8", "treble+8", "bass", "bass3",
  "alto4", "alto", "alto2", "alto1", "none", "perc"
])

// Valid note names for shift attribute (A through G)
const validShiftNotes = /^[A-G]+$/

// Autocompletion for directives and info keys
function abcCompletions(context: CompletionContext) {
  let word = context.matchBefore(/%%\w*|[A-Za-z]:?|clef=\w*|shift=\w*|stem=\w*|gstem=\w*|lyrics=\w*|dyn=\w*|\w+/)
  if (!word) return null
  
  // Check if we're in an info line (any line starting with X:)
  const line = context.state.doc.lineAt(context.pos)
  const lineText = context.state.doc.sliceString(line.from, context.pos)
  const isInVoiceLine = /^V:\s+/.test(lineText)
  const isInMidiLine = /^%%MIDI\s+/.test(lineText)
  const isInAnyInfoLine = /^[A-Za-z]:\s+/.test(lineText)
  
  // Check if MIDI line already has an attribute (only one allowed)
  const midiHasAttribute = /^%%MIDI\s+\w+/.test(lineText)
  
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
  
  // If in a %%MIDI line, suggest MIDI attributes (only if no attribute yet)
  if (isInMidiLine && !midiHasAttribute && word.text.match(/^\w+$/)) {
    const midiAttributes = [
      { label: "program", detail: "1-128" },
      { label: "channel", detail: "1-16" },
      { label: "drum", detail: "<value>" },
      { label: "transpose", detail: "<number>" },
      { label: "drumon", detail: "(standalone)" },
      { label: "drumoff", detail: "(standalone)" },
    ]
    
    return {
      from: word.from,
      options: midiAttributes.map(attr => ({
        label: attr.label,
        type: "property",
        detail: attr.detail,
        info: "MIDI attribute"
      }))
    }
  }
  
  // If in a V: line, suggest voice attributes instead of info keys
  if (isInVoiceLine && word.text.match(/^\w+$/)) {
    const voiceAttributes = [
      { label: "clef", detail: "=bass|treble|alto|..." },
      { label: "shift", detail: "=A-G" },
      { label: "stem", detail: "=up|down" },
      { label: "gstem", detail: "=auto|up|down" },
      { label: "lyrics", detail: "=auto|up|down" },
      { label: "dyn", detail: "=auto|up|down" },
      { label: "perc", detail: "(standalone)" },
      { label: "up", detail: "(standalone)" },
      { label: "down", detail: "(standalone)" },
      { label: "merge", detail: "(standalone)" },
    ]
    
    return {
      from: word.from,
      options: voiceAttributes.map(attr => ({
        label: attr.label,
        type: "property",
        detail: attr.detail,
        info: "Voice attribute"
      }))
    }
  }
  
  // Complete info keys ONLY at start of line (not if already in an info line)
  if (word.text.match(/^[A-Za-z]:?$/) && !isInAnyInfoLine) {
    return {
      from: word.from,
      options: Array.from(validInfoKeys).map(k => ({ 
        label: `${k}:`, 
        type: "variable",
        info: "ABC info field"
      }))
    }
  }
  
  // Complete clef values
  if (word.text.startsWith("clef=")) {
    return {
      from: word.from,
      options: Array.from(validClefs).map(c => ({ 
        label: `clef=${c}`, 
        type: "property",
        info: "Clef type"
      }))
    }
  }
  
  // Complete shift attribute
  if (word.text.startsWith("shift=")) {
    return {
      from: word.from,
      options: ["A", "B", "C", "D", "E", "F", "G"].map(n => ({ 
        label: `shift=${n}`, 
        type: "property",
        info: "Shift note"
      }))
    }
  }
  
  // Complete stem attribute
  if (word.text.startsWith("stem=")) {
    return {
      from: word.from,
      options: ["auto", "up", "down"].map(s => ({ 
        label: `stem=${s}`, 
        type: "property",
        info: "Stem direction"
      }))
    }
  }
  
  // Complete gstem attribute
  if (word.text.startsWith("gstem=")) {
    return {
      from: word.from,
      options: ["auto", "up", "down"].map(s => ({ 
        label: `gstem=${s}`, 
        type: "property",
        info: "Grace note stem direction"
      }))
    }
  }
  
  // Complete lyrics attribute
  if (word.text.startsWith("lyrics=")) {
    return {
      from: word.from,
      options: ["auto", "up", "down"].map(s => ({ 
        label: `lyrics=${s}`, 
        type: "property",
        info: "Lyrics position"
      }))
    }
  }
  
  // Complete dyn attribute
  if (word.text.startsWith("dyn=")) {
    return {
      from: word.from,
      options: ["auto", "up", "down"].map(s => ({ 
        label: `dyn=${s}`, 
        type: "property",
        info: "Dynamic marking position"
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
    
    // Check VoiceKey tokens (V:)
    if (node.name === "VoiceKey") {
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
    
    // Check MidiLine for multiple attributes (only one allowed)
    if (node.name === "MidiLine") {
      let contentCount = 0
      let cursor = node.node.cursor()
      cursor.firstChild() // Enter MidiLine
      
      do {
        if (cursor.node.name === "MidiContent") {
          contentCount++
          if (contentCount > 1) {
            diagnostics.push({
              from: cursor.node.from,
              to: cursor.node.to,
              severity: "error",
              message: "Only one MIDI attribute allowed per line"
            })
          }
        }
      } while (cursor.nextSibling())
    }
    
    // Validate MIDI program range (1-128)
    if (node.name === "ProgramAssignment") {
      let numberNode = node.node.lastChild
      if (numberNode && numberNode.name === "MidiNumber") {
        const value = parseInt(view.state.doc.sliceString(numberNode.from, numberNode.to))
        if (value < 1 || value > 128) {
          diagnostics.push({
            from: numberNode.from,
            to: numberNode.to,
            severity: "error",
            message: `MIDI program must be between 1 and 128 (got ${value})`
          })
        }
      }
    }
    
    // Validate MIDI channel range (1-16)
    if (node.name === "ChannelAssignment") {
      let numberNode = node.node.lastChild
      if (numberNode && numberNode.name === "MidiNumber") {
        const value = parseInt(view.state.doc.sliceString(numberNode.from, numberNode.to))
        if (value < 1 || value > 16) {
          diagnostics.push({
            from: numberNode.from,
            to: numberNode.to,
            severity: "error",
            message: `MIDI channel must be between 1 and 16 (got ${value})`
          })
        }
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
        MidiKeyword: t.keyword,                 // %%MIDI - purple
        InfoKey: t.typeName,                    // T:, M:, K: - blue
        VoiceKey: t.keyword,                    // V: - purple
        "ClefAssignment/Identifier": t.propertyName,  // "clef" - blue
        "ShiftAssignment/Identifier": t.propertyName, // "shift" - blue
        "StemAssignment/Identifier": t.propertyName,  // "stem" - blue
        "GstemAssignment/Identifier": t.propertyName, // "gstem" - blue
        "LyricsAssignment/Identifier": t.propertyName, // "lyrics" - blue
        "DynAssignment/Identifier": t.propertyName,   // "dyn" - blue
        "ProgramAssignment/Identifier": t.propertyName, // "program" - blue
        "ChannelAssignment/Identifier": t.propertyName, // "channel" - blue
        "DrumAssignment/Identifier": t.propertyName,    // "drum" - blue
        "TransposeAssignment/Identifier": t.propertyName, // "transpose" - blue
        "DrumOnKeyword/Identifier": t.propertyName,     // "drumon" - blue
        "DrumOffKeyword/Identifier": t.propertyName,    // "drumoff" - blue
        "PercKeyword/Identifier": t.propertyName,     // "perc" - blue
        "UpKeyword/Identifier": t.propertyName,       // "up" - blue
        "DownKeyword/Identifier": t.propertyName,     // "down" - blue
        "MergeKeyword/Identifier": t.propertyName,    // "merge" - blue
        MidiNumber: t.number,                   // MIDI numbers - orange
        ValidClef: t.atom,                      // "bass", "treble" - green/orange
        ValidShift: t.atom,                     // "A", "CD" - green/orange
        ValidStem: t.atom,                      // "up", "down" - green/orange
        ValidDirection: t.atom,                 // "auto", "up", "down" - green/orange
        InvalidValue: t.invalid,                // Invalid values - red
        Identifier: t.variableName,             // V1, V2, etc - default
        GenericAssignment: t.propertyName,      // other key=value
        AttributeValue: t.string,               // generic values
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
