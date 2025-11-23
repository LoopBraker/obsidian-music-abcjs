/**
 * ABC Info Fields Definitions
 * Standard ABC notation info field keys and their descriptions
 */

export interface InfoFieldConfig {
  key: string
  description: string
  required?: boolean
}

// Valid ABC info keys (without : suffix)
export const validInfoKeys = new Set([
  "A", "B", "C", "COMP", "D", "F", "G", "H", "I", "K",
  "L", "M", "m", "N", "O", "P", "Q", "R", "S", "s", "T", "U",
  "V", "W", "X", "Z", "w"
])

// Info Field Definitions with descriptions
export const infoFieldDefinitions: Record<string, string> = {
  "A": "Area or region of origin",
  "B": "Book or source",
  "C": "Composer",
  "COMP": "Composition field (multi-line with attributes and components)",
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
  "V": "The V: field, followed by a voice name, indicates that the following music belongs to that voice. The voice name can be a number or a string (e.g. \"Tenor\"). The V: field can be written on a line by itself, or enclosed in square brackets at the start of a note line.",
  "W": "Words (lyrics after tune)",
  "w": "Words (lyrics aligned with notes)",
  "X": "Reference number (required)",
  "Z": "Transcription notes"
}

// Helper to check if a key is valid
export function isValidInfoKey(key: string): boolean {
  return validInfoKeys.has(key)
}

// Helper to get info field description
export function getInfoFieldDescription(key: string): string {
  return infoFieldDefinitions[key] || "ABC info field"
}
