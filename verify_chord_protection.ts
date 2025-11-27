
import { setSelectionToDegreeABC } from './src/transposer';

const testCases = [
    { input: 'C', degree: 3, key: 'C', expected: 'E' }, // Normal note should change
    { input: '[CEGc]', degree: 3, key: 'C', expected: '[CEGc]' }, // Chord should NOT change
    { input: 'C [CEGc] G', degree: 3, key: 'C', expected: 'E [CEGc] E' }, // Mixed content
];

let passed = 0;
let failed = 0;

console.log("Running Chord Protection Tests...");

testCases.forEach((test, index) => {
    const result = setSelectionToDegreeABC(test.input, test.degree, test.key);
    if (result === test.expected) {
        console.log(`[PASS] Test ${index + 1}: ${test.input} -> ${result}`);
        passed++;
    } else {
        console.error(`[FAIL] Test ${index + 1}: ${test.input}`);
        console.error(`  Expected: ${test.expected}`);
        console.error(`  Actual:   ${result}`);
        failed++;
    }
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);

if (failed > 0) process.exit(1);
