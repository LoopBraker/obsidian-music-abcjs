
// Mock parseKey from transposer.ts
function parseKey(keyStr: string): { root: string, mode: 'major' | 'minor' } {
    keyStr = keyStr.trim();
    const match = keyStr.match(/^([A-G][#b]?)(.*)$/i);
    if (!match) return { root: 'C', mode: 'major' };
    const root = match[1];
    const suffix = match[2].trim().toLowerCase();
    let mode: 'major' | 'minor' = 'major';
    if (['m', 'min', 'minor'].includes(suffix)) {
        mode = 'minor';
    }
    return { root, mode };
}

// Test Cases
const cases = [
    { input: 'C', expected: { root: 'C', mode: 'major' } },
    { input: 'Eminor', expected: { root: 'E', mode: 'minor' } },
    { input: 'Eminor clef=bass', expected: { root: 'E', mode: 'minor' } }, // This should fail with current logic
    { input: 'G mixolydian', expected: { root: 'G', mode: 'major' } }, // Treat mix as major for now? Or just check if not minor.
    { input: 'F#m', expected: { root: 'F#', mode: 'minor' } },
    { input: 'Bb min', expected: { root: 'Bb', mode: 'minor' } }
];

console.log('Testing parseKey logic:');
cases.forEach(({ input, expected }) => {
    const result = parseKey(input);
    const pass = result.root === expected.root && result.mode === expected.mode;
    console.log(`Input: "${input}" -> Root: ${result.root}, Mode: ${result.mode} [${pass ? 'PASS' : 'FAIL'}]`);
});

export { };
