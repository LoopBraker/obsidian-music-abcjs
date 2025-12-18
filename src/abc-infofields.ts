/**
 * ABC Info Fields Definitions
 * Standard ABC notation info field keys, descriptions, and examples.
 */

export interface InfoFieldConfig {
  key: string
  description: string
  example: string
  required?: boolean
}

// The master configuration list
export const infoFields: InfoFieldConfig[] = [
  {
    key: "X",
    description: "Reference number (Required, must be at start of tune)",
    example: "X:1",
    required: true
  },
  {
    key: "T",
    description: "Title (Required, second field)",
    example: "T:The Irish Washerwoman",
    required: true
  },
  {
    key: "K",
    description: "Key signature (Required, end of header)",
    example: "K:G",
    required: true
  },
  {
    key: "M",
    description: "Meter / Time signature",
    example: "M:4/4"
  },
  {
    key: "L",
    description: "Default note length",
    example: "L:1/8"
  },
  {
    key: "Q",
    description: "Tempo",
    example: "Q:1/4=120"
  },
  {
    key: "V",
    description: "Voice definition",
    example: "V:1 name=\"Violin\" clef=treble"
  },
  {
    key: "C",
    description: "Composer",
    example: "C:Turlough O'Carolan"
  },
  {
    key: "R",
    description: "Rhythm type",
    example: "R:Reel"
  },
  {
    key: "A",
    description: "Area or region of origin",
    example: "A:Donegal, Ireland"
  },
  {
    key: "B",
    description: "Book or source collection",
    example: "B:O'Neill's Music of Ireland"
  },
  {
    key: "D",
    description: "Discography",
    example: "D:The Chieftains 4"
  },
  {
    key: "F",
    description: "File URL",
    example: "F:http://example.com/tune.abc"
  },
  {
    key: "G",
    description: "Group",
    example: "G:Flute"
  },
  {
    key: "H",
    description: "History",
    example: "H:Composed in 1892..."
  },
  {
    key: "I",
    description: "Instruction / Directive",
    example: "I:score (1 2)"
  },
  {
    key: "m",
    description: "Macro definition",
    example: "m: ~n2 = (3n/o/n/"
  },
  {
    key: "N",
    description: "Notes",
    example: "N:Play slowly with feeling"
  },
  {
    key: "O",
    description: "Origin",
    example: "O:Irish"
  },
  {
    key: "P",
    description: "Parts order",
    example: "P:AAB"
  },
  {
    key: "S",
    description: "Source",
    example: "S:Collected by..."
  },
  {
    key: "s",
    description: "Symbol definition",
    example: "s: !segno!"
  },
  {
    key: "U",
    description: "User-defined symbol",
    example: "U: T = !trill!"
  },
  {
    key: "W",
    description: "Words (lyrics block at end of tune)",
    example: "W:These are the lyrics..."
  },
  {
    key: "w",
    description: "Words (lyrics aligned with notes)",
    example: "w:ly-rics a-ligned"
  },
  {
    key: "Z",
    description: "Transcription notes",
    example: "Z:Transcribed by John Doe"
  }
]

// --- Derived Exports (For Backward Compatibility & Quick Lookup) ---

// Valid ABC info keys (Set for validation)
export const validInfoKeys = new Set(infoFields.map(f => f.key))

// Info Field Definitions (Record for lookup)
export const infoFieldDefinitions: Record<string, string> = infoFields.reduce(
  (acc, field) => {
    acc[field.key] = field.description
    return acc
  },
  {} as Record<string, string>
)

// Common time signatures for M: field
export const commonTimeSignatures = [
  "4/4", "3/4", "2/4", "6/8", "12/8", "2/2", "C", "C|", "none"
]

// Helper to check if a key is valid
export function isValidInfoKey(key: string): boolean {
  return validInfoKeys.has(key)
}

// Helper to get info field description
export function getInfoFieldDescription(key: string): string {
  return infoFieldDefinitions[key] || "ABC info field"
}

// Helper to get full config
export function getInfoFieldConfig(key: string): InfoFieldConfig | undefined {
  return infoFields.find(f => f.key === key)
}