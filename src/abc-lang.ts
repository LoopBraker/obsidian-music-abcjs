import { parser } from "./abc.grammar.js"
import { LRLanguage, LanguageSupport, syntaxTree } from "@codemirror/language"
import { styleTags, tags as t } from "@lezer/highlight"
import { autocompletion, CompletionContext } from "@codemirror/autocomplete"
import { linter, Diagnostic } from "@codemirror/lint"

// Import modular ABC definitions
import { validInfoKeys, infoFieldDefinitions, commonTimeSignatures } from "./abc-infofields"
import { validDirectives, directiveDefinitions } from "./abc-directives"
import {
  midiAttributes,
  midiAttributeDefinitions,
  validateMidiAttributeValue
} from "./abc-midi"
import {
  voiceAttributes,
  voiceAttributeDefinitions,
  validClefs,
  clefDefinitions,
  directionDefinitions,
  getVoiceAttributeConfig
} from "./abc-voices"
import {
  keyAttributes,
  keyAttributeDefinitions,
  getKeyAttributeConfig
} from "./abc-key"



// Add MIDI to directives set (special handling)
const allDirectives = new Set(validDirectives)
allDirectives.add("MIDI")

// Generate dynamic regex pattern for voice attributes with assignments
const voiceAttrPattern = voiceAttributes
  .filter(attr => attr.valueType === "assignment")
  .map(attr => `${attr.attribute}=\\w*`)
  .join("|")

// Generate dynamic regex pattern for key attributes with assignments
const keyAttrPattern = keyAttributes
  .filter(attr => attr.valueType === "assignment")
  .map(attr => `${attr.attribute}=\\w*`)
  .join("|")

// Build complete word matching regex (includes both voice and key attributes)
const wordMatchRegex = new RegExp(`%%\\w*|[A-Za-z]:?|${voiceAttrPattern}|${keyAttrPattern}|\\w+`)

// Autocompletion for directives and info keys
function abcCompletions(context: CompletionContext) {
  // 1. Attempt to match a word before cursor
  let word = context.matchBefore(wordMatchRegex)

  const line = context.state.doc.lineAt(context.pos)
  const lineText = context.state.doc.sliceString(line.from, context.pos)

  // 2. FIX: Handle the case where we are strictly after "%%MIDI " (with space)
  if (!word && /^%%MIDI\s+$/.test(lineText)) {
    word = { from: context.pos, to: context.pos, text: "" }
  }

  // 3. FIX: Handle the case where we are strictly after "M:" or "M: "
  if (!word && /^M:\s*$/.test(lineText)) {
    word = { from: context.pos, to: context.pos, text: "" }
  }

  // 4. FIX: Handle Voice (V:) or Key (K:) lines ending in space
  // This detects "V:ID " or "K:C ". 
  // The [VK] matches either V or K.
  // The .* ensures we have content (like a voice ID or Key Tonic) before the space.
  if (!word && /^[VK]:.*\s+$/.test(lineText)) {
    word = { from: context.pos, to: context.pos, text: "" }
  }

  if (!word) return null

  // ----------------------------------------------------------------
  // EXCLUSIVE GUARD: MIDI LINE
  // ----------------------------------------------------------------
  if (/^%%MIDI\b/.test(lineText)) {
    const textBeforeWord = context.state.doc.sliceString(line.from, word.from)
    const isMidiAttributeSlot = /^%%MIDI\s*$/.test(textBeforeWord)

    if (isMidiAttributeSlot || (word.text.match(/^\w*$/) && /^%%MIDI\s+/.test(lineText))) {
      return {
        from: word.from,
        options: midiAttributes.map(attr => ({
          label: attr.attribute,
          type: "property",
          info: attr.description
        }))
      }
    }
    return null
  }

  // ----------------------------------------------------------------
  // EXCLUSIVE GUARD: METER LINE (M:)
  // ----------------------------------------------------------------
  if (/^M:\s*/.test(lineText)) {
    const timeSigMatch = context.matchBefore(/[\w\/|]+/)
    const effectiveWord = timeSigMatch || word

    return {
      from: effectiveWord.from,
      options: commonTimeSignatures.map(sig => ({
        label: sig,
        type: "constant",
        info: "Time signature"
      }))
    }
  }

  const isInComment = /^%(?!%)/.test(lineText)
  // Requires non-whitespace content (\S) to exist after header
  const isInVoiceLine = /^V:\s*\S/.test(lineText)
  const isInKeyLine = /^K:\s*\S/.test(lineText)
  const isInAnyInfoLine = /^[A-Za-z]:\s+/.test(lineText)
  const lineStartsWithDirective = /^%%/.test(lineText)

  if (isInComment) return null

  // Complete directives starting with %%
  if (word.text.startsWith("%%") && !isInAnyInfoLine) {
    const partialDirective = word.text.slice(2).toLowerCase()
    const matchingDirectives = Array.from(allDirectives).filter(d =>
      d.toLowerCase().startsWith(partialDirective)
    )

    return {
      from: word.from,
      options: matchingDirectives.map(d => ({
        label: `%%${d}`,
        type: "keyword",
        info: directiveDefinitions[d] || (d === "MIDI" ? "MIDI playback instructions" : "ABC directive")
      }))
    }
  }

  // If in a V: line, suggest voice attributes
  // Check for empty word (cursor after space) OR currently typing identifier
  if (isInVoiceLine && (word.text.match(/^\w+$/) || word.text === "")) {
    return {
      from: word.from,
      options: voiceAttributes.map(attr => ({
        label: attr.attribute,
        type: "property",
        info: attr.description
      }))
    }
  }

  // If in a K: line, suggest key attributes
  // Check for empty word (cursor after space) OR currently typing identifier
  if (isInKeyLine && (word.text.match(/^\w+$/) || word.text === "")) {
    return {
      from: word.from,
      options: keyAttributes.map(attr => ({
        label: attr.attribute,
        type: "property",
        info: attr.description
      }))
    }
  }

  // Complete info keys ONLY at start of line
  const textBeforeWord = context.state.doc.sliceString(line.from, word.from)
  const isAtStartOfLine = /^\s*$/.test(textBeforeWord)
  const isInlineField = /\[$/.test(textBeforeWord)

  if (word.text.match(/^[A-Za-z]:?$/) && !isInAnyInfoLine && !lineStartsWithDirective && (isAtStartOfLine || isInlineField)) {
    return {
      from: word.from,
      options: Array.from(validInfoKeys).map(k => ({
        label: `${k}:`,
        type: "variable",
        info: infoFieldDefinitions[k] || "ABC info field"
      }))
    }
  }

  // Complete voice/key attribute values (e.g. clef=treble)
  // This handles the specific values AFTER the equals sign
  const attrMatch = word.text.match(/^(\w+)=/)
  if (attrMatch && (isInVoiceLine || isInKeyLine)) {
    const attrName = attrMatch[1]

    const config = isInVoiceLine
      ? voiceAttributes.find(attr => attr.attribute === attrName)
      : keyAttributes.find(attr => attr.attribute === attrName)

    if (config && config.validValues) {
      return {
        from: word.from,
        options: config.validValues.map(value => ({
          label: `${attrName}=${value}`,
          type: "property",
          info: `${config.description}: ${value}`
        }))
      }
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

      if (!allDirectives.has(keyword)) {
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

    // Check KeyKey tokens (K:)
    if (node.name === "KeyKey") {
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

    // Validate MIDI program range (0-127)
    if (node.name === "ProgramAssignment") {
      let numberNode = node.node.lastChild
      if (numberNode && numberNode.name === "MidiNumber") {
        const value = parseInt(view.state.doc.sliceString(numberNode.from, numberNode.to))
        if (value < 0 || value > 127) {
          diagnostics.push({
            from: numberNode.from,
            to: numberNode.to,
            severity: "error",
            message: `MIDI program must be between 0 and 127 (got ${value})`
          })
        }
      }
    }

    // Validate MIDI chordprog range (0-127)
    if (node.name === "ChordProgAssignment") {
      let numberNode = node.node.lastChild
      if (numberNode && numberNode.name === "MidiNumber") {
        const value = parseInt(view.state.doc.sliceString(numberNode.from, numberNode.to))
        if (value < 0 || value > 127) {
          diagnostics.push({
            from: numberNode.from,
            to: numberNode.to,
            severity: "error",
            message: `MIDI chordprog must be between 0 and 127 (got ${value})`
          })
        }
      }
    }

    // Validate transpose is integer (can be negative)
    if (node.name === "TransposeAssignment") {
      let numberNode = node.node.lastChild
      if (numberNode && numberNode.name === "MidiNumber") {
        const value = parseInt(view.state.doc.sliceString(numberNode.from, numberNode.to))
        if (!Number.isInteger(value)) {
          diagnostics.push({
            from: numberNode.from,
            to: numberNode.to,
            severity: "error",
            message: `May be positive or negative (got ${value})`
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

// Generate style tags dynamically from voice attributes and MIDI attributes
function generateStyleTags() {
  const tags: Record<string, any> = {
    // Core ABC syntax elements
    DirectiveKeyword: t.namespace,            // %%keyword
    MidiKeyword: t.keyword,                 // %%MIDI
    InfoKey: t.propertyName,                    // T:, 
    VoiceKey: t.keyword,                    // V
    KeyKey: t.keyword,                      // K
    TimeSignatureKey: t.propertyName,        // M

    // [Score]
    ComplexNote: t.content, // accidentals/octaves
    SimpleNoteCapital: t.content, // Simple notes (A, B, C) 
    SimpleNoteLower: t.content, // Simple notes (a, b, c)
    Annotation: t.string,
    Duration: t.number,  // Elements related to time modifications
    SymbolDecoration: t.comment,
    NamedDecoration: t.comment,
    Other: t.comment,

    // [Defaults]
    MidiNumber: t.number,
    Word: t.comment,
    SingleChar: t.content,
    AttributeValue: t.content,
    DirectiveArgs: t.content,
    BarComponent: t.comment,
    Slash: t.number,
    CommonTimeSignatures: t.content,
    // Comments
    Comment: t.lineComment,
    InlineComment: t.lineComment,
    CommentedDirective: t.lineComment,

    // Values and identifiers  
    InvalidValue: t.invalid,                // Invalid values - red

    // InfoLines
    "InfoVal/Rest": t.string,
    "InfoVal/Spacing": t.string,
    "InfoVal/SimpleNote": t.string,
    "InfoVal/MidiNumber": t.string,
    "InfoVal/Slash": t.string,
    "InfoVal/Word": t.string,
    "InfoVal/SingleChar": t.string,
    "InfoVal/BarComponent": t.string,
    "InfoVal/Annotation": t.string,
    "InfoVal/Duration": t.string,
    "InfoVal/ComplexNote": t.string,
    "InfoVal/Ornament": t.string,
    "InfoVal/SymbolDecoration": t.string,
    "InfoVal/SimpleNoteLower": t.string,
    "InfoVal/SimpleNoteCapital": t.string,

    // TimeSignatureLine
    "TimeSignatureLine/CommonTimeSignatures": t.number,

    // === VOICE LINE ===
    // 
    "VoiceLine/VoiceName/MidiNumber": t.string,
    "VoiceLine/VoiceName/Word": t.string,
    "VoiceLine/VoiceName/SimpleNoteCapital": t.string,
    "VoiceLine/VoiceName/SymbolDecoration": t.string,
    "VoiceLine/VoiceName/SingleChar": t.string,
    "VoiceLine/VoiceName/Slash": t.string,
    "VoiceLine/VoiceName/BarComponent": t.string,
    "VoiceLine/VoiceName/Annotation": t.string,
    "VoiceLine/VoiceName/Duration": t.string,
    "VoiceLine/VoiceName/ComplexNote": t.string,

    // === KEY LINE ===
    // 
    "KeyLine/KeyTonic/Word": t.string,
    "KeyLine/KeyTonic/Sharp": t.string,
    "KeyLine/KeyTonic/SimpleNoteCapital": t.string, // C, D, E
    "KeyLine/KeyTonic/KeyMode/Word": t.string, // #
    "KeyLine/KeyTonic/KeyMode/SingleChar": t.string, // #
    "KeyLine/KeyTonic/None": t.string, // none
    "KeyMode/SimpleNoteLower": t.string,
    "KeyTonic/SingleChar": t.string,

    // [MIDI]
    // ProgramAssignment: t.propertyName,
    "ProgramAssignment/SingleDigit": t.string,
    "ProgramAssignment/Digit": t.string,
    MidiProgram: t.propertyName,
    ChordProgAssignment: t.propertyName,
    ChannelAssignment: t.propertyName,
    // DrumAssignment: t.propertyName,
    "DrumAssignment/Drum": t.propertyName,
    "DrumAssignment/DrumSequence/DrumStrike": t.number,
    "DrumAssignment/DrumSequence/Rest": t.comment,
    "DrumAssignment/DrumSequence/Digit": t.number,
    GchordAssignment: t.propertyName,
    TransposeAssignment: t.propertyName,
    DrumOnKeyword: t.string,
    DrumOffKeyword: t.string,
    GchordOnKeyword: t.string,
    GchordOffKeyword: t.string,



    // [Assignments]
    // KEYS:  (PropertyName)
    "AssignmentKey/Word": t.propertyName,
    "AssignmentKey/SimpleNote": t.propertyName,
    "AssignmentKey/SingleChar": t.propertyName,
    "AssignmentKey/Annotation": t.propertyName,
    "AssignmentKey/Duration": t.propertyName,

    // VALUES:
    "AssignmentValue/Word": t.string,           // treble, bass, CD
    "AssignmentValue/SimpleNote": t.string,     // C (key signature)
    "AssignmentValue/SingleChar": t.string,     // H
    "AssignmentValue/MidiNumber": t.string,     // 120
    "AssignmentValue/Slash": t.string,          // 4 (length)
    "AssignmentValue/Annotation": t.string,     // some text
    "AssignmentValue/Duration": t.string,       // 1/4, 1/8
    "AssignmentValue/ComplexNote": t.string, // C#, Bb
    "AssignmentValue/SymbolDecoration": t.string, // ~, u, v


  }

  return tags
}

export const abcLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      styleTags(generateStyleTags())
    ]
  }),
  languageData: {
    commentTokens: { line: "%" }
  }
})

export function abc(extraCompletions: any[] = []) {
  return new LanguageSupport(abcLanguage, [
    autocompletion({ override: [abcCompletions, ...extraCompletions] }),
    abcLinter
  ])
}
