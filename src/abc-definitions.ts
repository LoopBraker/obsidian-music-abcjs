/**
 * ABC Notation Definitions
 * Descriptions for info fields, directives, and attributes
 * Used for autocompletion hints and documentation
 */

// Info Field Definitions
export const infoFieldDefinitions: Record<string, string> = {
  "A": "Area or region of origin",
  "B": "Book or source",
  "C": "Composer",
  "D": "Discography",
  "F": "File URL",
  "G": "Group",
  "H": "History",
  "I": "Instruction (for software) Example: I:score (1 2)",
  "K": "Key signature (required)",
  "L": "Default note length (e.g., 1/4, 1/8)",
  "M": "Meter/time signature (e.g., 4/4, 3/4, C)",
  "m": "Macro definition",
  "N": "Notes",
  "O": "Origin",
  "P": "Parts order",
  "Q": "Tempo (e.g., 1/4=120)",
  "R": "Rhythm type",
  "S": "Source",
  "s": "Symbol definition",
  "T": "Title (required)",
  "V": "The V: field, followed by a voice name, indicates that the following music belongs to that voice. The voice name can be a number or a string (e.g. “Tenor”). The V: field can be written on a line by itself, or enclosed in square brackets at the start of a note line.",
  "W": "Words (lyrics after tune)",
  "w": "Words (lyrics aligned with notes)",
  "X": "Reference number (required)",
  "Z": "Transcription notes"
}

// Directive Definitions
export const directiveDefinitions: Record<string, string> = {
  "MIDI": "MIDI playback instructions",
  
  // Page format
  "pageheight": "%%pageheight ⟨length⟩: sets the page height to ⟨length⟩. Default: 11 inches; scope: page; not available in abc2svg. For European A4 paper, the right value is 29.7cm.",
  "pagewidth": "%%pagewidth ⟨length⟩: sets the page width to ⟨length⟩. Default: 8.5 inches; scope: page; not available in abc2svg. For European A4 paper, the right value is 21cm.",
  "topmargin": "%%topmargin⟨length⟩: sets the page top margin to⟨length⟩.Default:1cm;scope:page;",
  "botmargin": "%%botmargin ⟨length⟩ sets the page bottom margin to ⟨length⟩. Default: 1 cm; scope: page",
  "leftmargin": "%%leftmargin ⟨length⟩: sets the page left margin to ⟨length⟩. Default: 1.8 cm; scope: page, restart.",
  "rightmargin": "%%rightmargin ⟨length⟩: sets the page right margin to ⟨length⟩. Default: 1.8 cm; scope:page, restart.",
  "indent": "%%indent ⟨length⟩: sets the indentation for the first line or system to ⟨length⟩. Default: 0; scope: tune.",
  "landscape": "%%landscape ⟨logical⟩: if 1, sets the page layout as landscape. Default: 0; scope: page;",
  "staffwidth": "%%staffwidth ⟨length⟩: used as an alternative to the %%pageheight and %%pagewidth di- rectives. Default: none; scope: generation.",
  
  // Font directives
  "titlefont": "Font for the title",
  "subtitlefont": "Font for subtitles",
  "composerfont": "Font for composer name",
  "partsfont": "Font for part labels",
  "tempofont": "Font for tempo markings",
  "gchordfont": "Font for guitar chords",
  "headerfont": "Font for headers",
  "historyfont": "Font for history field",
  "footerfont": "Font for footers",
  "annotationfont": "Font for annotations",
  "infofont": "Font for info fields",
  "measurefont": "Font for measure numbers",
  "repeatfont": "Font for repeat marks",
  "textfont": "Font for text",
  "voicefont": "Font for voice labels",
  "vocalfont": "Font for vocal parts",
  "wordsfont": "Font for lyrics",
  "setfont-1": "Custom font 1",
  "setfont-2": "Custom font 2",
  "setfont-3": "Custom font 3",
  "setfont-4": "Custom font 4",
  
  // Spacing directives
  "topspace": "Space above tune",
  "titlespace": "Space after title",
  "titleleft": "Left-align title",
  "subtitlespace": "Space after subtitle",
  "textspace": "Space around text",
  "aligncomposer": "Align composer text",
  "musicspace": "Space above music",
  "composerspace": "Space after composer",
  "wordsspace": "Space around lyrics",
  "vocalspace": "Space for vocal parts",
  "infospace": "Space for info fields",
  "partsspace": "Space between parts",
  "staffsep": "Separation between staves",
  "sysstaffsep": "Separation between systems",
  "barsperstaff": "Number of bars per staff",
  "parskipfac": "Paragraph skip factor",
  "lineskipfac": "Line skip factor",
  "stretchstaff": "Stretch staff to fill width",
  "stretchlast": "Stretch last staff",
  "maxshrink": "Maximum staff shrinkage",
  "maxstaffsep": "Maximum staff separation",
  "maxsysstaffsep": "Maximum system separation",
  "newpage": "Force a new page",
  "scale": "Scale factor for entire tune",
  "staves": "Staff grouping",
  "vskip": "Vertical skip",
  "splittune": "Split tune across pages",
  
  // Measures/Bars
  "measurefirst": "Number of first measure",
  "barnumbers": "Show bar numbers",
  "measurenb": "Measure numbering interval",
  "measurebox": "Box around measure numbers",
  "setbarnb": "Set bar number",
  "contbarnb": "Continue bar numbering",
  "alignbars": "Align bars across staves",
  
  "score": "Score layout definition",
  "percmap": "Percussion mapping"
}

// Voice Attribute Definitions
export const voiceAttributeDefinitions: Record<string, string> = {
  "clef": "Set the clef (treble, bass, alto, etc.)",
  "shift": "Transpose by note name (A-G)",
  "stem": "Force stem direction (up, down, auto)",
  "gstem": "Grace note stem direction (up, down, auto)",
  "lyrics": "Lyrics position (up, down, auto)",
  "dyn": "Dynamics position (up, down, auto)",
  "perc": "Percussion staff (no pitch)",
  "up": "Stems up",
  "down": "Stems down",
  "merge": "Merge with previous voice"
}

// MIDI Attribute Definitions
export const midiAttributeDefinitions: Record<string, string> = {
  "program": "MIDI instrument number (0-127, 0=piano)",
  "chordprog": "MIDI instrument for chords (0-127)",
  "channel": "MIDI channel number (1-16)",
  "drum": "Drum channel/pattern",
  "gchord": "Guitar chord settings",
  "transpose": "Transpose by semitones",
  "drumon": "Enable drum channel",
  "drumoff": "Disable drum channel"
}

// Clef Definitions
export const clefDefinitions: Record<string, string> = {
  "treble": "Treble clef (G clef, standard for high notes)",
  "treble-8": "Treble clef down an octave",
  "treble+8": "Treble clef up an octave",
  "bass": "Bass clef (F clef, standard for low notes)",
  "bass3": "Bass clef on 3rd line",
  "alto": "Alto clef (C clef on 3rd line)",
  "alto4": "Alto clef on 4th line",
  "alto2": "Alto clef on 2nd line",
  "alto1": "Alto clef on 1st line",
  "none": "No clef (for percussion or rhythm)",
  "perc": "Percussion clef"
}

// Direction/Stem Definitions
export const directionDefinitions: Record<string, string> = {
  "auto": "Automatic positioning",
  "up": "Force upward",
  "down": "Force downward"
}
