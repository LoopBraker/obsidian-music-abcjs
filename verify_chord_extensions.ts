
import { getScaleNote, NOTE_VALUES, ACCIDENTALS } from './src/transposer';

// Mock generateChordString logic
function generateChordString(root: string, mode: 'major' | 'minor', degree: number, extension: 'triad' | '7' | '9' | '11' | '13'): string {
    const rootIdx = degree - 1;
    const indices = [rootIdx, (rootIdx + 2) % 7, (rootIdx + 4) % 7]; // Triad

    if (extension === '7' || extension === '9' || extension === '11' || extension === '13') {
        indices.push((rootIdx + 6) % 7); // 7th
    }
    if (extension === '9' || extension === '11' || extension === '13') {
        indices.push((rootIdx + 8) % 7); // 9th
    }
    if (extension === '11' || extension === '13') {
        indices.push((rootIdx + 10) % 7); // 11th
    }
    if (extension === '13') {
        indices.push((rootIdx + 12) % 7); // 13th
    }

    const notes = indices.map(idx => getScaleNote(root, mode, idx + 1));

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

    for (let i = 1; i < adjustedValues.length; i++) {
        while (adjustedValues[i] <= adjustedValues[i - 1]) {
            adjustedValues[i] += 12;
        }
    }

    const formatNote = (note: string, val: number) => {
        const match = note.match(/^([\^=_]*)([A-G])$/);
        if (!match) return note;
        const acc = match[1];
        const base = match[2];

        if (val >= 12) {
            let suffix = '';
            let isLower = true;
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

// Test Cases
const cases = [
    { root: 'C', mode: 'major', degree: 1, ext: 'triad', expected: '[CEG]' },
    { root: 'C', mode: 'major', degree: 1, ext: '7', expected: '[CEGB]' },
    { root: 'C', mode: 'major', degree: 1, ext: '9', expected: '[CEGBd]' },
    { root: 'C', mode: 'major', degree: 1, ext: '11', expected: '[CEGBdf]' },
    { root: 'C', mode: 'major', degree: 1, ext: '13', expected: '[CEGBdfa]' },

    // B Locrian (vii in C Major)
    // B D F A C E G
    { root: 'C', mode: 'major', degree: 7, ext: 'triad', expected: '[Bdf]' }, // B(11) d(14) f(17)
    { root: 'C', mode: 'major', degree: 7, ext: '7', expected: '[Bdfa]' }, // a(21)
    { root: 'C', mode: 'major', degree: 7, ext: '9', expected: "[Bdfac']" }, // c'(24)

    // A Minor (vi in C Major)
    // A C E G B D F
    { root: 'C', mode: 'major', degree: 6, ext: 'triad', expected: '[Ace]' }, // A(9) c(12) e(16)
    { root: 'C', mode: 'major', degree: 6, ext: '7', expected: '[Aceg]' }, // g(19)
    { root: 'C', mode: 'major', degree: 6, ext: '9', expected: "[Acegb]" }, // b(23)
    { root: 'C', mode: 'major', degree: 6, ext: '11', expected: "[Acegbd']" }, // d'(26)
];

console.log('Testing Chord Extensions:');
cases.forEach(c => {
    const result = generateChordString(c.root, c.mode as any, c.degree, c.ext as any);
    const pass = result === c.expected;
    console.log(`${c.root} ${c.mode} deg ${c.degree} (${c.ext}): ${result} [${pass ? 'PASS' : 'FAIL'}]`);
    if (!pass) console.log(`  Expected: ${c.expected}`);
});

export { };
