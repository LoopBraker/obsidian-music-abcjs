
/**
 * Transposes ABC notation by a given number of semitones.
 * Handles single notes, chords, and preserves other ABC elements.
 */

// Note to semitone index (C=0)
const NOTE_VALUES: Record<string, number> = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
    'c': 12, 'd': 14, 'e': 16, 'f': 17, 'g': 19, 'a': 21, 'b': 23
};

// Accidental values
const ACCIDENTALS: Record<string, number> = {
    '^': 1, '^^': 2, '_': -1, '__': -2, '=': 0
};

// Reverse mapping for reconstruction (preferred spellings)
// We'll use a simplified approach: prefer sharps for ascending, flats for descending?
// Or just standardizing. Let's try to be smart.
// Actually, standard ABC usually defaults to sharps for non-key notes in many contexts,
// but let's define a chromatic scale.

const CHROMATIC_SCALE_SHARP = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
const CHROMATIC_SCALE_FLAT = ['C', '_D', 'D', '_E', 'E', 'F', '_G', 'G', '_A', 'A', '_B', 'B'];

/**
 * Transposes a single ABC note token.
 * Returns the transposed token.
 */
function transposeNote(token: string, semitones: number): string {
    // Regex to parse: (Accidental)(Basenote)(Octave)
    // Basenote is [A-Ga-g]
    // Accidental is [\^=_]+
    // Octave is [,']*

    const match = token.match(/^([\^=_]*)([A-Ga-g])([,']*)$/);
    if (!match) return token;

    const [, accStr, baseNote, octaveStr] = match;

    // Calculate current absolute semitone value
    // 1. Base note value
    let baseVal = NOTE_VALUES[baseNote]; // 0-23

    // 2. Accidental value
    let accVal = 0;
    if (accStr) {
        if (ACCIDENTALS[accStr] !== undefined) {
            accVal = ACCIDENTALS[accStr];
        } else {
            // Handle mixed or complex accidentals if any (unlikely in standard ABC but possible)
            // For now assume standard
            // If it's like ^_ (cancel?), ABC doesn't really do that standardly in one token usually.
            // Let's iterate if needed, but standard is usually one block.
            // Actually ABC allows ^^ and __.
            // Let's just try to parse standard ones.
            // If not found, maybe it's multiple chars.
            // Simple parser: count ^ and _
            for (const char of accStr) {
                if (char === '^') accVal++;
                else if (char === '_') accVal--;
                else if (char === '=') accVal = 0; // Natural resets? usually = is just 0.
            }
        }
    }

    // 3. Octave shift from base note casing is already in baseVal (c vs C)
    // But we also have octave suffix
    let octaveShift = 0;
    for (const char of octaveStr) {
        if (char === '\'') octaveShift += 12;
        if (char === ',') octaveShift -= 12;
    }

    // Total absolute semitone value (relative to C)
    // We treat C as 0.
    // C, is -12.
    let totalSemitones = baseVal + accVal + octaveShift;

    // Apply transposition
    totalSemitones += semitones;

    // Reconstruct note
    // We need to find the new octave, base note, and accidental.
    // This is the tricky part: "spelling" the note.

    // 1. Determine octave
    // We want to keep the base note within C-B (0-11) or c-b (12-23) range as much as possible
    // to minimize accidentals? No, we want to minimize octave markers if possible, 
    // but standard ABC uses C-B and c-b.
    // Let's normalize to 0-11 range for the pitch class.

    let pitchClass = totalSemitones % 12;
    if (pitchClass < 0) pitchClass += 12;

    // Calculate raw octave (how many 12s)
    // Math.floor(totalSemitones / 12)
    // Example: Middle C (C) is 0. Transpose -1 -> -1. Floor(-1/12) = -1. 
    // Pitch class 11 (B). So it becomes B, (B comma).
    // Example: c (12). Transpose +1 -> 13. Floor(13/12) = 1.
    // Pitch class 1 (^C or _D). So it becomes ^c or _d.

    let octaveLevel = Math.floor(totalSemitones / 12);

    // Determine note name and accidental
    // If we are going UP (semitones > 0), prefer Sharps.
    // If we are going DOWN (semitones < 0), prefer Flats.
    // If semitones == 0, keep as is (but we wouldn't be here).
    // Default to Sharps if mixed or 0.

    let noteName = '';
    let newAccStr = '';

    const scale = semitones < 0 ? CHROMATIC_SCALE_FLAT : CHROMATIC_SCALE_SHARP;
    const noteString = scale[pitchClass]; // e.g. "^C" or "_D" or "C"

    // Parse the scale string
    if (noteString.length === 2) {
        newAccStr = noteString[0];
        noteName = noteString[1];
    } else {
        noteName = noteString;
    }

    // Adjust octave based on the chosen note name's inherent octave
    // The scale above uses uppercase C-B.
    // In ABC, C-B is one octave, c-b is the next up.
    // Our octaveLevel 0 corresponds to C-B range.
    // octaveLevel 1 corresponds to c-b range.
    // octaveLevel -1 corresponds to C,-B, range.

    // However, we need to handle the case where we cross the boundary.
    // The pitchClass logic handles the value 0-11.
    // 0 is C, 11 is B.
    // So if octaveLevel is 0, we use C...B.
    // If octaveLevel is 1, we use c...b.
    // If octaveLevel is -1, we use C...B + comma.

    // Wait, ABC "C" is middle C? No, standard ABC:
    // C, is low C.
    // C is middle C (or tenor C?).
    // c is high C.
    // c' is higher C.

    // Let's stick to the standard:
    // octaveLevel 0: C D E F G A B
    // octaveLevel 1: c d e f g a b
    // octaveLevel > 1: c' ...
    // octaveLevel < 0: C, ...

    let finalBase = noteName; // Always uppercase from our scale
    let finalOctaveStr = '';

    if (octaveLevel === 0) {
        // C ... B
        // No change needed to base (uppercase)
    } else if (octaveLevel === 1) {
        // c ... b
        finalBase = finalBase.toLowerCase();
    } else if (octaveLevel > 1) {
        // c' ...
        finalBase = finalBase.toLowerCase();
        for (let i = 1; i < octaveLevel; i++) {
            finalOctaveStr += "'";
        }
    } else if (octaveLevel < 0) {
        // C, ...
        // Base is uppercase
        for (let i = 0; i < Math.abs(octaveLevel); i++) {
            finalOctaveStr += ",";
        }
    }

    return `${newAccStr}${finalBase}${finalOctaveStr}`;
}

/**
 * Main transposition function.
 * Parses the input string and transposes valid notes.
 */
export function transposeABC(input: string, semitones: number): string {
    if (semitones === 0) return input;

    // We need to tokenize the input to identify notes vs other things.
    // ABC tokens:
    // - Strings: "..."
    // - Comments: %...
    // - Inline fields: [K:...]
    // - Decorations: !...! or +...+
    // - Chords: "C" (quoted) is a chord symbol/annotation, handled as string.
    // - Notes: [^=_]*[A-Ga-g][,']*
    // - Bars: |
    // - Others: numbers, spaces, etc.

    // Simple regex approach might be risky if we don't handle strings/comments first.
    // Let's use a splitting approach similar to NoteEditor but more robust.

    // 1. Split by strings and comments and decorations to protect them.
    // Regex for protected blocks:
    // - String: ".*?"
    // - Comment: %.*$ (multiline? no, usually single line)
    // - Decoration: !.*?!
    // - Inline field: \[.*?\] (e.g. [K:C]) - We don't want to transpose the 'C' in K:C blindly.

    // Note: JS regex doesn't support atomic groups, so order matters.
    const protectedRegex = /(".*?")|(!.+?!)|(\[.*?\])|(%.*$)/gm;

    // We will split the string by these protected blocks.
    // The split will return [text, protected1, protected2, ..., text, ...]
    // But split with capturing groups returns the captures.

    // Actually, let's just replace with a placeholder, transpose the rest, then restore?
    // Or iterate through matches.

    let result = '';
    let lastIndex = 0;

    // We need to handle line-by-line for comments if we use 'm' flag? 
    // Actually '%.*$' matches to end of line.

    // Let's iterate over the string finding protected blocks.
    let match;
    while ((match = protectedRegex.exec(input)) !== null) {
        const index = match.index;
        const protectedText = match[0];

        // Process text before this match
        const prefix = input.slice(lastIndex, index);
        result += processUnprotectedText(prefix, semitones);

        // Append protected text unchanged
        result += protectedText;

        lastIndex = index + protectedText.length;
    }

    // Process remaining text
    result += processUnprotectedText(input.slice(lastIndex), semitones);

    return result;
}

function processUnprotectedText(text: string, semitones: number): string {
    // In unprotected text, we look for notes.
    // A note is: (Accidentals)(Base)(Octave)(Duration?)
    // We only transpose the pitch part.
    // Duration is separate (e.g. C2, C/2).
    // We need to be careful not to match random letters that aren't notes?
    // In ABC body, most letters are notes.
    // But there are also bar lines |, numbers, slurs (), ties -.

    // Regex for a note:
    // ([\^=_]*[A-Ga-g][,']*)([\d\/]*)
    // We capture the pitch part and the duration part.
    // But wait, what about 'z' (rest) or 'x' (invisible rest)? They are notes but have no pitch.
    // We should skip them.

    // Also, we need to avoid matching things that look like notes but aren't?
    // In the body, pretty much any [A-G] is a note.

    return text.replace(/([\^=_]*[A-Ga-g][,']*)/g, (match) => {
        return transposeNote(match, semitones);
    });
}
