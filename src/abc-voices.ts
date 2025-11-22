/**
 * ABC Voice Definitions
 * V: (Voice) info field attributes and configurations
 */

export interface VoiceAttributeConfig {
  attribute: string
  description: string
  valueType: "assignment" | "standalone"
  validValues?: string[]
}

// Voice attributes configuration
export const voiceAttributes: VoiceAttributeConfig[] = [
  {
    attribute: "clef",
    description: "Set the clef (treble, bass, alto, etc.)",
    valueType: "assignment",
    validValues: ["treble", "treble-8", "treble+8", "bass", "bass3", "alto4", "alto", "alto2", "alto1", "none", "perc"]
  },
  {
    attribute: "shift",
    description: "Transpose by note name (A-G)",
    valueType: "assignment",
    validValues: ["A", "B", "C", "D", "E", "F", "G"]
  },
  {
    attribute: "stem",
    description: "Force stem direction (up, down, auto)",
    valueType: "assignment",
    validValues: ["auto", "up", "down"]
  },
  {
    attribute: "gstem",
    description: "Grace note stem direction (up, down, auto)",
    valueType: "assignment",
    validValues: ["auto", "up", "down"]
  },
  {
    attribute: "lyrics",
    description: "Lyrics position (up, down, auto)",
    valueType: "assignment",
    validValues: ["auto", "up", "down"]
  },
  {
    attribute: "dyn",
    description: "Dynamics position (up, down, auto)",
    valueType: "assignment",
    validValues: ["auto", "up", "down"]
  },
  {
    attribute: "perc",
    description: "Percussion staff (no pitch)",
    valueType: "standalone"
  },
  {
    attribute: "up",
    description: "Stems up",
    valueType: "standalone"
  },
  {
    attribute: "down",
    description: "Stems down",
    valueType: "standalone"
  },
  {
    attribute: "merge",
    description: "Merge with previous voice",
    valueType: "standalone"
  }
]

// Voice Attribute Definitions (for quick lookup)
export const voiceAttributeDefinitions: Record<string, string> = voiceAttributes.reduce(
  (acc, attr) => {
    acc[attr.attribute] = attr.description
    return acc
  },
  {} as Record<string, string>
)

// Valid voice attributes set
export const validVoiceAttributes = new Set(
  voiceAttributes.map(attr => attr.attribute)
)

// Valid clef values
export const validClefs = new Set([
  "treble", "treble-8", "treble+8", "bass", "bass3",
  "alto4", "alto", "alto2", "alto1", "none", "perc"
])

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

// Helper to get voice attribute config
export function getVoiceAttributeConfig(attribute: string): VoiceAttributeConfig | undefined {
  return voiceAttributes.find(attr => attr.attribute === attribute)
}

// Helper to check if attribute is valid
export function isValidVoiceAttribute(attribute: string): boolean {
  return validVoiceAttributes.has(attribute)
}

// Helper to get voice attribute description
export function getVoiceAttributeDescription(attribute: string): string {
  return voiceAttributeDefinitions[attribute] || "Voice attribute"
}

// Helper to get clef description
export function getClefDescription(clef: string): string {
  return clefDefinitions[clef] || "Clef type"
}

// Helper to get direction description
export function getDirectionDescription(direction: string): string {
  return directionDefinitions[direction] || direction
}
