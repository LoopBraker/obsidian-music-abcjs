import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { parseKey, getScaleNote, NOTE_VALUES, ACCIDENTALS } from './transposer';

export class ChordButtonBar {
    private container: HTMLElement;
    private header: HTMLElement;
    private buttonContainer: HTMLElement;
    private modifierContainer: HTMLElement;
    private currentKey: string = 'C';
    private currentExtension: 'triad' | '7' | '9' | '11' | '13' = 'triad';
    private isAddMode: boolean = false;
    private _is8vaEnabled: boolean = false;

    get is8vaEnabled(): boolean {
        return this._is8vaEnabled;
    }

    constructor(parent: HTMLElement, private editorViewGetter: () => EditorView | null) {
        this.container = parent.createDiv({ cls: 'abc-chord-button-bar-wrapper' });
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.marginBottom = '10px';
        this.container.style.gap = '5px';

        // Header
        this.header = this.container.createDiv({ cls: 'abc-chord-button-bar-header' });
        this.header.style.marginLeft = '12px';
        this.header.style.fontSize = '12px';
        this.header.style.color = 'var(--text-normal)';
        this.header.style.fontFamily = 'sans-serif';
        this.header.innerText = 'Chords in C:';

        // Button Container
        this.buttonContainer = this.container.createDiv({ cls: 'abc-chord-button-bar-container' });
        this.buttonContainer.style.display = 'flex';
        this.buttonContainer.style.justifyContent = 'center';
        this.buttonContainer.style.gap = '10px';
        this.buttonContainer.style.flexWrap = 'wrap';

        // Modifier Container
        this.modifierContainer = this.container.createDiv({ cls: 'abc-chord-modifier-container' });
        this.modifierContainer.style.display = 'flex';
        this.modifierContainer.style.justifyContent = 'center';
        this.modifierContainer.style.gap = '5px';
        this.modifierContainer.style.marginTop = '5px';

        this.renderModifierButtons();
    }

    update(content: string, cursor: number) {
        const lines = content.split('\n');

        let charCount = 0;
        let cursorLineIdx = 0;
        for (let i = 0; i < lines.length; i++) {
            const lineLen = lines[i].length + 1;
            if (charCount + lineLen > cursor) {
                cursorLineIdx = i;
                break;
            }
            charCount += lineLen;
        }

        let startLineIdx = 0;
        for (let i = cursorLineIdx; i >= 0; i--) {
            if (lines[i].trim().startsWith('X:')) {
                startLineIdx = i;
                break;
            }
        }

        let endLineIdx = lines.length - 1;
        for (let i = cursorLineIdx + 1; i < lines.length; i++) {
            if (lines[i].trim().startsWith('X:')) {
                endLineIdx = i - 1;
                break;
            }
        }

        let foundKey = 'C';

        let startOffset = 0;
        for (let i = 0; i < startLineIdx; i++) {
            startOffset += lines[i].length + 1;
        }

        const textBeforeCursor = content.substring(startOffset, cursor);

        const regex = /(?:^|\n)K:([^\n]*)|\[K:([^\]]*)\]/g;
        let match;
        while ((match = regex.exec(textBeforeCursor)) !== null) {
            if (match[1]) {
                foundKey = match[1].trim();
            } else if (match[2]) {
                foundKey = match[2].trim();
            }
        }

        if (foundKey === 'C') {
            let endOffset = 0;
            for (let i = 0; i <= endLineIdx; i++) {
                endOffset += lines[i].length + 1;
            }
            const textAfterCursor = content.substring(cursor, endOffset);

            const forwardMatch = textAfterCursor.match(/(?:^|\n)K:([^\n]*)/);
            if (forwardMatch) {
                foundKey = forwardMatch[1].trim();
            }
        }

        if (foundKey !== this.currentKey || this.buttonContainer.children.length === 0) {
            this.currentKey = foundKey;
            this.renderButtons();
        }
    }

    refresh() {
        this.renderButtons();
    }

    private renderModifierButtons() {
        this.modifierContainer.empty();
        const extensions: ('triad' | '7' | '9' | '11' | '13')[] = ['triad', '7', '9', '11', '13'];

        extensions.forEach(ext => {
            const btn = this.modifierContainer.createEl('button', {
                text: ext === 'triad' ? 'Triad' : ext,
                cls: 'abc-chord-modifier-btn'
            });

            // Style matching "font size the same of the name of the chords below the chord buttons" (approx 12px)
            btn.style.fontSize = '12px';
            btn.style.padding = '2px 8px';
            btn.style.cursor = 'pointer';
            btn.style.backgroundColor = this.currentExtension === ext ? 'var(--interactive-accent)' : 'var(--background-primary)';
            btn.style.color = this.currentExtension === ext ? 'var(--text-on-accent)' : 'var(--text-normal)';
            btn.style.border = '1px solid var(--background-modifier-border)';
            btn.style.borderRadius = '4px';

            btn.addEventListener('click', () => {
                this.currentExtension = ext;
                // If switching to Triad or 7, disable Add mode
                if (ext === 'triad' || ext === '7') {
                    this.isAddMode = false;
                }
                this.renderModifierButtons(); // Re-render to update active state
                // No need to re-render chord buttons if logic is dynamic on click
            });
        });

        // Add "8va" Toggle Button
        const vaBtn = this.modifierContainer.createEl('button', {
            text: '8va',
            cls: 'abc-chord-modifier-btn'
        });
        vaBtn.style.fontSize = '12px';
        vaBtn.style.padding = '2px 8px';
        vaBtn.style.cursor = 'pointer';
        vaBtn.style.backgroundColor = this._is8vaEnabled ? 'var(--interactive-accent)' : 'var(--background-primary)';
        vaBtn.style.color = this._is8vaEnabled ? 'var(--text-on-accent)' : 'var(--text-normal)';
        vaBtn.style.border = '1px solid var(--background-modifier-border)';
        vaBtn.style.borderRadius = '4px';
        vaBtn.addEventListener('click', () => {
            this._is8vaEnabled = !this._is8vaEnabled;
            this.renderModifierButtons();
        });

        // Add "Add" Button
        const isAddDisabled = this.currentExtension === 'triad' || this.currentExtension === '7';
        const addBtn = this.modifierContainer.createEl('button', {
            text: 'Add',
            cls: 'abc-chord-modifier-btn'
        });

        addBtn.style.fontSize = '12px';
        addBtn.style.padding = '2px 8px';
        addBtn.style.cursor = isAddDisabled ? 'not-allowed' : 'pointer';
        addBtn.style.backgroundColor = this.isAddMode ? 'var(--interactive-accent)' : 'var(--background-primary)';
        addBtn.style.color = this.isAddMode ? 'var(--text-on-accent)' : (isAddDisabled ? 'var(--text-muted)' : 'var(--text-normal)');
        addBtn.style.border = '1px solid var(--background-modifier-border)';
        addBtn.style.borderRadius = '4px';
        if (isAddDisabled) {
            addBtn.style.opacity = '0.5';
        }

        addBtn.addEventListener('click', () => {
            if (!isAddDisabled) {
                this.isAddMode = !this.isAddMode;
                this.renderModifierButtons();
            }
        });
    }

    private renderButtons() {
        this.buttonContainer.empty();

        const { root, mode } = parseKey(this.currentKey);

        const modeText = mode === 'major' ? 'major' : 'minor';
        this.header.innerText = `Chords in ${root}${modeText}:`;

        const isDark = document.body.classList.contains('theme-dark');

        const degrees = [1, 2, 3, 4, 5, 6, 7];

        degrees.forEach(degree => {
            this.createChordButton(root, mode, degree, isDark);
        });

        this.createRestButton(isDark);
    }

    private createChordButton(root: string, mode: 'major' | 'minor', degree: number, isDark: boolean) {
        const rootIdx = degree - 1;

        // Determine Label (Roman Numeral)
        let roman = '';
        let quality = '';

        const majorRomans = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii'];
        const minorRomans = ['i', 'ii', 'III', 'iv', 'v', 'VI', 'VII'];
        const majorQualities = ['', 'm', 'm', '', '', 'm', 'dim'];
        const minorQualities = ['m', 'dim', '', 'm', 'm', '', ''];

        if (mode === 'major') {
            roman = majorRomans[degree - 1];
            quality = majorQualities[degree - 1];
        } else {
            roman = minorRomans[degree - 1];
            quality = minorQualities[degree - 1];
        }

        let displayRoman = roman;

        // Colors
        const darkColors = ['#A62114', '#A65F16', '#A89917', '#4CB014', '#3094A7', '#7E00B0', '#A7009C'];
        const lightColors = ['#ff0000', '#ffb014', '#EFE600', '#00D300', '#4800FF', '#B800E5', '#FF00CB'];
        const colors = isDark ? darkColors : lightColors;
        const color = colors[degree - 1];

        const middleRectFill = 'var(--background-secondary)';
        const textFill = 'var(--text-normal)';

        // Create Button UI
        const container = this.buttonContainer.createDiv({ cls: 'div-chord-button-container flex flex-direction-column flex-align-items-center' });
        container.style.cursor = 'pointer';

        const btnDiv = container.createDiv({ cls: 'div-chord-button' });

        const romanHtml = displayRoman.split('').map(c => `<tspan class="times" style="font-family: 'Times New Roman', serif; font-weight: bold;">${c}</tspan>`).join('');

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
        const rootNote = getScaleNote(root, mode, rootIdx + 1);
        let displayRoot = rootNote.replace(/\^/g, '♯').replace(/_/g, '♭').replace(/=/g, '');

        let labelQuality = '';
        if (quality === 'm') labelQuality = 'm';
        if (quality === 'dim') labelQuality = '°';

        labelDiv.innerHTML = `
        <svg height="30" width="50" viewBox="0 0 50 30">
            <text x="25" y="11" fill="${textFill}" text-anchor="middle" dominant-baseline="middle" font-size="24" transform="translate(12, 5) scale(0.5)">
                <tspan>${displayRoot}</tspan>
                <tspan font-size="20" dy="-5">${labelQuality}</tspan>
            </text>
        </svg>
        `;

        // Click Handler - Dynamic Generation
        container.addEventListener('click', () => {
            const chordString = this.generateChordString(root, mode, degree);
            this.insertChord(chordString);
        });
    }

    private generateChordString(root: string, mode: 'major' | 'minor', degree: number): string {
        const rootIdx = degree - 1;
        const indices = [rootIdx, (rootIdx + 2) % 7, (rootIdx + 4) % 7]; // Triad

        if (this.isAddMode) {
            // Non-cumulative logic
            // Triad is already added.
            // If 9, add 9 (skip 7)
            // If 11, add 11 (skip 7, 9)
            // If 13, add 13 (skip 7, 9, 11)

            if (this.currentExtension === '9') {
                indices.push((rootIdx + 8) % 7); // 9th
            } else if (this.currentExtension === '11') {
                indices.push((rootIdx + 10) % 7); // 11th
            } else if (this.currentExtension === '13') {
                indices.push((rootIdx + 12) % 7); // 13th
            }
            // If 7, isAddMode should be false/disabled, but if it was somehow true, we just add 7?
            // But logic says disable Add for 7.
        } else {
            // Cumulative logic
            if (this.currentExtension === '7' || this.currentExtension === '9' || this.currentExtension === '11' || this.currentExtension === '13') {
                indices.push((rootIdx + 6) % 7); // 7th
            }
            if (this.currentExtension === '9' || this.currentExtension === '11' || this.currentExtension === '13') {
                indices.push((rootIdx + 8) % 7); // 9th (same as 2nd but octave up)
            }
            if (this.currentExtension === '11' || this.currentExtension === '13') {
                indices.push((rootIdx + 10) % 7); // 11th
            }
            if (this.currentExtension === '13') {
                indices.push((rootIdx + 12) % 7); // 13th
            }
        }

        // Get notes and values
        const notes = indices.map(idx => getScaleNote(root, mode, idx + 1));

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

        const noteValues = notes.map(n => getNoteValue(n));
        const adjustedValues = [...noteValues];

        // Adjust octaves
        // We need to ensure strictly increasing pitch relative to root.
        // But for extensions (9, 11, 13), they are naturally higher than 7.
        // However, since we use modulo 7 indices, getScaleNote returns base octave notes.
        // So we need to add 12 for every "wrap" around the scale?
        // Or just ensure each note is higher than the previous.

        // Root is base.
        // 3rd: if < root, +12.
        // 5th: if < 3rd, +12.
        // 7th: if < 5th, +12.
        // 9th: if < 7th, +12.
        // etc.

        // Wait, 9th is 2nd degree. 2nd is usually < 7th (in base octave).
        // So 9th will definitely need +12 relative to root?
        // Actually, just ensuring strictly increasing is enough?
        // Example: C Major.
        // Root C(0). 3rd E(4). 5th G(7). 7th B(11). 9th D(2).
        // 2 < 11 -> add 12 -> 14. Correct (D above middle C).
        // 11th F(5). 5 < 14 -> add 12 -> 17. Correct.
        // 13th A(9). 9 < 17 -> add 12 -> 21. Correct.

        // But what if 3rd wraps?
        // B Locrian: B(11), D(2), F(5).
        // Root 11.
        // 3rd 2 < 11 -> 14.
        // 5th 5 < 14 -> 17.
        // Correct.

        // So the logic "if val < prevVal, add 12" works for simple stacking.
        // But we need to accumulate +12s.
        // If we add 12 to 3rd, 5th is compared        // Adjust octaves
        let currentOctaveOffset = 0;
        if (!this._is8vaEnabled) {
            for (let i = 1; i < adjustedValues.length; i++) {
                while (adjustedValues[i] <= adjustedValues[i - 1]) {
                    adjustedValues[i] += 12;
                }
            }
        }

        // Add Mode Octave Boost
        // Ensure 9, 11, 13 are at least root + 12 (compound intervals)
        if (!this._is8vaEnabled && this.isAddMode && (this.currentExtension === '9' || this.currentExtension === '11' || this.currentExtension === '13')) {
            const lastIdx = adjustedValues.length - 1;
            while (adjustedValues[lastIdx] < adjustedValues[0] + 12) {
                adjustedValues[lastIdx] += 12;
            }
        }

        const formatNote = (note: string, val: number) => {
            const match = note.match(/^([\^=_]*)([A-G])$/);
            if (!match) return note;
            const acc = match[1];
            const base = match[2];

            if (val >= 12) {
                // If val is very high (e.g. 24+), we might need 'c' (12-23), 'c'' (24-35)?
                // ABC notation:
                // C, (low)
                // C (middle)
                // c (high)
                // c' (very high)

                // Our base assumption: Root is in C-B range (0-11 approx).
                // If val >= 12 and < 24: lowercase (c-b).
                // If val >= 24: lowercase + ' (c'-b').

                let suffix = '';
                let isLower = false;

                if (val >= 12) {
                    isLower = true;
                    const octavesAbove = Math.floor((val - 12) / 12);
                    // 12-23: 0 octaves above 'c' -> suffix ''
                    // 24-35: 1 octave above 'c' -> suffix "'"
                    for (let k = 0; k < octavesAbove; k++) suffix += "'";
                }

                return `${acc}${isLower ? base.toLowerCase() : base}${suffix}`;
            } else {
                return `${acc}${base}`;
            }
        };

        const formattedNotes = notes.map((n, i) => formatNote(n, adjustedValues[i]));
        return `[${formattedNotes.join('')}]`;
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
