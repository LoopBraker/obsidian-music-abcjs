/**
 * ABC Key Signature Definitions
 * K: (Key) info field attributes
 */

export interface KeyAttributeConfig {
  attribute: string
  description: string
  valueType: "assignment" | "standalone"
  validValues?: string[]
}

// Key attributes configuration strictly based on the provided manual text
export const keyAttributes: KeyAttributeConfig[] = [
  {
    attribute: "clef",
    description: "Set the clef type",
    valueType: "assignment",
    // Lists "G, g, C, c, F, f", "treble, alto, tenor, bass", "none", "perc", "P"
    validValues: [
      "treble", "alto", "tenor", "bass", "none", "perc", 
      "G", "g", "C", "c", "F", "f", "P"
    ]
  },
  {
    attribute: "octave",
    description: "Transposes the music by <number> octaves",
    valueType: "assignment"
  },
  {
    attribute: "transpose",
    description: "Transposes playback",
    valueType: "assignment"
  },
  {
    attribute: "t",
    description: "Transposes playback (alias for transpose)",
    valueType: "assignment"
  },
  {
    attribute: "stafflines",
    description: "Sets the number of lines of the associated staff",
    valueType: "assignment"
  },
  {
    attribute: "staffscale",
    description: "Sets the staff scale. Default 1, max 3, min 0.5",
    valueType: "assignment"
  },
  {
    attribute: "cue",
    description: "Sets the music scale to 0.7 (on) or 1.0 (off)",
    valueType: "assignment",
    validValues: ["on", "off"]
  },
  // Standalone modifiers explicitly listed in the manual: [+8] [-8] [^8] [ 8]
  {
    attribute: "+8",
    description: "Print 8 above the clef",
    valueType: "standalone"
  },
  {
    attribute: "-8",
    description: "Print 8 below the clef",
    valueType: "standalone"
  },
  {
    attribute: "^8",
    description: "Print 8 above the clef, and perform octave transposition",
    valueType: "standalone"
  },
  {
    attribute: "_8", // Matches the [ 8] (8 below) visual description
    description: "Print 8 below the clef, and perform octave transposition",
    valueType: "standalone"
  }
]

// Key Attribute Definitions (for quick lookup)
export const keyAttributeDefinitions: Record<string, string> = keyAttributes.reduce(
  (acc, attr) => {
    acc[attr.attribute] = attr.description
    return acc
  },
  {} as Record<string, string>
)

// Valid key attributes set
export const validKeyAttributes = new Set(
  keyAttributes.map(attr => attr.attribute)
)

// Valid clef values strictly based on the manual text
export const validClefs = new Set([
  "treble", "alto", "tenor", "bass", "none", "perc", 
  "G", "g", "C", "c", "F", "f", "P"
])

// Clef Definitions based strictly on manual descriptions
export const clefDefinitions: Record<string, string> = {
  "treble": "Treble clef",
  "alto": "Alto clef",
  "tenor": "Tenor clef",
  "bass": "Bass clef",
  "none": "No clef",
  "perc": "Percussion clef",
  "P": "Percussion clef",
  "G": "Treble clef",
  "g": "Treble clef",
  "C": "Alto clef",
  "c": "Alto clef",
  "F": "Bass clef",
  "f": "Bass clef"
}

// Helper to get key attribute config
export function getKeyAttributeConfig(attribute: string): KeyAttributeConfig | undefined {
  return keyAttributes.find(attr => attr.attribute === attribute)
}

// Helper to check if attribute is valid
export function isValidKeyAttribute(attribute: string): boolean {
  return validKeyAttributes.has(attribute)
}

// Helper to get key attribute description
export function getKeyAttributeDescription(attribute: string): string {
  return keyAttributeDefinitions[attribute] || "Key attribute"
}

// Helper to get clef description
export function getClefDescription(clef: string): string {
  return clefDefinitions[clef] || "Clef type"
}