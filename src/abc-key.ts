/**
 * ABC Key Signature Definitions
 * K: (Key) info field - key signatures, modes, and related attributes
 * 
 * This file is prepared for future expansion of key signature features
 */

export interface KeySignatureConfig {
  key: string
  description: string
  sharps?: number
  flats?: number
  mode?: string
}

// Common key signatures
export const majorKeys = [
  "C", "G", "D", "A", "E", "B", "F#", "C#",  // Sharps
  "F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"   // Flats
]

export const minorKeys = [
  "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m",  // Sharps
  "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm", "Abm"           // Flats
]

// Modes
export const modes = [
  "major", "minor", "ionian", "dorian", "phrygian",
  "lydian", "mixolydian", "aeolian", "locrian"
]

// Key signature definitions (for future use)
export const keySignatureDefinitions: Record<string, string> = {
  "C": "C major (no sharps or flats)",
  "G": "G major (1 sharp: F#)",
  "D": "D major (2 sharps: F#, C#)",
  "A": "A major (3 sharps: F#, C#, G#)",
  "E": "E major (4 sharps: F#, C#, G#, D#)",
  "B": "B major (5 sharps: F#, C#, G#, D#, A#)",
  "F#": "F# major (6 sharps)",
  "C#": "C# major (7 sharps)",
  
  "F": "F major (1 flat: Bb)",
  "Bb": "Bb major (2 flats: Bb, Eb)",
  "Eb": "Eb major (3 flats: Bb, Eb, Ab)",
  "Ab": "Ab major (4 flats: Bb, Eb, Ab, Db)",
  "Db": "Db major (5 flats: Bb, Eb, Ab, Db, Gb)",
  "Gb": "Gb major (6 flats)",
  "Cb": "Cb major (7 flats)",
  
  "Am": "A minor (no sharps or flats)",
  "Em": "E minor (1 sharp: F#)",
  "Bm": "B minor (2 sharps: F#, C#)",
  "F#m": "F# minor (3 sharps: F#, C#, G#)",
  "C#m": "C# minor (4 sharps: F#, C#, G#, D#)",
  "G#m": "G# minor (5 sharps)",
  "D#m": "D# minor (6 sharps)",
  
  "Dm": "D minor (1 flat: Bb)",
  "Gm": "G minor (2 flats: Bb, Eb)",
  "Cm": "C minor (3 flats: Bb, Eb, Ab)",
  "Fm": "F minor (4 flats: Bb, Eb, Ab, Db)",
  "Bbm": "Bb minor (5 flats)",
  "Ebm": "Eb minor (6 flats)",
  "Abm": "Ab minor (7 flats)",
}

// Mode definitions
export const modeDefinitions: Record<string, string> = {
  "major": "Major scale (Ionian mode)",
  "minor": "Natural minor scale (Aeolian mode)",
  "ionian": "Ionian mode (same as major)",
  "dorian": "Dorian mode (minor with raised 6th)",
  "phrygian": "Phrygian mode (minor with lowered 2nd)",
  "lydian": "Lydian mode (major with raised 4th)",
  "mixolydian": "Mixolydian mode (major with lowered 7th)",
  "aeolian": "Aeolian mode (same as natural minor)",
  "locrian": "Locrian mode (diminished)"
}

// Helper to get key signature description
export function getKeySignatureDescription(key: string): string {
  return keySignatureDefinitions[key] || `Key signature: ${key}`
}

// Helper to get mode description
export function getModeDescription(mode: string): string {
  return modeDefinitions[mode.toLowerCase()] || `Mode: ${mode}`
}

// Helper to check if a key is valid
export function isValidKey(key: string): boolean {
  return majorKeys.includes(key) || minorKeys.includes(key)
}

// Helper to check if a mode is valid
export function isValidMode(mode: string): boolean {
  return modes.includes(mode.toLowerCase())
}
