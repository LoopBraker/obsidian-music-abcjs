
import { getScaleNote, parseKey, transposeABC } from './src/transposer';

console.log("Verifying Scale Degree Logic with Accidentals...");

const cases = [
    { key: 'C', degree: 3, acc: '', expected: 'E' },
    { key: 'C', degree: 3, acc: '_', expected: '_E' }, // Eb
    { key: 'C', degree: 3, acc: '#', expected: 'F' }, // E# -> F
    { key: 'G', degree: 7, acc: '', expected: '^F' }, // F#
    { key: 'G', degree: 7, acc: '_', expected: 'F' }, // F natural
    { key: 'G', degree: 7, acc: '#', expected: 'G' }, // F## -> G
    { key: 'F', degree: 4, acc: '', expected: '_B' }, // Bb
    { key: 'F', degree: 4, acc: '#', expected: 'B' }, // B natural
];

let failures = 0;

cases.forEach(c => {
    const { root, mode } = parseKey(c.key);
    let note = getScaleNote(root, mode, c.degree);

    if (c.acc === '_') {
        note = transposeABC(note, -1);
    } else if (c.acc === '#') {
        note = transposeABC(note, 1);
    }

    if (note !== c.expected) {
        // Allow for equivalent spellings if needed, but transposeABC is deterministic
        console.error(`FAIL: Key=${c.key}, Degree=${c.degree}, Acc=${c.acc}. Expected ${c.expected}, got ${note}`);
        failures++;
    } else {
        console.log(`PASS: Key=${c.key}, Degree=${c.degree}, Acc=${c.acc} -> ${note}`);
    }
});

if (failures === 0) {
    console.log("All tests passed!");
} else {
    console.error(`${failures} tests failed.`);
    process.exit(1);
}
