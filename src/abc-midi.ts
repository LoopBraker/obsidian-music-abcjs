/**
 * ABC MIDI Directives
 * %%MIDI directive and its attributes for MIDI playback control
 */

export interface MidiAttributeConfig {
  attribute: string
  description: string
  valueType: "number" | "keyword" | "standalone"
  range?: { min: number; max: number }
  validValues?: string[]
}

// MIDI attributes configuration
export const midiAttributes: MidiAttributeConfig[] = [
  {
    attribute: "program",
    description: "MIDI instrument number (0-127, 0=piano)",
    valueType: "number",
    range: { min: 0, max: 127 }
  },
  {
    attribute: "chordprog",
    description: "MIDI instrument for chords (0-127)",
    valueType: "number",
    range: { min: 0, max: 127 }
  },
  {
    attribute: "channel",
    description: "MIDI channel number (1-16)",
    valueType: "number",
    range: { min: 1, max: 16 }
  },
  {
    attribute: "drum",
    description: "Drum channel/pattern",
    valueType: "keyword"
  },
  {
    attribute: "gchord",
    description: "Guitar chord settings",
    valueType: "keyword"
  },
  {
    attribute: "transpose",
    description: "Transpose by semitones",
    valueType: "number"
  },
  {
    attribute: "drumon",
    description: "Enable drum channel",
    valueType: "standalone"
  },
  {
    attribute: "drumoff",
    description: "Disable drum channel",
    valueType: "standalone"
  }
]

// MIDI Attribute Definitions (for quick lookup)
export const midiAttributeDefinitions: Record<string, string> = midiAttributes.reduce(
  (acc, attr) => {
    acc[attr.attribute] = attr.description
    return acc
  },
  {} as Record<string, string>
)

// Valid MIDI attributes set
export const validMidiAttributes = new Set(
  midiAttributes.map(attr => attr.attribute)
)

// Helper to get MIDI attribute config
export function getMidiAttributeConfig(attribute: string): MidiAttributeConfig | undefined {
  return midiAttributes.find(attr => attr.attribute === attribute)
}

// Helper to validate MIDI attribute value
export function validateMidiAttributeValue(
  attribute: string,
  value: number | string
): { valid: boolean; message?: string } {
  const config = getMidiAttributeConfig(attribute)
  
  if (!config) {
    return { valid: false, message: `Unknown MIDI attribute: ${attribute}` }
  }
  
  if (config.valueType === "number" && typeof value === "number") {
    if (config.range) {
      const { min, max } = config.range
      if (value < min || value > max) {
        return {
          valid: false,
          message: `${attribute} must be between ${min} and ${max} (got ${value})`
        }
      }
    }
  }
  
  return { valid: true }
}

// Helper to get MIDI attribute description
export function getMidiAttributeDescription(attribute: string): string {
  return midiAttributeDefinitions[attribute] || "MIDI attribute"
}
