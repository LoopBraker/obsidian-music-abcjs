// Self-contained verification script

const NOTE_VALUES: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
    'c': 12, 'd': 14, 'e': 16, 'f': 17, 'g': 19, 'a': 21, 'b': 23
};

const ACCIDENTALS: Record<string, number> = {
    '^': 1, '^^': 2, '_': -1, '__': -2, '=': 0
};

const CHROMATIC_SCALE_SHARP = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
const CHROMATIC_SCALE_FLAT = ['C', '_D', 'D', '_E', 'E', 'F', '_G', 'G', '_A', 'A', '_B', 'B'];

const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

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

function getScaleNote(root: string, mode: 'major' | 'minor', degree: number): string {
    const rootBase = root[0].toUpperCase();
    const rootAcc = root.slice(1);

    let rootVal = NOTE_VALUES[rootBase];
    if (rootAcc === '#') rootVal += 1;
    if (rootAcc === 'b') rootVal -= 1;

    const intervals = mode === 'major' ? MAJOR_SCALE_INTERVALS : MINOR_SCALE_INTERVALS;
    const interval = intervals[(degree - 1) % 7];

    let targetVal = (rootVal + interval) % 12;
    if (targetVal < 0) targetVal += 12;

    let isFlatKey = false;
    if (root.includes('b')) {
        isFlatKey = true;
    } else if (root.includes('#')) {
        isFlatKey = false;
    } else {
        if (mode === 'major') {
            if (root === 'F') isFlatKey = true;
        } else {
            if (['D', 'G', 'C', 'F'].includes(root)) isFlatKey = true;
        }
    }

    const scale = isFlatKey ? CHROMATIC_SCALE_FLAT : CHROMATIC_SCALE_SHARP;
    return scale[targetVal];
}

// Logic from ChordButtonBar
function getChordNotes(root: string, mode: 'major' | 'minor', degree: number) {
    const rootIdx = degree - 1;
    const thirdIdx = (rootIdx + 2) % 7;
    const fifthIdx = (rootIdx + 4) % 7;

    const rootNote = getScaleNote(root, mode, rootIdx + 1);
    const thirdNote = getScaleNote(root, mode, thirdIdx + 1);
    const fifthNote = getScaleNote(root, mode, fifthIdx + 1);

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

    const rootVal = getNoteValue(rootNote);
    let thirdVal = getNoteValue(thirdNote);
    let fifthVal = getNoteValue(fifthNote);

    if (thirdVal < rootVal) thirdVal += 12;
    if (fifthVal < thirdVal) fifthVal += 12;

    const formatNote = (note: string, val: number) => {
        const match = note.match(/^([\^=_]*)([A-G])$/);
        if (!match) return note;
        const acc = match[1];
        const base = match[2];

        if (val >= 12) {
            return `${acc}${base.toLowerCase()}`;
        } else {
            return `${acc}${base}`;
        }
    };

    const finalRoot = formatNote(rootNote, rootVal);
    const finalThird = formatNote(thirdNote, thirdVal);
    const finalFifth = formatNote(fifthNote, fifthVal);

    return `[${finalRoot}${finalThird}${finalFifth}]`;
}

function testKey(keyStr: string, expectedChords: string[]) {
    console.log(`Testing Key: ${keyStr}`);
    const { root, mode } = parseKey(keyStr);
    console.log(`Parsed: Root=${root}, Mode=${mode}`);

    for (let i = 1; i <= 7; i++) {
        const chord = getChordNotes(root, mode, i);
        const expected = expectedChords[i - 1];
        if (chord === expected) {
            console.log(`  Degree ${i}: ${chord} - PASS`);
        } else {
            console.error(`  Degree ${i}: ${chord} - FAIL (Expected ${expected})`);
        }
    }
}

// Test Cases

// 1. C Major
testKey('C', [
    '[CEG]', // I
    '[DFA]', // ii
    '[EGB]', // iii
    '[FAc]', // IV
    '[GBd]', // V
    '[Ace]', // vi
    '[Bdf]'  // vii
]);

// 2. A Minor (Natural)
testKey('Am', [
    '[Ace]', // i
    '[Bdf]', // ii
    '[CEG]', // III
    '[DFA]', // iv
    '[EGB]', // v
    '[FAc]', // VI
    '[GBd]'  // VII
]);

// 3. G Major (1 Sharp: F#)
testKey('G', [
    '[GBd]', // I
    '[Ace]', // ii
    '[Bd^f]', // iii
    '[CEG]', // IV
    '[D^FA]', // V
    '[EGB]', // vi
    '[^FAc]' // vii
]);

export { };
