import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { parseKey, getScaleNote, NOTE_VALUES, ACCIDENTALS } from './transposer';

export class ChordButtonBar {
    private container: HTMLElement;
    private header: HTMLElement;
    private buttonContainer: HTMLElement;
    private currentKey: string = 'C';

    constructor(parent: HTMLElement, private editorViewGetter: () => EditorView | null) {
        this.container = parent.createDiv({ cls: 'abc-chord-button-bar-wrapper' });
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.marginBottom = '10px';
        this.container.style.gap = '5px'; // Gap between header and buttons

        // Header
        this.header = this.container.createDiv({ cls: 'abc-chord-button-bar-header' });
        this.header.style.marginLeft = '12px'; // Align with first button (approx)
        // Style to match chord labels: 24px font size scaled 0.5 -> 12px?
        // The SVG labels are font-size 24 scaled 0.5 -> 12px effective.
        // Let's use standard font size matching that.
        this.header.style.fontSize = '12px';
        this.header.style.color = 'var(--text-normal)';
        this.header.style.fontFamily = 'sans-serif'; // Match SVG font if possible
        this.header.innerText = 'Chords in C:';

        // Button Container
        this.buttonContainer = this.container.createDiv({ cls: 'abc-chord-button-bar-container' });
        this.buttonContainer.style.display = 'flex';
        this.buttonContainer.style.justifyContent = 'center';
        this.buttonContainer.style.gap = '10px';
        this.buttonContainer.style.flexWrap = 'wrap';
    }

    update(content: string, cursor: number) {
        // Parse Key
        // We need to find the K: directive that applies to the cursor position.
        // 1. Find the start of the current tune (look backwards for X: or start of file).
        // 2. Find the end of the current tune (look forwards for X: or end of file).
        // 3. Within this block, find the K: directive.
        //    - If cursor is after an inline [K:...], use that.
        //    - Otherwise use the header K:.

        const lines = content.split('\n');

        // Find line number of cursor
        let charCount = 0;
        let cursorLineIdx = 0;
        for (let i = 0; i < lines.length; i++) {
            const lineLen = lines[i].length + 1; // +1 for newline
            if (charCount + lineLen > cursor) {
                cursorLineIdx = i;
                break;
            }
            charCount += lineLen;
        }

        // Find start of tune (X:) backwards from cursorLineIdx
        let startLineIdx = 0;
        for (let i = cursorLineIdx; i >= 0; i--) {
            if (lines[i].trim().startsWith('X:')) {
                startLineIdx = i;
                break;
            }
        }

        // Find end of tune (next X: or end of file)
        let endLineIdx = lines.length - 1;
        for (let i = cursorLineIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('X:')) {
                endLineIdx = i - 1;
                break;
            }
        }

        // Now look for K: in the range [startLineIdx, endLineIdx]
        // Priority:
        // 1. Inline [K:...] on the same line before cursor? Or previous lines in body?
        //    - Inline keys usually apply from that point onwards.
        //    - We should scan from startLineIdx to cursorLineIdx.
        //    - Keep track of the "latest" key found.

        let foundKey = 'C'; // Default

        // Scan from start of tune to cursor line
        for (let i = startLineIdx; i <= cursorLineIdx; i++) {
            let line = lines[i];

            // If we are on the cursor line, only consider content before cursor
            if (i === cursorLineIdx) {
                // Calculate column index
                // charCount is start of this line (calculated above? No, I didn't save it properly in loop)
                // Let's re-calculate column.
                // Actually, simpler: just substring the whole content up to cursor.
                // But we want to respect the "Tune Block" boundary.
                // So we only look at content from `startLineIdx` to `cursor`.
            }

            // Check for K: line (Header)
            // Only if it's a header line? K: in body is usually [K:...]
            // But sometimes people write K: in body? Standard ABC says K: is header or inline field.
            // Regex for line starting with K:
            const kLineMatch = line.match(/^K:(.*)/);
            if (kLineMatch) {
                foundKey = kLineMatch[1].trim();
            }

            // Check for inline [K:...]
            // There might be multiple in a line.
            // Use while loop with exec instead of matchAll for compatibility
            const inlineRegex = /\[K:([^\]]*)\]/g;
            let inlineMatch;
            const matches = [];
            while ((inlineMatch = inlineRegex.exec(line)) !== null) {
                matches.push(inlineMatch);
            }

            if (matches.length > 0) {
                // If on cursor line, check position
                if (i === cursorLineIdx) {
                    // We need exact char position relative to line start
                    // This is getting complicated with line splitting.
                    // Let's simplify:
                    // Just scan the text from `startLineIdx` (byte offset) to `cursor`.
                } else {
                    // Take the last one in the line
                    foundKey = matches[matches.length - 1][1].trim();
                }
            }
        }

        // Re-implementation using substring for precision
        // 1. Get offset of startLineIdx
        let startOffset = 0;
        for (let i = 0; i < startLineIdx; i++) {
            startOffset += lines[i].length + 1;
        }

        // 2. Get text from start of tune to cursor
        const textBeforeCursor = content.substring(startOffset, cursor);

        // 3. Scan this text for K: directives
        // We want the *last* K: directive found.
        // It can be `^K: ...` (start of line) or `[K:...]` (inline).
        // Regex: `(?:^|\n)K:(.*)|\[K:([^\]]*)\]`
        // We iterate matches and update foundKey.

        const regex = /(?:^|\n)K:([^\n]*)|\[K:([^\]]*)\]/g;
        let match;
        while ((match = regex.exec(textBeforeCursor)) !== null) {
            if (match[1]) { // K: at start of line
                foundKey = match[1].trim();
            } else if (match[2]) { // [K:...]
                foundKey = match[2].trim();
            }
        }

        // If no K found in textBeforeCursor, maybe it's in the header *after* the cursor?
        // (User's case: cursor at X:1, K: is below)
        // If we found NO key yet, scan forward from cursor to endLineIdx for a Header K:.
        // But only Header K: (start of line), not inline [K:] (which applies later).

        if (foundKey === 'C') { // Assuming C is default/not found
            // Check if we actually found a "K: C" or just default.
            // Let's use null or empty string to distinguish?
            // But parseKey defaults to C.
            // Let's scan forward.

            // Get text from cursor to end of tune
            let endOffset = 0;
            for (let i = 0; i <= endLineIdx; i++) {
                endOffset += lines[i].length + 1;
            }
            const textAfterCursor = content.substring(cursor, endOffset);

            // Look for first K: line
            const forwardMatch = textAfterCursor.match(/(?:^|\n)K:([^\n]*)/);
            if (forwardMatch) {
                foundKey = forwardMatch[1].trim();
            }
        }

        // Clean up key string (remove brackets if any leaked, though regex handles it)
        // Also handle "clef=..." removal if parseKey doesn't? 
        // parseKey now handles modifiers by ignoring them.

        if (foundKey !== this.currentKey || this.buttonContainer.children.length === 0) {
            this.currentKey = foundKey;
            this.renderButtons();
        }
    }

    refresh() {
        this.renderButtons();
    }

    private renderButtons() {
        this.buttonContainer.empty();

        const { root, mode } = parseKey(this.currentKey);

        // Update Header
        let displayKey = this.currentKey;
        // If key is empty or just "C", display "C major" or just "C"?
        // Prompt says "Chords in Cmajor:".
        // Let's format it nicely.
        // If mode is major, append "major" if not present?
        // parseKey returns root and mode.
        // If mode is major, we can say "Root major".
        // If mode is minor, "Root minor".

        const modeText = mode === 'major' ? 'major' : 'minor';
        this.header.innerText = `Chords in ${root}${modeText}:`;

        const isDark = document.body.classList.contains('theme-dark');

        // Define chords for the key
        const degrees = [1, 2, 3, 4, 5, 6, 7];

        degrees.forEach(degree => {
            this.createChordButton(root, mode, degree, isDark);
        });

        // Add Rest Button
        this.createRestButton(isDark);
    }

    private createChordButton(root: string, mode: 'major' | 'minor', degree: number, isDark: boolean) {
        // Calculate Chord Notes
        // Triad: Root, 3rd, 5th
        // Indices in scale (0-6):
        const rootIdx = degree - 1;
        const thirdIdx = (rootIdx + 2) % 7;
        const fifthIdx = (rootIdx + 4) % 7;

        // Get Note Names (e.g. "C", "^F")
        const rootNote = getScaleNote(root, mode, rootIdx + 1);
        const thirdNote = getScaleNote(root, mode, thirdIdx + 1);
        const fifthNote = getScaleNote(root, mode, fifthIdx + 1);

        // Helper to get semitone value of a note string
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

        // Adjust octaves to be strictly increasing
        // Root is base (0-11 range roughly, but accidentals might push it out, e.g. Cb=-1, B#=12)
        // We assume Root is in the "base" octave.

        // If 3rd is lower than Root, add 12
        // We compare "normalized" values? No, we want absolute pitch relative to Root.
        // But getScaleNote returns values in 0-11 range (approx).
        // Example: Root B(11). 3rd D(2). 2 < 11. So add 12 -> 14.
        if (thirdVal < rootVal) thirdVal += 12;

        // If 5th is lower than 3rd, add 12
        // Example: 3rd D(14). 5th F(5). 5 < 14. Add 12 -> 17.
        // Example: Root C(0). 3rd E(4). 5th G(7). 4>0, 7>4. No change.
        if (fifthVal < thirdVal) fifthVal += 12;

        // Format Note based on value
        // If value >= 12, use lowercase.
        // We need to preserve the accidental and base name from the original note string.
        // Just change the case of the base letter.

        const formatNote = (note: string, val: number) => {
            const match = note.match(/^([\^=_]*)([A-G])$/);
            if (!match) return note;
            const acc = match[1];
            const base = match[2];

            // If val >= 12, lowercase.
            // Note: B(11) is Upper. C(12) is Lower.
            // B#(12) -> Lower? Yes, B# is enharmonic to C.
            // Cb(-1) -> Upper? Yes.

            if (val >= 12) {
                return `${acc}${base.toLowerCase()}`;
            } else {
                return `${acc}${base}`;
            }
        };

        const finalRoot = formatNote(rootNote, rootVal);
        const finalThird = formatNote(thirdNote, thirdVal);
        const finalFifth = formatNote(fifthNote, fifthVal);

        const chordString = `[${finalRoot}${finalThird}${finalFifth}]`;

        // Determine Label (Roman Numeral)
        // Major: I, ii, iii, IV, V, vi, vii°
        // Minor: i, ii°, III, iv, v, VI, VII

        let roman = '';
        let quality = ''; // m, dim, aug

        const majorRomans = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
        const minorRomans = ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'];

        // Qualities for Major Scale
        // I (Maj), ii (m), iii (m), IV (Maj), V (Maj), vi (m), vii (dim)
        const majorQualities = ['', 'm', 'm', '', '', 'm', 'dim'];

        // Qualities for Minor Scale (Natural)
        // i (m), ii (dim), III (Maj), iv (m), v (m), VI (Maj), VII (Maj)
        const minorQualities = ['m', 'dim', '', 'm', 'm', '', ''];

        if (mode === 'major') {
            roman = majorRomans[degree - 1];
            quality = majorQualities[degree - 1];
        } else {
            roman = minorRomans[degree - 1];
            quality = minorQualities[degree - 1];
        }

        // Special handling for dim symbol in roman
        let displayRoman = roman;
        if (quality === 'dim' && (degree === 7 || (mode === 'minor' && degree === 2))) {
            // Usually written as vii° or ii°
            // The array has 'vii' or 'ii'. We append ° if needed?
            // The prompt SVG uses <tspan>o</tspan> for dim.
        }

        // Colors from prompt
        // Dark Theme Colors
        const darkColors = ['#A62114', '#A65F16', '#A89917', '#4CB014', '#3094A7', '#7E00B0', '#A7009C'];
        // Light Theme Colors
        const lightColors = ['#ff0000', '#ffb014', '#EFE600', '#00D300', '#4800FF', '#B800E5', '#FF00CB'];

        const colors = isDark ? darkColors : lightColors;
        const color = colors[degree - 1];

        // CSS Variables for integration
        // Middle Rect: var(--background-secondary) or var(--background-primary)
        // Text: var(--text-normal)
        // We use 'fill' attribute in SVG.

        const middleRectFill = 'var(--background-secondary)'; // Integrated color
        const textFill = 'var(--text-normal)'; // Integrated color

        // Create Button UI
        const container = this.buttonContainer.createDiv({ cls: 'div-chord-button-container flex flex-direction-column flex-align-items-center' });
        container.style.cursor = 'pointer';

        // SVG Button
        const btnDiv = container.createDiv({ cls: 'div-chord-button' });

        // We construct the SVG manually or using innerHTML
        // Using innerHTML for the complex SVG provided

        // Roman Numeral Logic for SVG
        // We need to split roman chars for <tspan> if we want to match exact style, 
        // or just put text. The prompt splits them: <tspan class="times">I</tspan>...
        // Let's just use text for simplicity unless we want to be exact.
        // The prompt uses specific classes "times".

        const romanHtml = displayRoman.split('').map(c => `<tspan class="times" style="font-family: 'Times New Roman', serif; font-weight: bold;">${c}</tspan>`).join('');

        // Diminished symbol
        // Note: x/y positioning in SVG is tricky without exact metrics. 
        // The prompt uses specific transforms.
        // Let's try to approximate or use a simpler SVG if exact one is too hard to generate dynamically.
        // But the user asked for "what you see in the image".

        // Let's use a standard template and inject values.

        btnDiv.innerHTML = `
        <svg height="46" width="50" viewBox="0 0 50 46" overflow="visible">
            <g>
                <rect x="0" y="0" height="6" width="50" fill="${color}"></rect>
                <rect x="0" y="40" height="6" width="50" fill="${color}"></rect>
                <rect x="0" y="6" height="34" width="50" fill="${middleRectFill}"></rect>
            </g>
            <g transform="translate(25, 26)">
                <text fill="${textFill}" font-size="28" text-anchor="middle" y="6">
                    ${romanHtml}
                </text>
                ${quality === 'dim' ? `<text fill="${textFill}" font-size="12" x="14" y="-6">o</text>` : ''}
            </g>
        </svg>
        `;

        // Label below (Note Name)
        const labelDiv = container.createDiv();
        // Note name: rootNote (e.g. "C", "^F")
        // We need to parse accidental for display?
        // Prompt: <tspan>C</tspan><tspan data-type="quality">m</tspan>...

        // Parse rootNote for display
        // ^F -> F#
        // _B -> Bb
        // =C -> C

        let displayRoot = rootNote.replace(/\^/g, '♯').replace(/_/g, '♭').replace(/=/g, '');
        // If double sharp/flat, handle if needed.

        // Quality for label
        // Major: ""
        // Minor: "m"
        // Dim: "dim" (or "o"?) Prompt uses "m" for minor, nothing for major.
        // Prompt for vii° (Bdim) uses "b" and superscript "o".

        let labelQuality = '';
        if (quality === 'm') labelQuality = 'm';
        if (quality === 'dim') labelQuality = '°'; // or o

        labelDiv.innerHTML = `
        <svg height="30" width="50" viewBox="0 0 50 30">
            <text x="25" y="11" fill="${textFill}" text-anchor="middle" dominant-baseline="middle" font-size="24" transform="translate(12, 5) scale(0.5)">
                <tspan>${displayRoot}</tspan>
                <tspan font-size="20" dy="-5">${labelQuality}</tspan>
            </text>
        </svg>
        `;

        // Click Handler
        container.addEventListener('click', () => {
            this.insertChord(chordString);
        });
    }

    private createRestButton(isDark: boolean) {
        const container = this.buttonContainer.createDiv({ cls: 'div-chord-button-container flex flex-direction-column flex-align-items-center' });
        container.style.cursor = 'pointer';

        const restColor = isDark ? '#444' : '#aaa';
        const middleRectFill = 'var(--background-secondary)';
        const textFill = 'var(--text-normal)';

        const btnDiv = container.createDiv({ cls: 'div-chord-button' });
        btnDiv.innerHTML = `
        <svg height="46" width="50" viewBox="0 0 50 46" overflow="visible">
            <g>
                <rect x="0" y="0" height="6" width="50" fill="${restColor}"></rect>
                <rect x="0" y="40" height="6" width="50" fill="${restColor}"></rect>
                <rect x="0" y="6" height="34" width="50" fill="${middleRectFill}"></rect>
            </g>
        </svg>
        `;

        const labelDiv = container.createDiv();
        labelDiv.innerHTML = `
        <svg height="30" width="50" viewBox="0 0 50 30">
            <text x="25" y="11" fill="${textFill}" text-anchor="middle" dominant-baseline="middle" font-size="24" transform="translate(12, 5) scale(0.5)">
                <tspan>rest</tspan>
            </text>
        </svg>
        `;

        container.addEventListener('click', () => {
            this.insertChord('z');
        });
    }

    private insertChord(text: string) {
        const view = this.editorViewGetter();
        if (!view) return;

        const state = view.state;
        const selection = state.selection.main;

        view.dispatch({
            changes: {
                from: selection.from,
                to: selection.to,
                insert: text
            },
            selection: EditorSelection.cursor(selection.from + text.length),
            scrollIntoView: true
        });
        view.focus();
    }
}
