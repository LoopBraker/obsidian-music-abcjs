/**
 * ABC MIDI Directives
 * %%MIDI directive and its attributes for MIDI playback control
 * Based on abc_parse_directive.js logic
 */

export interface MidiAttributeConfig {
  attribute: string
  description: string
  // Expanded types based on abcjs parser logic
  valueType: "number" | "string" | "standalone" | "composite" | "fraction"
  range?: { min: number; max: number }
  validValues?: string[]
  example?: string // Added example field
}

// MIDI attributes configuration
export const midiAttributes: MidiAttributeConfig[] = [
  // --- Standalone (No parameters) ---
  // Source: midiCmdParam0
  {
    attribute: "barlines",
    description: "Enable bar lines in playback",
    valueType: "standalone",
    example: "%%MIDI barlines"
  },
  {
    attribute: "nobarlines",
    description: "Disable bar lines in playback",
    valueType: "standalone",
    example: "%%MIDI nobarlines"
  },
  {
    attribute: "beataccents",
    description: "Enable beat accents (louder first beat)",
    valueType: "standalone",
    example: "%%MIDI beataccents"
  },
  {
    attribute: "nobeataccents",
    description: "Disable beat accents",
    valueType: "standalone",
    example: "%%MIDI nobeataccents"
  },
  {
    attribute: "droneon",
    description: "Enable drone accompaniment",
    valueType: "standalone",
    example: "%%MIDI droneon"
  },
  {
    attribute: "droneoff",
    description: "Disable drone",
    valueType: "standalone",
    example: "%%MIDI droneoff"
  },
  {
    attribute: "drumon",
    description: "Enable drum channel",
    valueType: "standalone",
    example: "%%MIDI drumon"
  },
  {
    attribute: "drumoff",
    description: "Disable drum channel",
    valueType: "standalone",
    example: "%%MIDI drumoff"
  },
  {
    attribute: "gchordon",
    description: "Enable guitar chords",
    valueType: "standalone",
    example: "%%MIDI gchordon"
  },
  {
    attribute: "gchordoff",
    description: "Disable guitar chords",
    valueType: "standalone",
    example: "%%MIDI gchordoff"
  },
  {
    attribute: "fermatafixed",
    description: "Fixed duration for fermatas",
    valueType: "standalone",
    example: "%%MIDI fermatafixed"
  },
  {
    attribute: "fermataproportional",
    description: "Proportional duration for fermatas",
    valueType: "standalone",
    example: "%%MIDI fermataproportional"
  },
  {
    attribute: "controlcombo",
    description: "Control combo",
    valueType: "standalone",
    example: "%%MIDI controlcombo"
  },
  {
    attribute: "temperamentnormal",
    description: "Set normal temperament (equal tuning)",
    valueType: "standalone",
    example: "%%MIDI temperamentnormal"
  },
  {
    attribute: "noportamento",
    description: "Disable portamento",
    valueType: "standalone",
    example: "%%MIDI noportamento"
  },

  // --- String Parameter ---
  // Source: midiCmdParam1String
  {
    attribute: "gchord",
    description: "Guitar chord string code (f=fundamental, c=chord, z=rest)",
    valueType: "string",
    example: "%%MIDI gchord fczcz"
  },
  {
    attribute: "ptstress",
    description: "Stress pattern string",
    valueType: "string",
    example: "%%MIDI ptstress M2"
  },
  {
    attribute: "beatstring",
    description: "Beat stress string (f=strong, m=medium, p=soft)",
    valueType: "string",
    example: "%%MIDI beatstring fmp"
  },

  // --- Integer Parameter ---
  // Source: midiCmdParam1Integer & midiCmdParam1Integer1OptionalInteger
  {
    attribute: "program",
    description: "Instrument program number (0-127)",
    valueType: "number",
    range: { min: 0, max: 127 },
    example: "%%MIDI program 0" // Piano
  },
  {
    attribute: "channel",
    description: "MIDI channel (1-16)",
    valueType: "number",
    range: { min: 1, max: 16 },
    example: "%%MIDI channel 1"
  },
  {
    attribute: "bassvol",
    description: "Bass volume (0-127)",
    valueType: "number",
    range: { min: 0, max: 127 },
    example: "%%MIDI bassvol 80"
  },
  {
    attribute: "chordvol",
    description: "Chord volume (0-127)",
    valueType: "number",
    range: { min: 0, max: 127 },
    example: "%%MIDI chordvol 60"
  },
  {
    attribute: "vol",
    description: "Main volume (0-127)",
    valueType: "number",
    range: { min: 0, max: 127 },
    example: "%%MIDI vol 127"
  },
  {
    attribute: "c",
    description: "Check (c) parameter",
    valueType: "number",
    example: "%%MIDI c 1"
  },
  {
    attribute: "beatmod",
    description: "Beat modification offset",
    valueType: "number",
    example: "%%MIDI beatmod 10"
  },
  {
    attribute: "deltaloudness",
    description: "Dynamic range",
    valueType: "number",
    example: "%%MIDI deltaloudness 10"
  },
  {
    attribute: "drumbars",
    description: "Number of bars for drum pattern loop",
    valueType: "number",
    example: "%%MIDI drumbars 2"
  },
  {
    attribute: "gchordbars",
    description: "Number of bars for gchord pattern loop",
    valueType: "number",
    example: "%%MIDI gchordbars 2"
  },
  {
    attribute: "gracedivider",
    description: "Grace note length divider",
    valueType: "number",
    example: "%%MIDI gracedivider 4"
  },
  {
    attribute: "makechordchannels",
    description: "Create separate channels for chords",
    valueType: "number",
    example: "%%MIDI makechordchannels 1"
  },
  {
    attribute: "randomchordattack",
    description: "Randomize chord attack (ms)",
    valueType: "number",
    example: "%%MIDI randomchordattack 20"
  },
  {
    attribute: "chordattack",
    description: "Chord attack delay (ms)",
    valueType: "number",
    example: "%%MIDI chordattack 10"
  },
  {
    attribute: "stressmodel",
    description: "Stress model ID",
    valueType: "number",
    example: "%%MIDI stressmodel 1"
  },
  {
    attribute: "transpose",
    description: "Transpose playback (semitones)",
    valueType: "number",
    example: "%%MIDI transpose -2"
  },
  {
    attribute: "rtranspose",
    description: "Relative transpose (semitones)",
    valueType: "number",
    example: "%%MIDI rtranspose 12"
  },
  {
    attribute: "volinc",
    description: "Volume increment for crescendos",
    valueType: "number",
    example: "%%MIDI volinc 10"
  },

  // --- Integer + Optional String/Octave ---
  // Source: midiCmdParam1Integer1OptionalString
  {
    attribute: "bassprog",
    description: "Bass program (0-127) [octave=n]",
    valueType: "composite",
    range: { min: 0, max: 127 },
    example: "%%MIDI bassprog 32 octave=-1"
  },
  {
    attribute: "chordprog",
    description: "Chord program (0-127) [octave=n]",
    valueType: "composite",
    range: { min: 0, max: 127 },
    example: "%%MIDI chordprog 0 octave=1"
  },

  // --- Two Integers ---
  // Source: midiCmdParam2Integer
  {
    attribute: "ratio",
    description: "Note duration ratio (p q)",
    valueType: "composite",
    example: "%%MIDI ratio 3 1"
  },
  {
    attribute: "snt",
    description: "SNT (n m)",
    valueType: "composite",
    example: "%%MIDI snt 1 2"
  },
  {
    attribute: "bendvelocity",
    description: "Bend velocity (n m)",
    valueType: "composite",
    example: "%%MIDI bendvelocity 20 2"
  },
  {
    attribute: "pitchbend",
    description: "Pitch bend (cent1 cent2)",
    valueType: "composite",
    example: "%%MIDI pitchbend 0 8192"
  },
  {
    attribute: "control",
    description: "Control Change message (Controller Value)",
    valueType: "composite",
    example: "%%MIDI control 7 64" // Volume 50%
  },
  {
    attribute: "temperamentlinear",
    description: "Linear temperament (n m)",
    valueType: "composite",
    example: "%%MIDI temperamentlinear 0 1"
  },

  // --- Four Integers ---
  // Source: midiCmdParam4Integer
  {
    attribute: "beat",
    description: "Beat accents volumes (Strong Med Weak Other)",
    valueType: "composite",
    example: "%%MIDI beat 127 100 80 60"
  },

  // --- Five Integers ---
  // Source: midiCmdParam5Integer
  {
    attribute: "drone",
    description: "Drone settings (prog pitch vol1 vol2 vol3)",
    valueType: "composite",
    example: "%%MIDI drone 70 45 80 60 40"
  },

  // --- String + Integer ---
  // Source: midiCmdParam1String1Integer
  {
    attribute: "portamento",
    description: "Portamento (instrument n)",
    valueType: "composite",
    example: "%%MIDI portamento 1 64"
  },

  // --- Fractions ---
  // Source: midiCmdParamFraction
  {
    attribute: "expand",
    description: "Expand rhythm (n/m)",
    valueType: "fraction",
    example: "%%MIDI expand 3/2"
  },
  {
    attribute: "grace",
    description: "Grace note length (n/m)",
    valueType: "fraction",
    example: "%%MIDI grace 1/8"
  },
  {
    attribute: "trim",
    description: "Trim note length (n/m)",
    valueType: "fraction",
    example: "%%MIDI trim 1/2"
  },

  // --- String + Variable Integers ---
  // Source: midiCmdParam1StringVariableIntegers
  {
    attribute: "drum",
    description: "Drum pattern (string [vel]...)",
    valueType: "composite",
    example: "%%MIDI drum d2dd 100 80 80"
  },
  {
    attribute: "chordname",
    description: "Custom chord definition (name n...)",
    valueType: "composite",
    example: "%%MIDI chordname sus4 0 5 7"
  },

  // --- Special ---
  {
    attribute: "drummap",
    description: "Map note to drum sound (note midi_pitch)",
    valueType: "composite",
    example: "%%MIDI drummap D 36" // Map 'D' to Bass Drum 1
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

  // Basic number validation
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
  const config = getMidiAttributeConfig(attribute)
  if (!config) return "MIDI attribute"

  let desc = config.description
  if (config.example) {
    desc += ` (e.g. ${config.example})`
  }
  return desc
}