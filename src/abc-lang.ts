import {parser} from "./abc.grammar.js"
import {LRLanguage, LanguageSupport, syntaxTree} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"
import {autocompletion, CompletionContext} from "@codemirror/autocomplete"
import {linter, Diagnostic} from "@codemirror/lint"

// Import modular ABC definitions
import { validInfoKeys, infoFieldDefinitions } from "./abc-infofields"
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
import {
  compAttributes,
  allCompComponents,
  validCompAttributes,
  isValidCompComponent,
  getAttributeForComponent
} from "./abc-comp"

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
  // In this case, 'word' is usually null because regex doesn't match space, 
  // but we want to trigger completion.
  if (!word && /^%%MIDI\s+$/.test(lineText)) {
    word = { from: context.pos, to: context.pos, text: "" }
  }

  if (!word) return null
  
  // ----------------------------------------------------------------
  // EXCLUSIVE GUARD: MIDI LINE
  // If the line starts with %%MIDI, we ONLY check for MIDI attributes.
  // We do NOT fall through to general directives.
  // ----------------------------------------------------------------
  if (/^%%MIDI\b/.test(lineText)) {
    // Check text BEFORE current word to see if we're in the attribute slot
    const textBeforeWord = context.state.doc.sliceString(line.from, word.from)
    const isMidiAttributeSlot = /^%%MIDI\s*$/.test(textBeforeWord)
    
    // Show suggestions if: right after %%MIDI with space, OR currently typing a word
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
    // Explicitly return NULL to prevent falling through to generic directives
    return null
  }
  
  const isInComment = /^%(?!%)/.test(lineText)  // Line starts with % but not %%
  const isInVoiceLine = /^V:\s*\S/.test(lineText)  // V: or V:X (with or without space)
  const isInKeyLine = /^K:\s*\S/.test(lineText)    // K: or K:C (with or without space)
  const isInAnyInfoLine = /^[A-Za-z]:\s+/.test(lineText)
  const lineStartsWithDirective = /^%%/.test(lineText)  // Line starts with directive
  
  // Don't suggest anything in comments
  if (isInComment) return null
  
  // Complete directives starting with %% (only if not already in an info line)
  // Match if currently typing a directive (%%word) or just typed %%
  if (word.text.startsWith("%%") && !isInAnyInfoLine) {
    // Extract what's been typed after %%
    const partialDirective = word.text.slice(2).toLowerCase()
    
    // Filter directives that match what's been typed so far
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
  
  // If in a V: line, suggest voice attributes instead of info keys
  if (isInVoiceLine && word.text.match(/^\w+$/)) {
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
  if (isInKeyLine && word.text.match(/^\w+$/)) {
    return {
      from: word.from,
      options: keyAttributes.map(attr => ({
        label: attr.attribute,
        type: "property",
        info: attr.description
      }))
    }
  }
  
  // COMP: line completion
  const isInCompLine = /^COMP:\s*/.test(lineText)
  if (isInCompLine && word.text.match(/^\w*$/)) {
    // Suggest both attributes and components
    const attributeOptions = compAttributes.map(attr => ({
      label: attr.attribute,
      type: "property",
      info: attr.description
    }))
    
    const componentOptions = Array.from(allCompComponents.entries()).map(([comp, def]) => ({
      label: comp,
      type: "constant",  // Use constant type for components
      info: def.description
    }))
    
    return {
      from: word.from,
      options: [...attributeOptions, ...componentOptions]
    }
  }
  
  // Complete info keys ONLY at start of line (not if already in an info line or directive line)
  if (word.text.match(/^[A-Za-z]:?$/) && !isInAnyInfoLine && !lineStartsWithDirective) {
    return {
      from: word.from,
      options: Array.from(validInfoKeys).map(k => ({ 
        label: `${k}:`, 
        type: "variable",
        info: infoFieldDefinitions[k] || "ABC info field"
      }))
    }
  }
  
  // Complete voice/key attribute values dynamically
  // Check if word matches any attribute with "=" (e.g., "clef=", "stem=", "name=")
  const attrMatch = word.text.match(/^(\w+)=/)
  if (attrMatch && (isInVoiceLine || isInKeyLine)) {
    const attrName = attrMatch[1]
    
    // Look for attribute in voice or key attributes depending on line type
    const config = isInVoiceLine 
      ? voiceAttributes.find(attr => attr.attribute === attrName)
      : keyAttributes.find(attr => attr.attribute === attrName)
    
    if (config && config.validValues) {
      // Generate completions for attributes with predefined valid values
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
    DirectiveKeyword: t.namespace,            // %%keyword - purple
    MidiKeyword: t.keyword,                 // %%MIDI - purple
    InfoKey: t.typeName,                    // T:, M:, etc - blue
    VoiceKey: t.keyword,                    // V: - purple
    KeyKey: t.keyword,                      // K: - purple
    CompKey: t.keyword,                     // COMP: - purple
    
    // COMP field elements
    CompAttribute: t.meta,                  // MusicNotes, Bar attributes - special color (cyan/meta)
    MusicNoteComponent: t.atom,             // A, B, C, D, E, F, G - special color (red/atom)
    BarComponent: t.punctuation,            // |, :, [, ] - special color (punctuation)
    
    // Values and identifiers  
    MidiNumber: t.number,                   // MIDI numbers - orange
    InvalidValue: t.invalid,                // Invalid values - red
    Identifier: t.string,             // V1, V2, etc - default
    
    // Voice attributes - green (attribute names)
    "GenericAssignment/Identifier": t.propertyName,
    
    // MIDI attributes - green (style the parent nodes directly)
    //define a variable to hold the t.value to change all at once
    ProgramAssignment: t.propertyName,
    ChordProgAssignment: t.propertyName,
    ChannelAssignment: t.propertyName,
    DrumAssignment: t.propertyName,
    GchordAssignment: t.propertyName,
    TransposeAssignment: t.propertyName,
    DrumOnKeyword: t.propertyName,
    DrumOffKeyword: t.propertyName,
    
    // Attribute values - blue
    AttributeValue: t.string,
    DirectiveArgs: t.string,
    
    // Comments
    Comment: t.lineComment,
    InlineComment: t.lineComment,
    CommentedDirective: t.lineComment,
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
    commentTokens: {line: "%"}
  }
})

export function abc() {
  return new LanguageSupport(abcLanguage, [
    autocompletion({ override: [abcCompletions] }),
    abcLinter
  ])
}
