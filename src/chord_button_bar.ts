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
        this.container.style.marginTop = '10px';
        this.container.style.gap = '5px';

        // Header
        this.header = this.container.createDiv({ cls: 'abc-chord-button-bar-header' });
        // this.header.style.marginLeft = '12px';
        this.header.style.textAlign = 'center';
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
        this.modifierContainer.style.alignItems = 'center'; // Align toggle with buttons
        this.modifierContainer.style.gap = '5px';
        this.modifierContainer.style.marginTop = '0px';

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

        // --- NEW: 8va Toggle Switch (Left Side) ---
        const vaWrapper = this.modifierContainer.createDiv();
        vaWrapper.style.display = 'flex';
        vaWrapper.style.alignItems = 'center';
        vaWrapper.style.gap = '6px';
        vaWrapper.style.marginRight = '8px'; // Extra spacing before Triad button
        vaWrapper.style.cursor = 'pointer';

        // 8va Label
        const vaLabel = vaWrapper.createEl('span', { text: '8va' });
        vaLabel.style.fontSize = '12px';
        vaLabel.style.color = 'var(--text-normal)';
        vaLabel.style.fontWeight = 'bold'; // Optional: make label slightly bolder

        // Toggle Switch Track
        const switchTrack = vaWrapper.createDiv();
        switchTrack.style.width = '28px';
        switchTrack.style.height = '16px';
        switchTrack.style.borderRadius = '10px';
        switchTrack.style.position = 'relative';
        switchTrack.style.backgroundColor = this._is8vaEnabled ? 'var(--interactive-accent)' : 'var(--background-modifier-border)';
        switchTrack.style.transition = 'background-color 0.2s ease';

        // Toggle Switch Knob
        const switchKnob = switchTrack.createDiv();
        switchKnob.style.width = '12px';
        switchKnob.style.height = '12px';
        switchKnob.style.borderRadius = '50%';
        switchKnob.style.backgroundColor = '#ffffff'; // White knob for contrast
        switchKnob.style.position = 'absolute';
        switchKnob.style.top = '2px';
        switchKnob.style.left = this._is8vaEnabled ? '14px' : '2px'; // Slide logic
        switchKnob.style.transition = 'left 0.2s ease';

        // Click Handler
        vaWrapper.addEventListener('click', () => {
            this._is8vaEnabled = !this._is8vaEnabled;
            this.renderModifierButtons();
        });
        // ------------------------------------------

        const extensions: ('triad' | '7' | '9' | '11' | '13')[] = ['triad', '7', '9', '11', '13'];

        extensions.forEach(ext => {
            const btn = this.modifierContainer.createEl('button', {
                text: ext === 'triad' ? 'Triad' : ext,
                cls: 'abc-chord-modifier-btn'
            });

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
                this.renderModifierButtons();
            });
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
        <svg height="15" width="50" viewBox="0 0 50 15">
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
            if (this.currentExtension === '9') {
                indices.push((rootIdx + 8) % 7); // 9th
            } else if (this.currentExtension === '11') {
                indices.push((rootIdx + 10) % 7); // 11th
            } else if (this.currentExtension === '13') {
                indices.push((rootIdx + 12) % 7); // 13th
            }
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
        let currentOctaveOffset = 0;

        // NEW LOGIC: If 8va is disabled (meaning we want "smart" octaves),
        // ensure the chord starts at or above the Key Tonic.
        if (!this._is8vaEnabled) {
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

            const tonicVal = getNoteValue(getScaleNote(root, mode, 1));
            const chordRootVal = adjustedValues[0];

            // If the chord root is lower than the key tonic, shift the whole chord up an octave
            // Example: Key A (val 9). Chord C (val 0). 0 < 9, so shift C to 12.
            if (chordRootVal < tonicVal) {
                for (let i = 0; i < adjustedValues.length; i++) {
                    adjustedValues[i] += 12;
                }
            }
        }

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
                let suffix = '';
                let isLower = false;

                if (val >= 12) {
                    isLower = true;
                    const octavesAbove = Math.floor((val - 12) / 12);
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
        <svg height="15" width="50" viewBox="0 0 50 15">
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