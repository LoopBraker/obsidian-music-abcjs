import { getScaleNote, NOTE_VALUES, ACCIDENTALS } from './src/transposer';

// Mocking the logic from editor_view.ts
function generateChordStringForCompletion(root: string, mode: 'major' | 'minor', degree: number, modifier: string, is8vaEnabled: boolean): string {
    const rootIdx = degree - 1;
    const indices = [rootIdx, (rootIdx + 2) % 7, (rootIdx + 4) % 7]; // Triad base

    // Parse modifier (simplified for test)
    if (modifier === '-7') indices.push((rootIdx + 6) % 7);

    // Get notes
    const notes = indices.map(idx => getScaleNote(root, mode, idx + 1));

    // Helper to get note value
    const getNoteValue = (note: string) => {
        const match = note.match(/^([\^=_]*)([A-G])$/);
        if (!match) return 0;
        const acc = match[1];
        const base = match[2];

        let val = NOTE_VALUES[base];
        if (acc) {
            for (const char of acc) {
                if (ACCIDENTALS[char]) val += ACCIDENTALS[char];
            }
        }
        return val;
    };

    const noteValues = notes.map(n => getNoteValue(n));
    const adjustedValues = [...noteValues];

    // Adjust octaves to ensure ascending order
    if (!is8vaEnabled) {
        for (let i = 1; i < adjustedValues.length; i++) {
            while (adjustedValues[i] <= adjustedValues[i - 1]) {
                adjustedValues[i] += 12;
            }
        }
    }

    // Format notes with proper octave notation
    const formatNote = (note: string, val: number) => {
        const match = note.match(/^([\^=_]*)([A-G])$/);
        if (!match) return note;
        const acc = match[1];
        const base = match[2];

        if (val >= 12) {
            let suffix = '';
            const octavesAbove = Math.floor((val - 12) / 12);
            for (let k = 0; k < octavesAbove; k++) suffix += "'";
            return `${acc}${base.toLowerCase()}${suffix}`;
        } else {
            return `${acc}${base}`;
        }
    };

    const formattedNotes = notes.map((n, i) => formatNote(n, adjustedValues[i]));
    return `[${formattedNotes.join('')}]`;
}

function assert(actual: string, expected: string, message: string) {
    if (actual === expected) {
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message}`);
        console.error(`  Expected: ${expected}`);
        console.error(`  Actual:   ${actual}`);
    }
}

console.log("--- Testing 8va Toggle Logic ---");

// 1. VI Chord in C Major (8va OFF - Default) -> [Ace]
assert(generateChordStringForCompletion('C', 'major', 6, '', false), '[Ace]', 'VI in C Major (8va OFF)');

// 2. VI Chord in C Major (8va ON) -> [ACE]
assert(generateChordStringForCompletion('C', 'major', 6, '', true), '[ACE]', 'VI in C Major (8va ON)');

// 3. V7 Chord in C Major (G B D F)
// 8va OFF: G(7), B(11), D(2->14), F(5->17) -> [GBdf]
assert(generateChordStringForCompletion('C', 'major', 5, '-7', false), '[GBdf]', 'V7 in C Major (8va OFF)');

// 8va ON: G(7), B(11), D(2), F(5) -> [GBDF]
assert(generateChordStringForCompletion('C', 'major', 5, '-7', true), '[GBDF]', 'V7 in C Major (8va ON)');

console.log("--- Done ---");
