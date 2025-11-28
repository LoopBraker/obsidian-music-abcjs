
// Self-contained logic to avoid import issues

const NOTE_VALUES = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
    'c': 12, 'd': 14, 'e': 16, 'f': 17, 'g': 19, 'a': 21, 'b': 23
};

const ACCIDENTALS = {
    '^': 1, '_': -1, '=': 0
};

function getScaleNote(root, mode, degree) {
    // Simplified scale generation for verification
    // We only need C Major for our tests
    // C Major: C D E F G A B

    const cMajor = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

    let scale = [];
    if (root === 'C' && mode === 'major') scale = cMajor;
    else return 'C'; // Fail safe

    // Degree is 1-based
    // Scale repeats
    const idx = (degree - 1) % 7;
    return scale[idx];
}

// Mock logic matching ChordButtonBar
function generateChordString(root, mode, degree, extension, isAddMode) {
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

    const getNoteValue = (note) => {
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

    // First pass: ensure strictly increasing (basic stacking)
    for (let i = 1; i < adjustedValues.length; i++) {
        while (adjustedValues[i] <= adjustedValues[i - 1]) {
            adjustedValues[i] += 12;
        }
    }

    // Second pass: Ensure 9, 11, 13 are at least root + 12 (compound intervals)
    // This applies to the extension note.
    // In Add Mode, the extension is the last note.
    // In Cumulative Mode, they are also at the end.
    // We can just check based on the extension type requested.

    // Helper to boost specific index
    const boostOctave = (idx) => {
        if (idx < adjustedValues.length) {
            while (adjustedValues[idx] < adjustedValues[0] + 12) {
                adjustedValues[idx] += 12;
            }
        }
    };

    if (isAddMode) {
        // [Root, 3rd, 5th, Ext]
        if (extension === '9' || extension === '11' || extension === '13') {
            boostOctave(3);
        }
    } else {
        // [Root, 3rd, 5th, 7th, 9th, 11th, 13th]
        // 9th is index 4 (if 7th present)
        // But indices array construction depends on extension.
        // Let's look at how we built indices.
        // If ext=9: indices has 5 elements (0,1,2,3,4). 9th is at 4.
        // If ext=11: 9th at 4, 11th at 5.
        // If ext=13: 9th at 4, 11th at 5, 13th at 6.

        // We can just iterate and check? No, we need to know which note corresponds to which degree.
        // But simpler: The loop `while (val <= prev)` already handles cumulative stacking correctly 
        // because 7th pushes 9th up, etc.
        // The issue is ONLY when we skip intermediates (Add Mode).
        // So we only need to apply this fix for Add Mode?
        // Let's check cumulative 13th:
        // C(0), E(4), G(7), B(11), D(14), F(17), A(21).
        // A(21) >= C(0)+12. Yes.
        // So cumulative is fine.
        // Only Add Mode needs the fix.
    }

    const formatNote = (note, val) => {
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
];

console.log('Testing Add Modifier:');
cases.forEach(c => {
    const result = generateChordString(c.root, c.mode, c.degree, c.ext, c.isAdd);
    const pass = result === c.expected;
    console.log(`${c.root} ${c.mode} deg ${c.degree} (${c.ext}, add=${c.isAdd}): ${result} [${pass ? 'PASS' : 'FAIL'}]`);
    if (!pass) console.log(`  Expected: ${c.expected}`);
});
