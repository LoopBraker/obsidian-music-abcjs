
import { transposeABC } from './src/transposer';

const testCases = [
    { input: 'C', semitones: 1, expected: '^C' },
    { input: '^C', semitones: 1, expected: 'D' },
    { input: 'D', semitones: 1, expected: '^D' },
    { input: 'E', semitones: 1, expected: 'F' },
    { input: 'C', semitones: -1, expected: 'B,' },
    { input: 'c', semitones: 1, expected: '^c' },
    { input: "c'", semitones: 1, expected: "^c'" },
    { input: "C,", semitones: -1, expected: "B,," },
    { input: "C", semitones: 12, expected: "c" },
    { input: "C", semitones: -12, expected: "C," },
    { input: '"C" C', semitones: 1, expected: '"C" ^C' }, // Chord symbol shouldn't change
    { input: '[K:C] C', semitones: 1, expected: '[K:C] ^C' }, // Key signature shouldn't change
    { input: '% C note\nC', semitones: 1, expected: '% C note\n^C' }, // Comment shouldn't change
    { input: '!fermata!C', semitones: 1, expected: '!fermata!^C' }, // Decoration shouldn't change
    { input: 'C2', semitones: 1, expected: '^C2' }, // Duration shouldn't change
    { input: 'C/2', semitones: 1, expected: '^C/2' }, // Duration shouldn't change
];

let passed = 0;
let failed = 0;

console.log("Running Transposer Tests...");

testCases.forEach((test, index) => {
    const result = transposeABC(test.input, test.semitones);
    if (result === test.expected) {
        console.log(`[PASS] Test ${index + 1}: ${test.input} -> ${result}`);
        passed++;
    } else {
        console.error(`[FAIL] Test ${index + 1}: ${test.input} (${test.semitones} st)`);
        console.error(`  Expected: ${test.expected}`);
        console.error(`  Actual:   ${result}`);
        failed++;
    }
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);

if (failed > 0) process.exit(1);
