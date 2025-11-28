// Self-contained logic to avoid import issues

const NOTE_VALUES: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
    'c': 12, 'd': 14, 'e': 16, 'f': 17, 'g': 19, 'a': 21, 'b': 23
};

const ACCIDENTALS: Record<string, number> = {
    '^': 1, '_': -1, '=': 0
};

function getScaleNote(root: string, mode: 'major' | 'minor', degree: number): string {
    // Simplified scale generation for verification
    // We only need C Major and A Minor for our tests
    // C Major: C D E F G A B
    // A Minor: A B C D E F G

    const cMajor = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const aMinor = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

    let scale: string[] = [];
    if (root === 'C' && mode === 'major') scale = cMajor;
    else if (root === 'A' && mode === 'minor') scale = aMinor; // Not strictly used in test cases as root is C
    else {
        // Fallback for other keys if needed, but we test with C Major mostly
        // Let's implement basic major scale logic if needed
        const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
        const rootIdx = notes.indexOf(root);
        // ... too complex to reimplement fully.
        // Let's stick to C Major for verification.
        return 'C'; // Fail safe
    }

    // Degree is 1-based
    // Scale repeats
    const idx = (degree - 1) % 7;
    return scale[idx];
}

// Mock logic matching ChordButtonBar
function generateChordString(root: string, mode: 'major' | 'minor', degree: number, extension: 'triad' | '7' | '9' | '11' | '13', isAddMode: boolean): string {
    const rootIdx = degree - 1;
    const indices = [rootIdx, (rootIdx + 2) % 7, (rootIdx + 4) % 7]; // Triad

    if (isAddMode) {
        if (extension === '9') {
            indices.push((rootIdx + 8) % 7); // 9th
        } else if (extension === '11') {
            indices.push((rootIdx + 10) % 7); // 11th
        } else if (extension === '13') {
            indices.push((rootIdx + 12) % 7); // 13th
        }
    } else {
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
            let isLower = false;
            if (val >= 12) {
                isLower = true;
                const octavesAbove = Math.floor((val - 12) / 12);
                for (let k = 0; k < octavesAbove; k++) suffix += "'";
            }
            return `${acc}${isLower ? base.toLowerCase() : base}${suffix}`;
        } else {
            return `${acc}${base}`;
        }
    };

    const formattedNotes = notes.map((n, i) => formatNote(n, adjustedValues[i]));
    return `[${formattedNotes.join('')}]`;
}

// Test Cases
const cases = [
    // Normal Mode (Cumulative)
    { root: 'C', mode: 'major', degree: 1, ext: '9', isAdd: false, expected: '[CEGBd]' },

    // Add Mode (Non-Cumulative)
    { root: 'C', mode: 'major', degree: 1, ext: '9', isAdd: true, expected: '[CEGd]' }, // No B
    { root: 'C', mode: 'major', degree: 1, ext: '11', isAdd: true, expected: '[CEGf]' }, // No B, d. Wait, 11th of C is F.
    { root: 'C', mode: 'major', degree: 1, ext: '13', isAdd: true, expected: '[CEGa]' }, // No B, d, f. 13th of C is A.

    // A Minor (vi in C Major)
    // But getScaleNote mock only handles C Major root C.
    // Let's stick to C Major root C for now to verify the logic of indices.
];

console.log('Testing Add Modifier:');
cases.forEach(c => {
    const result = generateChordString(c.root, c.mode as any, c.degree, c.ext as any, c.isAdd);
    const pass = result === c.expected;
    console.log(`${c.root} ${c.mode} deg ${c.degree} (${c.ext}, add=${c.isAdd}): ${result} [${pass ? 'PASS' : 'FAIL'}]`);
    if (!pass) console.log(`  Expected: ${c.expected}`);
});

export { };
