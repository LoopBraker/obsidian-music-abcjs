
import { setSelectionToDegreeABC, parseKey } from './src/transposer';

const testCases = [
    { input: 'C', degree: 3, key: 'C', expected: 'E' },
    { input: 'c', degree: 3, key: 'C', expected: 'e' },
    { input: 'C', degree: 3, key: 'Cm', expected: '_E' }, // Eb
    { input: 'C', degree: 7, key: 'G', expected: '^F' }, // F#
    { input: 'G', degree: 4, key: 'F', expected: '_B' }, // Bb
    { input: '^C', degree: 1, key: 'C', expected: 'C' }, // Reset accidental
    { input: '[CEG]', degree: 1, key: 'C', expected: '[CCC]' }, // Chord
    { input: 'C', degree: 1, key: 'C#', expected: '^C' }, // C# Major root
    { input: 'C', degree: 1, key: 'Cb', expected: 'B' }, // Cb Major root (B) -> B (Enharmonic limitation)
    { input: 'C', degree: 2, key: 'C', expected: 'D' },
    { input: 'C', degree: 7, key: 'C', expected: 'B' },
    { input: 'c', degree: 7, key: 'C', expected: 'b' }, // c -> b (same octave range: c..b)
    { input: 'C', degree: 7, key: 'C', expected: 'B' }, // C -> B (same octave range: C..B)
];

let passed = 0;
let failed = 0;

console.log("Running Scale Degree Tests...");

// Test Key Parsing
const keyTests = [
    { input: 'C', root: 'C', mode: 'major' },
    { input: 'Cm', root: 'C', mode: 'minor' },
    { input: 'Cmin', root: 'C', mode: 'minor' },
    { input: 'F#', root: 'F#', mode: 'major' },
    { input: 'Bb minor', root: 'Bb', mode: 'minor' },
];

keyTests.forEach(t => {
    const res = parseKey(t.input);
    if (res.root === t.root && res.mode === t.mode) {
        // console.log(`[PASS] Key Parse: ${t.input}`);
    } else {
        console.error(`[FAIL] Key Parse: ${t.input} -> ${JSON.stringify(res)}`);
        failed++;
    }
});

testCases.forEach((test, index) => {
    const result = setSelectionToDegreeABC(test.input, test.degree, test.key);
    if (result === test.expected) {
        console.log(`[PASS] Test ${index + 1}: ${test.input} (deg ${test.degree} in ${test.key}) -> ${result}`);
        passed++;
    } else {
        console.error(`[FAIL] Test ${index + 1}: ${test.input} (deg ${test.degree} in ${test.key})`);
        console.error(`  Expected: ${test.expected}`);
        console.error(`  Actual:   ${result}`);
        failed++;
    }
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);

if (failed > 0) process.exit(1);
