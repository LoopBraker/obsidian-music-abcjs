import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

interface PercMap {
    label: string; // The note name or label (e.g. "Kick", "Snare") - derived or explicit? User just gives char and midi. 
    // The user example: %%percmap g 42.  
    // 42 is Closed Hi-Hat in GM. 38 is Snare. 35 (sic, usually 36) is Kick (35 is Acoustic Bass Drum).
    char: string;
    midi: number;
}

interface Token {
    text: string;
    start: number;
    end: number;
    notes: string[]; // ['A', 'G'] or [] for rest
    duration: number; // in 16th note ticks
}

// GM Drum Map (Subset for labels)
const GM_DRUMS: { [key: number]: string } = {
    35: "Acoustic Bass Drum",
    36: "Bass Drum 1",
    37: "Side Stick",
    38: "Acoustic Snare",
    39: "Hand Clap",
    40: "Electric Snare",
    41: "Low Floor Tom",
    42: "Closed Hi Hat",
    43: "High Floor Tom",
    44: "Pedal Hi-Hat",
    45: "Low Tom",
    46: "Open Hi-Hat",
    47: "Low-Mid Tom",
    48: "Hi-Mid Tom",
    49: "Crash Cymbal 1",
    50: "High Tom",
    51: "Ride Cymbal 1",
    52: "Chinese Cymbal",
    53: "Ride Bell",
    54: "Tambourine",
    55: "Splash Cymbal",
    56: "Cowbell",
    57: "Crash Cymbal 2",
    59: "Ride Cymbal 2",
};

export class DrumGrid {
    private container: HTMLElement;
    private gridContainer: HTMLElement;
    private percMaps: PercMap[] = [];
    private visibleMaps: PercMap[] = []; // The ones shown in the grid
    private maxVisible = 3;
    private currentBar: string = "";
    private currentBarContext: { start: number, end: number } | null = null;
    private timeSignatureOpt = 16; // Granularity (16th notes)

    constructor(parent: HTMLElement, private editorViewGetter: () => EditorView | null) {
        this.container = parent.createDiv({ cls: 'abc-drum-grid-wrapper' });
        this.container.style.display = 'none'; // Hidden by default (Chord view is default)
        this.container.style.flexDirection = 'column';
        this.container.style.marginBottom = '10px';
        this.container.style.marginTop = '10px';
        this.container.style.gap = '5px';

        this.gridContainer = this.container.createDiv({ cls: 'abc-drum-main-grid' });
        // Grid styling will be handled in CSS mostly, but flex layout is safe here
        this.gridContainer.style.display = 'flex';
        this.gridContainer.style.flexDirection = 'column';
        this.gridContainer.style.gap = '2px';
    }

    show() {
        this.container.style.display = 'flex';
    }

    hide() {
        this.container.style.display = 'none';
    }

    private lastContent: string = "";

    update(content: string, cursor: number) {
        // 1. Parse %%percmap directives only if content changed
        if (content !== this.lastContent) {
            this.parsePercMaps(content);
            this.lastContent = content;
        }

        // 2. Identify the current bar
        const previousBar = this.currentBar;
        this.identifyCurrentBar(content, cursor);

        // 3. Render only if bar changed (or forced? No, explicit changes call render)
        if (this.currentBar !== previousBar) {
            this.render();
        }
    }

    private parsePercMaps(content: string) {
        const matches = Array.from(content.matchAll(/^%%percmap\s+(\S+)\s+(\d+)/gm));
        this.percMaps = [];
        for (const match of matches) {
            const char = match[1];
            const midi = parseInt(match[2]);
            const label = GM_DRUMS[midi] || `Drum ${midi}`;
            this.percMaps.push({ char, midi, label });
        }

        // Default logic: show first 3 found maps if no visibility state is set
        // Or if we haven't initialized visible maps yet
        if (this.visibleMaps.length === 0 && this.percMaps.length > 0) {
            this.visibleMaps = this.percMaps.slice(0, this.maxVisible);
        }
    }

    private identifyCurrentBar(content: string, cursor: number) {
        // Simple bar detection: look for | before and | after
        // This is naive and might fail with complex abc, but fits the "simple" requirement

        // Search backwards for '|'
        let start = content.lastIndexOf('|', cursor - 1);
        if (start === -1) start = 0; // Start of string if no bar line found
        else start += 1; // Move past the '|'

        // Search forwards for '|'
        let end = content.indexOf('|', cursor);
        if (end === -1) end = content.length;

        this.currentBarContext = { start, end };
        this.currentBar = content.substring(start, end);
    }

    private render() {
        this.gridContainer.empty();

        if (this.percMaps.length === 0) {
            this.gridContainer.createDiv({ text: "No %%percmap directives found." });
            return;
        }

        const cellWidth = 28;
        const cellHeight = 32;
        const labelWidth = 90;
        const beatGroupGap = 8; // Gap between beat groups

        // --- Render Header Row (1 e & a ...) grouped in boxes ---
        const headerRow = this.gridContainer.createDiv({ cls: 'abc-drum-row abc-drum-header' });
        headerRow.style.display = 'flex';
        headerRow.style.marginLeft = `${labelWidth + 10}px`;
        headerRow.style.gap = `${beatGroupGap}px`;

        // 4 beat groups
        const beatLabels = [['1', 'e', '&', 'a'], ['2', 'e', '&', 'a'], ['3', 'e', '&', 'a'], ['4', 'e', '&', 'a']];
        beatLabels.forEach((group) => {
            const beatGroup = headerRow.createDiv({ cls: 'abc-drum-beat-group' });
            beatGroup.style.display = 'flex';
            beatGroup.style.border = '1px solid var(--background-modifier-border)';
            beatGroup.style.borderRadius = '4px';
            beatGroup.style.padding = '4px 0';
            beatGroup.style.backgroundColor = 'var(--background-secondary)';

            group.forEach((b, i) => {
                const cell = beatGroup.createDiv({ cls: 'abc-drum-header-cell' });
                cell.innerText = b;
                cell.style.width = `${cellWidth}px`;
                cell.style.textAlign = 'center';
                cell.style.fontSize = '12px';
                cell.style.fontWeight = i === 0 ? 'bold' : 'normal';
                cell.style.color = 'var(--text-normal)';
            });
        });

        // --- Render Instrument Rows with line grid ---
        const parsedNotes = this.parseBarToGrid(this.currentBar);

        this.visibleMaps.forEach((map, rowIndex) => {
            const row = this.gridContainer.createDiv({ cls: 'abc-drum-row abc-drum-instrument-row' });
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.position = 'relative';
            row.style.height = `${cellHeight}px`;

            // Label Button
            const label = row.createEl('button', { cls: 'abc-drum-label', text: map.label });
            label.style.width = `${labelWidth}px`;
            label.style.marginRight = '10px';
            label.style.fontSize = '11px';
            label.style.overflow = 'hidden';
            label.style.whiteSpace = 'nowrap';
            label.style.textOverflow = 'ellipsis';
            label.style.border = '1px solid var(--background-modifier-border)';
            label.style.borderRadius = '4px';
            label.style.backgroundColor = 'var(--background-secondary)';
            label.style.color = 'var(--text-normal)';
            label.style.padding = '4px 8px';
            label.style.cursor = 'pointer';

            // Grid area container
            const gridArea = row.createDiv({ cls: 'abc-drum-grid-area' });
            gridArea.style.display = 'flex';
            gridArea.style.position = 'relative';
            gridArea.style.height = `${cellHeight}px`;
            gridArea.style.gap = `${beatGroupGap}px`;

            // Render 4 beat groups
            for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
                const beatGroup = gridArea.createDiv({ cls: 'abc-drum-beat-grid-group' });
                beatGroup.style.display = 'flex';
                beatGroup.style.position = 'relative';
                beatGroup.style.height = '100%';

                // Horizontal line through the middle (aligned with instrument)
                const hLine = beatGroup.createDiv({ cls: 'abc-drum-h-line' });
                hLine.style.position = 'absolute';
                hLine.style.top = '50%';
                hLine.style.left = '0';
                hLine.style.right = '0';
                hLine.style.height = '1px';
                hLine.style.borderTop = '1px dashed var(--background-modifier-border)';
                hLine.style.pointerEvents = 'none';

                // 4 steps per beat group
                for (let stepIdx = 0; stepIdx < 4; stepIdx++) {
                    const globalStep = beatIdx * 4 + stepIdx;
                    const stepContainer = beatGroup.createDiv({ cls: 'abc-drum-step' });
                    stepContainer.style.width = `${cellWidth}px`;
                    stepContainer.style.height = '100%';
                    stepContainer.style.position = 'relative';
                    stepContainer.style.cursor = 'pointer';
                    stepContainer.style.display = 'flex';
                    stepContainer.style.justifyContent = 'center';
                    stepContainer.style.alignItems = 'center';

                    // Vertical line at each step (centered)
                    const vLine = stepContainer.createDiv({ cls: 'abc-drum-v-line' });
                    vLine.style.position = 'absolute';
                    vLine.style.left = '50%';
                    vLine.style.top = '0';
                    vLine.style.bottom = '0';
                    vLine.style.width = '1px';
                    vLine.style.borderLeft = '1px dashed var(--background-modifier-border)';
                    vLine.style.pointerEvents = 'none';

                    // Diamond at intersection if note is active
                    const isActive = parsedNotes[globalStep] && parsedNotes[globalStep].includes(map.char);
                    if (isActive) {
                        const diamond = stepContainer.createDiv({ cls: 'abc-drum-diamond' });
                        diamond.style.width = '14px';
                        diamond.style.height = '14px';
                        diamond.style.backgroundColor = 'var(--text-normal)';
                        diamond.style.transform = 'rotate(45deg)';
                        diamond.style.zIndex = '1';
                        diamond.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
                    }

                    stepContainer.addEventListener('click', () => {
                        this.toggleNote(globalStep, map.char);
                    });

                    // Hover effect
                    stepContainer.addEventListener('mouseenter', () => {
                        if (!isActive) {
                            stepContainer.style.backgroundColor = 'var(--background-modifier-hover)';
                        }
                    });
                    stepContainer.addEventListener('mouseleave', () => {
                        stepContainer.style.backgroundColor = 'transparent';
                    });
                }
            }
        });

        // --- Plus Button Row ---
        if (this.visibleMaps.length < this.percMaps.length) {
            const addRow = this.gridContainer.createDiv({ cls: 'abc-drum-row abc-drum-add-row' });
            addRow.style.display = 'flex';
            addRow.style.marginTop = '4px';

            const addBtn = addRow.createEl('button', { text: '+', cls: 'abc-drum-add-btn' });
            addBtn.style.width = `${labelWidth}px`;
            addBtn.style.fontSize = '16px';
            addBtn.style.border = '1px solid var(--background-modifier-border)';
            addBtn.style.borderRadius = '4px';
            addBtn.style.backgroundColor = 'var(--background-secondary)';
            addBtn.style.color = 'var(--text-normal)';
            addBtn.style.padding = '4px 8px';
            addBtn.style.cursor = 'pointer';

            addBtn.addEventListener('click', () => {
                const nextIdx = this.visibleMaps.length;
                if (nextIdx < this.percMaps.length) {
                    this.visibleMaps.push(this.percMaps[nextIdx]);
                    this.render();
                }
            });
        }
    }

    private getNoteDuration(note: string): number {
        // Basic duration parsing. Default 1 (1/16 in our grid context? No, ABC usually defaults to 1/8 or 1/4 depending on L:)
        // For this simplified version, let's assume L:1/16 for now as requested "assume 16th notes"
        // If note has number after it, multiply. If / number, divide.
        // e.g. A2 = 2 slots. A/2 = 0.5 slots.

        // Regex to find duration part
        const match = note.match(/[A-Za-z\^=_\[\]]+([\d/]+)?/);
        if (!match) return 1;
        const durStr = match[1];
        if (!durStr) return 1;

        if (durStr === '/') return 0.5;
        if (durStr.includes('/')) {
            const [num, den] = durStr.split('/').map(x => x === '' ? 1 : parseInt(x));
            return num / den;
        }
        return parseInt(durStr);
    }



    private parseBarToTokens(barText: string): Token[] {
        const tokens: Token[] = [];
        // Regex to match:
        // 1. Chords: [...] (plus duration)
        // 2. Single notes/rests: [\^=_]*[A-Za-z][,']* (plus duration)
        // 3. Rests: z|Z ...

        // We need to be careful to match ONE note at a time if they are adjacent (e.g. "AB").
        // Previous regex was [A-Za-z\^=_]+ which matches "AB" as one block. Bad.

        // Revised Regex:
        // Group 1: Core content (Chord OR Single Note with accidentals/octave OR Rest)
        // Group 2: Duration
        const tokenRegex = /(\[[^\]]+\]|[\^=_]*[A-Za-z][,']*|z|Z|x|X)([\d\/]*)/g;

        let match;
        while ((match = tokenRegex.exec(barText)) !== null) {
            const fullText = match[0];
            const coreContent = match[1];
            const durationStr = match[2];
            const start = match.index;
            const end = start + fullText.length;

            // Parse Duration
            let duration = 1; // Default
            if (durationStr === '/') duration = 0.5;
            else if (durationStr.includes('/')) {
                const parts = durationStr.split('/');
                const num = parts[0] ? parseInt(parts[0]) : 1;
                const den = parts[1] ? parseInt(parts[1]) : 2;
                duration = num / (den / 2); // assuming /2 is base? No.
                if (parts.length === 2 && parts[1] === "") {
                    const d = parseInt(parts[1] || '2'); // "C/" -> C/2
                    duration = (parts[0] ? parseInt(parts[0]) : 1) / d;
                } else if (parts.length === 2) {
                    const n = parts[0] ? parseInt(parts[0]) : 1;
                    const d = parseInt(parts[1]);
                    duration = n / d;
                }
            } else if (durationStr) {
                duration = parseInt(durationStr);
            }

            // Extract Notes
            let notes: string[] = [];
            if (!coreContent.toLowerCase().startsWith('z') && !coreContent.toLowerCase().startsWith('x')) {
                const inner = coreContent.replace(/[\[\]]/g, "");
                // Match regex for individual notes inside chord
                const noteMatches = Array.from(inner.matchAll(/([\^=_]?[A-Za-z][,']*)/g));
                notes = noteMatches.map(m => m[1]);
            }

            tokens.push({ text: fullText, start, end, notes, duration });
        }
        return tokens;
    }

    // Convert current bar string into 16 time slots using tokens
    private parseBarToGrid(barText: string): string[][] {
        const tokens = this.parseBarToTokens(barText);
        const grid: string[][] = Array(16).fill(null).map(() => []);

        let currentTick = 0;
        for (const token of tokens) {
            if (currentTick >= 16) break;

            // Determine how many ticks this token covers
            // For now, round to nearest integer tick, but keep float tracking?
            // "Assume 16th notes" -> Everything usually aligns to integers.
            const ticks = Math.round(token.duration);

            // Populate grid for the ONSET tick only? Or all ticks?
            // Usually step sequencers show the note at the start.
            if (token.notes.length > 0) {
                // Check if these notes match map
                for (const note of token.notes) {
                    for (const map of this.percMaps) {
                        // Loose match or precise?
                        // "g" should match "g". "^g" should match "^g".
                        // Our map.char is usually simple like "A" or "g".
                        if (note === map.char) {
                            grid[Math.floor(currentTick)].push(map.char);
                        }
                    }
                }
            }

            currentTick += (ticks || 1); // Ensure at least 1?
        }
        return grid;
    }

    // Format bar text with beat grouping (4 notes per beat, space between beats)
    private formatBarWithBeatGrouping(tokens: Token[]): string {
        if (tokens.length === 0) return "";

        let result = "";
        let currentTick = 0;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const tokenDur = Math.round(token.duration) || 1;

            // Add space before this token if we're at a beat boundary (every 4 ticks)
            // and this isn't the first token
            if (currentTick > 0 && currentTick % 4 === 0) {
                result += " ";
            }

            // Reconstruct token text
            const durationPart = token.text.replace(/^(\[[^\]]+\]|[\^=_]*[A-Za-z][,']*|z|Z|x|X)/, "");
            let tokenText = "";

            if (token.notes.length === 0) {
                tokenText = "z" + durationPart;
            } else if (token.notes.length === 1) {
                tokenText = token.notes[0] + durationPart;
            } else {
                tokenText = `[${token.notes.join('')}]${durationPart}`;
            }

            result += tokenText;
            currentTick += tokenDur;
        }

        return result;
    }

    private toggleNote(tickIndex: number, char: string) {
        if (!this.currentBarContext || this.currentBar === null) return;

        // 1. Parse existing tokens
        const tokens = this.parseBarToTokens(this.currentBar);

        let currentTick = 0;
        let targetToken: Token | null = null;
        let tokenIndex = -1;

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const tokenDur = Math.round(t.duration) || 1;
            if (currentTick <= tickIndex && (currentTick + tokenDur) > tickIndex) {
                targetToken = t;
                tokenIndex = i;
                break;
            }
            currentTick += tokenDur;
        }

        // Helper to apply change
        const applyChange = (newBarText: string) => {
            const view = this.editorViewGetter();
            if (view && this.currentBarContext) {
                view.dispatch({
                    changes: {
                        from: this.currentBarContext.start,
                        to: this.currentBarContext.end,
                        insert: newBarText
                    }
                });

                // OPTIMISTIC UPDATE
                const lengthDiff = newBarText.length - this.currentBar.length;
                this.currentBar = newBarText;
                this.currentBarContext.end += lengthDiff;

                // Re-render immediately to show diamond/changes
                this.render();
            }
        };

        if (!targetToken) {
            // APPEND MODE - fill gap with rests, then add the note
            const gap = tickIndex - currentTick;
            if (gap < 0) return;

            // Create new tokens for the gap (rests) and the new note
            const newTokens: Token[] = [...tokens];

            for (let k = 0; k < gap; k++) {
                newTokens.push({
                    text: "z",
                    start: 0,
                    end: 0,
                    notes: [],
                    duration: 1
                });
            }

            // Add the new note
            newTokens.push({
                text: char,
                start: 0,
                end: 0,
                notes: [char],
                duration: 1
            });

            const newBar = this.formatBarWithBeatGrouping(newTokens);
            applyChange(newBar);
            return;
        }

        // 2. Modify the target token
        let newNotes = [...targetToken.notes];

        // Toggle logic
        if (newNotes.includes(char)) {
            newNotes = newNotes.filter(n => n !== char);
        } else {
            newNotes.push(char);
        }

        // Update the token in place
        tokens[tokenIndex] = {
            ...targetToken,
            notes: newNotes
        };

        // 3. Rebuild the entire bar with proper beat grouping
        const newBar = this.formatBarWithBeatGrouping(tokens);
        applyChange(newBar);
    }
}
