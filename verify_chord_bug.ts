
import { transposeABC } from './src/transposer';

const testCases = [
    { input: '[CDEF]4', semitones: 1, expected: '[^C^DF^F]4' },
    { input: '[C]4', semitones: 1, expected: '[^C]4' },
    { input: '[K:C]', semitones: 1, expected: '[K:C]' }, // Should still be protected (or at least not mangled)
    { input: 'C', semitones: 1, expected: '^C' }
];

let passed = 0;
let failed = 0;

console.log("Running Chord Transposition Tests...");

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
