"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const transposer_1 = require("./src/transposer");
console.log("Verifying Scale Degree Logic with Accidentals...");
const cases = [
    { key: 'C', degree: 3, acc: '', expected: 'E' },
    { key: 'C', degree: 3, acc: '_', expected: '_E' },
    { key: 'C', degree: 3, acc: '#', expected: 'F' },
    { key: 'G', degree: 7, acc: '', expected: '^F' },
    { key: 'G', degree: 7, acc: '_', expected: 'F' },
    { key: 'G', degree: 7, acc: '#', expected: 'G' },
    { key: 'F', degree: 4, acc: '', expected: '_B' },
    { key: 'F', degree: 4, acc: '#', expected: 'B' }, // B natural
];
let failures = 0;
cases.forEach(c => {
    const { root, mode } = (0, transposer_1.parseKey)(c.key);
    let note = (0, transposer_1.getScaleNote)(root, mode, c.degree);
    if (c.acc === '_') {
        note = (0, transposer_1.transposeABC)(note, -1);
    }
    else if (c.acc === '#') {
        note = (0, transposer_1.transposeABC)(note, 1);
    }
    if (note !== c.expected) {
        // Allow for equivalent spellings if needed, but transposeABC is deterministic
        console.error(`FAIL: Key=${c.key}, Degree=${c.degree}, Acc=${c.acc}. Expected ${c.expected}, got ${note}`);
        failures++;
    }
    else {
        console.log(`PASS: Key=${c.key}, Degree=${c.degree}, Acc=${c.acc} -> ${note}`);
    }
});
if (failures === 0) {
    console.log("All tests passed!");
}
else {
    console.error(`${failures} tests failed.`);
    process.exit(1);
}
