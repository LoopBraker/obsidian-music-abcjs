import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

interface PercMap {
    label: string; // The note name or label (e.g. "Kick", "Snare") - derived or explicit? User just gives char and midi. 
    // The user example: %%percmap g 42.  
    // 42 is Closed Hi-Hat in GM. 38 is Snare. 35 (sic, usually 36) is Kick (35 is Acoustic Bass Drum).
    char: string;
    midi: number;
}

// Grouped instrument (like Hi-Hat with closed/open/accent)
interface GroupedInstrument {
    type: 'grouped';
    label: string;
    closedChar: string;    // e.g., 'g' for closed hi-hat
    openChar: string;      // e.g., '^g' for open hi-hat
    closedMidi: number;
    openMidi: number;
}

// Regular single instrument
interface SingleInstrument {
    type: 'single';
    label: string;
    char: string;
    midi: number;
}

type InstrumentRow = GroupedInstrument | SingleInstrument;

// Hi-Hat note state
type HiHatState = 'closed' | 'open' | 'accent' | null;

interface Token {
    text: string;
    start: number;
    end: number;
    notes: string[]; // ['A', 'G'] or [] for rest
    duration: number; // in 16th note ticks
    rawText?: string; // Original text before cleaning (for hi-hat detection)
}

// GM Drum Map (Subset for labels)
const GM_DRUMS: { [key: number]: string } = {
    35: "Kick 1",
    36: "Kick 2",
    37: "Side Stick",
    38: "Snare",
    39: "Hand Clap",
    40: "Electric Snare",
    41: "Floor Tom 2",
    42: "Closed Hi-Hat",
    43: "Floor Tom 1",
    44: "Pedal Hi-Hat",
    45: "Low Tom",
    46: "Open Hi-Hat",
    47: "Low-Mid Tom",
    48: "Hi-Mid Tom",
    49: "Crash 1",
    50: "High Tom",
    51: "Ride 1",
    52: "China",
    53: "Ride Bell",
    54: "Tambourine",
    55: "Splash",
    56: "Cowbell",
    57: "Crash 2",
    58: "Vibraslap",
    59: "Ride 2",
    60: "Hi Bongo",
    61: "Low Bongo",
    62: "Mute Hi Conga",
    63: "Open Hi Conga",
    64: "Low Conga",
    65: "High Timbale",
    66: "Low Timbale",
    67: "High Agogo",
    68: "Low Agogo",
    69: "Cabasa",
    70: "Maracas",
    71: "Short Whistle",
    72: "Long Whistle",
    73: "Short Guiro",
    74: "Long Guiro",
    75: "Claves",
    76: "Hi Wood Block",
    77: "Low Wood Block",
    78: "Mute Cuica",
    79: "Open Cuica",
    80: "Mute Triangle",
    81: "Open Triangle",
};

export class DrumGrid {
    private container: HTMLElement;
    private gridContainer: HTMLElement;
    private percMaps: PercMap[] = [];
    private visibleMaps: PercMap[] = []; // The ones shown in the grid
    private visibleRows: InstrumentRow[] = []; // Grouped/single instruments for rendering
    private maxVisible = 3;
    private currentBar: string = "";
    private currentBarContext: { start: number, end: number } | null = null;
    private timeSignatureOpt = 16; // Granularity (16th notes)
    private contextMenu: HTMLElement | null = null;

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

        // Close context menu on click outside
        document.addEventListener('click', (e) => {
            if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
                this.closeContextMenu();
            }
        });
    }

    private closeContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }

    show() {
        this.container.style.display = 'flex';
    }

    hide() {
        this.container.style.display = 'none';
    }

    private lastContent: string = "";
    private previousBarContent: string = "";

    update(content: string, cursor: number) {
        // 1. Parse %%percmap directives only if content changed
        if (content !== this.lastContent) {
            this.parsePercMaps(content);
            this.lastContent = content;
        }

        // 2. Identify the current bar (and previous bar for fallback)
        const previousBar = this.currentBar;
        this.identifyCurrentBar(content, cursor);
        this.identifyPreviousBar(content, cursor);

        // 3. Update visible instruments based on bar content
        if (this.currentBar !== previousBar) {
            this.updateVisibleInstruments();
            this.render();
        }
    }

    // Clean bar content from annotations, decorations, etc. (similar to bar_visualizer)
    private cleanBarContent(barContent: string): string {
        let cleanBar = barContent;
        cleanBar = cleanBar.replace(/"[^"]*"/g, '');       // Remove text in quotes (annotations)
        cleanBar = cleanBar.replace(/\{.*?\}/g, '');       // Remove grace notes in curly brackets
        cleanBar = cleanBar.replace(/!.*?!/g, '');         // Remove decorations !...!
        cleanBar = cleanBar.replace(/\+.*?\+/g, '');       // Remove old-style decorations +...+
        cleanBar = cleanBar.replace(/\[[A-Za-z]:.*?\]/g, ''); // Remove inline info fields
        cleanBar = cleanBar.replace(/\[%%.*?\]/g, '');     // Remove inline directives
        cleanBar = cleanBar.replace(/%%.*/g, '');          // Remove comments
        return cleanBar;
    }

    // Extract unique note characters from a bar
    private extractNotesFromBar(barContent: string): Set<string> {
        const cleanBar = this.cleanBarContent(barContent);
        const notes = new Set<string>();

        const chordRegex = /\[([^\]]*)\]/g;
        let remaining = cleanBar;

        // Simplified Regex: Just the note
        const notePattern = /([\^=_]?[A-Ga-g][,']*)/g;

        remaining = remaining.replace(chordRegex, (match, chordContent) => {
            let noteMatch;
            while ((noteMatch = notePattern.exec(chordContent)) !== null) {
                notes.add(noteMatch[1]);
            }
            return '';
        });

        let match;
        while ((match = notePattern.exec(remaining)) !== null) {
            notes.add(match[1]);
        }

        return notes;
    }

    // Update visible instruments based on notes in current bar (or previous bar as fallback)
    private updateVisibleInstruments() {
        if (this.percMaps.length === 0) return;

        // Get notes from current bar
        let usedNotes = this.extractNotesFromBar(this.currentBar);

        // If current bar is empty or has no notes, check previous bar
        if (usedNotes.size === 0 && this.previousBarContent) {
            usedNotes = this.extractNotesFromBar(this.previousBarContent);
        }

        // Find which percMaps are used
        const usedMaps: PercMap[] = [];
        for (const map of this.percMaps) {
            if (usedNotes.has(map.char)) {
                usedMaps.push(map);
            }
        }

        if (usedMaps.length > 0) {
            // Ensure Hi-Hat pairs are kept together (42 and 46)
            const hasClosed = usedMaps.some(m => m.midi === 42);
            const hasOpen = usedMaps.some(m => m.midi === 46);

            if (hasClosed && !hasOpen) {
                const openMap = this.percMaps.find(m => m.midi === 46);
                if (openMap) usedMaps.push(openMap);
            } else if (!hasClosed && hasOpen) {
                const closedMap = this.percMaps.find(m => m.midi === 42);
                if (closedMap) usedMaps.push(closedMap);
            }

            // Use the instruments found in the bar(s)
            this.visibleMaps = usedMaps;
        } else {
            // Fall back to first 3 instruments (default behavior for new/empty bars)
            this.visibleMaps = this.percMaps.slice(0, this.maxVisible);
        }
    }

    // Find the previous bar content
    private identifyPreviousBar(content: string, cursor: number) {
        if (!this.currentBarContext) {
            this.previousBarContent = "";
            return;
        }

        // Look for bar before the current bar's start
        const beforeCurrentBar = content.substring(0, this.currentBarContext.start);

        // Find the previous bar delimiter
        let prevEnd = beforeCurrentBar.lastIndexOf('|');
        if (prevEnd === -1) {
            this.previousBarContent = "";
            return;
        }

        // Skip the delimiter we found (it's the end of prev bar)
        const beforePrevEnd = beforeCurrentBar.substring(0, prevEnd);

        // Find start of previous bar
        let prevStart = beforePrevEnd.lastIndexOf('|');
        const prevNewline = beforePrevEnd.lastIndexOf('\n');

        // Use whichever is closer (but after it)
        if (prevNewline > prevStart) {
            prevStart = prevNewline;
        }

        if (prevStart === -1) {
            prevStart = 0;
        } else {
            prevStart += 1; // Move past delimiter
        }

        this.previousBarContent = beforeCurrentBar.substring(prevStart, prevEnd).trim();
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
        // Note: visibleMaps will be set by updateVisibleInstruments() based on bar content
    }

    // Build grouped instrument rows (combining hi-hat closed + open into one row)
    private buildInstrumentRows(): InstrumentRow[] {
        const rows: InstrumentRow[] = [];
        const processed = new Set<string>();

        // Look for hi-hat pairs (MIDI 42 = closed, 46 = open)
        const closedHiHat = this.visibleMaps.find(m => m.midi === 42);
        const openHiHat = this.visibleMaps.find(m => m.midi === 46);

        if (closedHiHat && openHiHat) {
            // Create grouped hi-hat row
            rows.push({
                type: 'grouped',
                label: 'Hi-Hat',
                closedChar: closedHiHat.char,
                openChar: openHiHat.char,
                closedMidi: 42,
                openMidi: 46
            });
            processed.add(closedHiHat.char);
            processed.add(openHiHat.char);
        }

        // Add remaining instruments as single rows
        for (const map of this.visibleMaps) {
            if (!processed.has(map.char)) {
                rows.push({
                    type: 'single',
                    label: map.label,
                    char: map.char,
                    midi: map.midi
                });
                processed.add(map.char);
            }
        }

        return rows;
    }

    // Parse bar to detect hi-hat states at each tick
    // Returns: { char: string, state: HiHatState }[][] for 16 ticks
    private parseBarToHiHatGrid(barText: string, closedChar: string, openChar: string): HiHatState[] {
        const grid: HiHatState[] = Array(16).fill(null);

        // We need to look at the raw bar text to detect patterns like:
        // o^g (open), !>!g (accent)
        // IMPORTANT: Prefixes (!>!, o) can be OUTSIDE chords: !>![gF], o[gF]

        // Tokenize with raw text preserved - include prefixes outside chords
        // Revised Regex: handles generic decorations, optional 'o', and quoted strings
        const tokenRegex = /((?:!.*?!)*(?:o)?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

        let currentTick = 0;
        let match;

        while ((match = tokenRegex.exec(barText)) !== null) {
            if (currentTick >= 16) break;

            const fullText = match[0];
            const coreContent = match[1];
            const durationStr = match[2];

            // ... Duration parsing logic (same as before) ...
            let duration = 1;
            if (durationStr === '/') duration = 0.5;
            // (Keep your existing duration logic here for brevity)
            if (coreContent.startsWith('"')) duration = 0;
            else if (durationStr && !durationStr.includes('/')) duration = parseInt(durationStr);

            const ticks = (duration === 0 && coreContent.startsWith('"')) ? 0 : (Math.round(duration) || 1);
            const tickIdx = Math.floor(currentTick);

            const hasAccent = coreContent.match(/^!.*?!/) ? coreContent.includes('!>!') : false;
            // 'o' is still used for open
            const hasOpenPrefix = /^((?:!.*?!)*)o/.test(coreContent);

            let innerContent = coreContent.replace(/^((?:!.*?!)*)(o)?/, '');
            if (innerContent.startsWith('[')) {
                innerContent = innerContent.slice(1, -1);
            }

            // Simple check: does the string contain the char?
            const hasClosedChar = innerContent.includes(closedChar);
            const hasOpenChar = innerContent.includes(openChar);

            if (hasClosedChar || hasOpenChar) {
                if (hasAccent) {
                    grid[tickIdx] = 'accent';
                } else if (hasOpenPrefix || hasOpenChar) {
                    // It is open if it has 'o' prefix OR if the char itself is the open map char (e.g. ^g)
                    grid[tickIdx] = 'open';
                } else {
                    grid[tickIdx] = 'closed';
                }
            }

            currentTick += ticks;
        }

        return grid;
    }

    private identifyCurrentBar(content: string, cursor: number) {
        // 1. Identify the current line boundaries
        const beforeCursor = content.substring(0, cursor);
        const lastNewline = beforeCursor.lastIndexOf('\n');
        const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

        const afterCursor = content.substring(cursor);
        const nextNewline = afterCursor.search('\n');
        const lineEnd = nextNewline === -1 ? content.length : cursor + nextNewline;

        const currentLine = content.substring(lineStart, lineEnd).trim();

        // 2. Check if this is a valid music line
        // Ignore Headers (K:, M:), Comments (%), Lyrics (w:), or Voice definitions at start of line
        if (currentLine.startsWith('%') ||
            currentLine.startsWith('%%') ||
            currentLine.startsWith('w:') ||
            /^[A-Z]:/.test(currentLine)) {

            this.currentBar = "";
            this.currentBarContext = null;
            return;
        }

        // 3. Find Bar Delimiters relative to cursor
        // We need indices relative to the whole 'content' string

        // Search backwards from cursor for | or ::
        const barSeparator = /\||::/;

        // We search in the substring from lineStart to cursor
        const lineBeforeCursor = content.substring(lineStart, cursor);
        const lastPipe = lineBeforeCursor.lastIndexOf('|');
        const lastDoubleColon = lineBeforeCursor.lastIndexOf('::');

        let localStart = 0; // Relative to lineStart
        let delimiterLength = 0;

        if (lastPipe > -1 || lastDoubleColon > -1) {
            if (lastPipe > lastDoubleColon) {
                localStart = lastPipe;
                delimiterLength = 1;
            } else {
                localStart = lastDoubleColon;
                delimiterLength = 2;
            }
            // Move past the delimiter
            localStart += delimiterLength;
        }

        // Absolute start index
        const absStart = lineStart + localStart;

        // Search forwards from cursor for | or ::
        // We search in the substring from cursor to lineEnd
        const lineAfterCursor = content.substring(cursor, lineEnd);
        let localEnd = lineAfterCursor.search(barSeparator);

        if (localEnd === -1) {
            localEnd = lineAfterCursor.length;
        }

        // Absolute end index
        const absEnd = cursor + localEnd;

        this.currentBarContext = { start: absStart, end: absEnd };
        this.currentBar = content.substring(absStart, absEnd);
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

        // Build instrument rows (grouped hi-hat if both closed/open exist)
        this.visibleRows = this.buildInstrumentRows();

        // --- Render Instrument Rows with line grid ---
        const parsedNotes = this.parseBarToGrid(this.currentBar);

        this.visibleRows.forEach((instrumentRow, rowIndex) => {
            const row = this.gridContainer.createDiv({ cls: 'abc-drum-row abc-drum-instrument-row' });
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.position = 'relative';
            row.style.height = `${cellHeight}px`;

            // Label Button
            const label = row.createEl('button', { cls: 'abc-drum-label', text: instrumentRow.label });
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

            // Get hi-hat grid if this is a grouped row
            let hiHatGrid: HiHatState[] | null = null;
            if (instrumentRow.type === 'grouped') {
                hiHatGrid = this.parseBarToHiHatGrid(this.currentBar, instrumentRow.closedChar, instrumentRow.openChar);
            }

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

                    if (instrumentRow.type === 'grouped' && hiHatGrid) {
                        // Grouped hi-hat rendering
                        const state = hiHatGrid[globalStep];
                        if (state) {
                            const diamond = stepContainer.createDiv({ cls: 'abc-drum-diamond abc-drum-diamond-hihat' });
                            diamond.style.width = '14px';
                            diamond.style.height = '14px';
                            diamond.style.backgroundColor = 'var(--text-normal)';
                            diamond.style.transform = 'rotate(45deg)';
                            diamond.style.zIndex = '1';
                            diamond.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
                            diamond.style.position = 'relative';
                            diamond.style.display = 'flex';
                            diamond.style.justifyContent = 'center';
                            diamond.style.alignItems = 'center';

                            // Add indicator for open or accent
                            if (state === 'open' || state === 'accent') {
                                const indicator = diamond.createDiv({ cls: 'abc-drum-diamond-indicator' });
                                indicator.style.transform = 'rotate(-45deg)'; // Counter-rotate
                                indicator.style.fontSize = '10px';
                                indicator.style.fontWeight = 'bold';
                                indicator.style.color = 'var(--background-primary)';
                                indicator.style.lineHeight = '1';
                                indicator.innerText = state === 'open' ? '○' : '>';
                            }
                        }

                        // Left click: toggle closed hi-hat
                        stepContainer.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.toggleHiHat(globalStep, instrumentRow as GroupedInstrument, 'closed');
                        });

                        // Right click: show context menu
                        stepContainer.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            this.showHiHatContextMenu(e, globalStep, instrumentRow as GroupedInstrument, state);
                        });
                    } else if (instrumentRow.type === 'single') {
                        // Single instrument rendering (original behavior)
                        const isActive = parsedNotes[globalStep] && parsedNotes[globalStep].includes(instrumentRow.char);
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
                            this.toggleNote(globalStep, instrumentRow.char);
                        });
                    }

                    // Hover effect
                    const isActive = instrumentRow.type === 'grouped'
                        ? (hiHatGrid && hiHatGrid[globalStep] !== null)
                        : (parsedNotes[globalStep] && parsedNotes[globalStep].includes((instrumentRow as SingleInstrument).char));

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
        // Find instruments not yet visible
        const visibleChars = new Set<string>();
        for (const row of this.visibleRows) {
            if (row.type === 'grouped') {
                visibleChars.add(row.closedChar);
                visibleChars.add(row.openChar);
            } else {
                visibleChars.add(row.char);
            }
        }

        const hiddenMaps = this.percMaps.filter(map => !visibleChars.has(map.char));

        if (hiddenMaps.length > 0) {
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

            // --- UPDATED CLICK HANDLER ---
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent document click from closing it immediately
                this.showAddInstrumentMenu(e, hiddenMaps);
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
        // 2. Single notes/rests with optional drum modifiers
        // 3. Rests: z|Z ...

        // IMPORTANT: In drum notation:
        // - 'o' before a note = open modifier e.g., "o^g" = open hi-hat
        // - Prefixes (!>!, o) can be OUTSIDE chords: !>![gF], o[gF]
        // - These should NOT be treated as separate notes!

        // Revised Regex to handle drum modifiers and prefixes outside chords:
        // - (?:!>!)? - optional accent decoration (can be outside chord)
        // - (?:o)? - optional 'o' prefix (open modifier, can be outside chord)
        // - Then either:
        //   - \[[^\]]+\] - a chord
        //   - OR a single note with modifiers

        // Group 1: Core content (Prefix + Chord OR Prefix + Note with modifiers OR Rest)
        // Group 2: Duration
        // Revised Regex to handle generic decorations and modifiers, AND quoted strings:
        // - (?:!.*?!)* - any number of decorations (allows generic like !f!, !trill!)
        // - (?:o)? - optional 'o' prefix
        // - "[^"]*" - quoted strings (annotations) - consume but ignore
        // - Then either chord or single note
        const tokenRegex = /((?:!.*?!)*(?:o)?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

        let match;
        while ((match = tokenRegex.exec(barText)) !== null) {
            const fullText = match[0];
            const coreContent = match[1];
            const durationStr = match[2];
            const start = match.index;
            const end = start + fullText.length;

            let duration = 0;
            let notes: string[] = [];

            // If it's a quoted string, it has 0 duration and 0 notes
            if (coreContent.startsWith('"')) {
                duration = 0; // Ignore duration for annotations in drum grid
                notes = [];
            } else {
                // Parse Duration
                duration = 1; // Default
                if (durationStr === '/') duration = 0.5;
                else if (durationStr.includes('/')) {
                    const parts = durationStr.split('/');
                    const num = parts[0] ? parseInt(parts[0]) : 1;
                    const den = parts[1] ? parseInt(parts[1]) : 2;
                    duration = num / (den / 2); // assuming /2 is base? No, it's relative.
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
            }

            // Extract Notes (the base note characters, stripping modifiers like o, !...!)
            if (!coreContent.toLowerCase().startsWith('z') && !coreContent.toLowerCase().startsWith('x') && !coreContent.startsWith('"')) {
                let cleanContent = coreContent.replace(/!.*?!/g, ''); // Strip decorations
                let inner = cleanContent.replace(/^o/, ''); // Strip 'o' prefix
                inner = inner.replace(/[\[\]]/g, ""); // Remove brackets

                // New Pattern: Just looks for pitch (e.g., ^g, G,)
                // Removed the 'n' prefix check
                const notePattern = /([\^=_]?[A-Ga-g][,']*)/g;
                let noteMatch;
                while ((noteMatch = notePattern.exec(inner)) !== null) {
                    if (noteMatch[1]) {
                        notes.push(noteMatch[1]);
                    }
                }
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
                        // Match the base note character (with accidentals)
                        // "g" matches "g", "^g" matches "^g"
                        if (note === map.char) {
                            grid[Math.floor(currentTick)].push(map.char);
                        }
                    }
                }
            }

            currentTick += (token.text.startsWith('"')) ? 0 : (ticks || 1);
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
            // Allow 0 duration for quoted annotations
            const tokenDur = (token.text.startsWith('"')) ? 0 : (Math.round(token.duration) || 1);

            // Add space before this token if we're at a beat boundary (every 4 ticks)
            // and this isn't the first token
            if (currentTick > 0 && currentTick % 4 === 0) {
                result += " ";
            }

            // Reconstruct token text
            const durationPart = token.text.replace(/^(\[[^\]]+\]|[\^=_]*[A-Za-z][,']*|z|Z|x|X)/, "");
            let tokenText = "";

            if (token.text.startsWith('"')) {
                tokenText = token.text;
            } else if (token.notes.length === 0) {
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
            const tokenDur = (t.text.startsWith('"')) ? 0 : (Math.round(t.duration) || 1);
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

            let appendStr = '';
            // Add beat grouping spaces and rests
            for (let k = 0; k < gap; k++) {
                const tick = currentTick + k;
                if (tick > 0 && tick % 4 === 0) appendStr += ' ';
                appendStr += 'z';
            }

            // Add the new note with beat grouping
            if (tickIndex > 0 && tickIndex % 4 === 0) appendStr += ' ';
            appendStr += char;

            applyChange(this.currentBar + appendStr);
            return;
        }

        // 2. Modify the target token - preserve original structure!
        const hasChar = targetToken.notes.includes(char);

        // Get the duration part from original token
        const durMatch = targetToken.text.match(/([\d\/]+)$/);
        const durationPart = durMatch ? durMatch[1] : '';

        // Get the core content (without duration)
        const coreText = targetToken.text.replace(/([\d\/]+)$/, '');

        // Extract prefixes that are outside the chord (for preserving on collapse)
        const prefixMatch = coreText.match(/^((?:!.*?!)*)(o)?(.*)$/);
        const decorations = prefixMatch?.[1] || '';
        const openPrefix = prefixMatch?.[2] || '';
        const afterPrefix = prefixMatch?.[3] || coreText;

        let newTokenText = '';

        if (hasChar) {
            // REMOVE the char from the token
            if (afterPrefix.startsWith('[')) {
                // It's a chord (possibly with prefixes outside) - remove this char from it
                let inner = afterPrefix.slice(1, -1); // Remove [ and ]

                // Remove the char (be careful to match whole note, not substring)
                // Create pattern that matches the char with optional modifiers before it
                const charPattern = new RegExp(`${char.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[,']*`, 'g');
                inner = inner.replace(charPattern, '');

                // Clean up and rebuild
                const remainingNotes = inner.match(/[\^=_]*[A-Ga-g][,']*/g) || [];

                if (remainingNotes.length === 0) {
                    newTokenText = 'z' + durationPart;
                } else if (remainingNotes.length === 1) {
                    // Collapsing to single note - check if we need to preserve prefixes
                    // The 'o' prefix applies to open hi-hat (^g or the openChar)
                    // We need to check if the remaining note is a hi-hat that should keep the 'o'
                    const remainingNote = remainingNotes[0];

                    // Check if remaining note is an "open-able" instrument (hi-hat open char)
                    let shouldKeepOpen = false;
                    for (const row of this.visibleRows) {
                        if (row.type === 'grouped' && remainingNote.includes(row.openChar)) {
                            shouldKeepOpen = true;
                            break;
                        }
                    }

                    if (shouldKeepOpen && openPrefix) {
                        newTokenText = `${decorations}${openPrefix}${remainingNote}${durationPart}`;
                    } else if (decorations) {
                        // Decorations can apply to any note
                        newTokenText = `${decorations}${remainingNote}${durationPart}`;
                    } else {
                        newTokenText = remainingNote + durationPart;
                    }
                } else {
                    // Still a chord - keep prefixes outside
                    newTokenText = `${decorations}${openPrefix}[${remainingNotes.join('')}]${durationPart}`;
                }
            } else {
                // Single note being removed - replace with rest
                newTokenText = 'z' + durationPart;
            }
        } else {
            // ADD the char to the token

            // Check for prefixes (outside the potential chord)
            const prefixMatch = coreText.match(/^((?:!.*?!)*)(o)?(.*)$/);
            const decorations = prefixMatch?.[1] || '';
            const openPrefix = prefixMatch?.[2] || '';
            const innerContent = prefixMatch?.[3] || coreText;

            if (innerContent.startsWith('[')) {
                // Already a chord - add char to it (inside the brackets)
                const innerNotes = innerContent.slice(1, -1);
                newTokenText = `${decorations}${openPrefix}[${innerNotes}${char}]${durationPart}`;
            } else if (coreText.match(/^z$/i)) {
                // It's a rest - replace with the new note
                newTokenText = char + durationPart;
            } else {
                // Single note - create chord with original + new char
                // The prefixes (extracted above) go OUTSIDE the new chord
                newTokenText = `${decorations}${openPrefix}[${innerContent}${char}]${durationPart}`;
            }
        }

        // 3. Rebuild bar preserving beat grouping
        let newBar = '';
        currentTick = 0;

        for (let i = 0; i < tokens.length; i++) {
            // Add space at beat boundaries
            if (currentTick > 0 && currentTick % 4 === 0) {
                newBar += ' ';
            }

            if (i === tokenIndex) {
                newBar += newTokenText;
            } else {
                // Use original token text (strip any leading/trailing spaces from original)
                newBar += tokens[i].text.trim();
            }

            currentTick += (tokens[i].text.startsWith('"')) ? 0 : (Math.round(tokens[i].duration) || 1);
        }

        applyChange(newBar);
    }

    private showAddInstrumentMenu(event: MouseEvent, hiddenMaps: PercMap[]) {
        this.closeContextMenu();

        const menu = document.createElement('div');
        menu.className = 'abc-drum-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.backgroundColor = 'var(--background-primary)';
        menu.style.border = '1px solid var(--background-modifier-border)';
        menu.style.borderRadius = '6px';
        menu.style.padding = '4px 0';
        menu.style.zIndex = '1000';
        menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        menu.style.minWidth = '150px';
        menu.style.maxHeight = '300px'; // Add scroll if list is long
        menu.style.overflowY = 'auto';

        // Header for the menu (Optional)
        const header = document.createElement('div');
        header.innerText = "Add Instrument";
        header.style.padding = '4px 12px';
        header.style.fontSize = '11px';
        header.style.color = 'var(--text-muted)';
        header.style.borderBottom = '1px solid var(--background-modifier-border)';
        header.style.marginBottom = '4px';
        menu.appendChild(header);

        hiddenMaps.forEach(map => {
            const item = document.createElement('div');
            item.className = 'abc-drum-context-menu-item';
            item.style.padding = '6px 12px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.fontSize = '12px';
            item.style.color = 'var(--text-normal)';

            // Label
            const labelSpan = document.createElement('span');
            labelSpan.innerText = map.label;
            item.appendChild(labelSpan);

            // Hover effect
            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'transparent';
            });

            // Click action
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();

                // Add the selected map to visible list
                this.visibleMaps.push(map);

                // Re-render the grid to show the new row
                this.render();
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Adjust position if menu goes off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }
    // Show context menu for hi-hat with Close/Open/Accent options
    private showHiHatContextMenu(event: MouseEvent, tickIndex: number, instrument: GroupedInstrument, currentState: HiHatState) {
        this.closeContextMenu();

        const menu = document.createElement('div');
        menu.className = 'abc-drum-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.backgroundColor = 'var(--background-primary)';
        menu.style.border = '1px solid var(--background-modifier-border)';
        menu.style.borderRadius = '6px';
        menu.style.padding = '4px 0';
        menu.style.zIndex = '1000';
        menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        menu.style.minWidth = '120px';

        const options: { label: string; state: HiHatState; icon: string }[] = [
            { label: 'Closed', state: 'closed', icon: '✕' },
            { label: 'Open', state: 'open', icon: '○' },
            { label: 'Accent', state: 'accent', icon: '>' },
        ];

        // Add "Remove" option if there's a note
        if (currentState) {
            options.push({ label: 'Remove', state: null, icon: '−' });
        }

        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'abc-drum-context-menu-item';
            item.style.padding = '6px 12px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '8px';
            item.style.fontSize = '12px';
            item.style.color = 'var(--text-normal)';

            // Highlight current state
            if (opt.state === currentState) {
                item.style.backgroundColor = 'var(--background-modifier-hover)';
                item.style.fontWeight = 'bold';
            }

            const iconSpan = document.createElement('span');
            iconSpan.innerText = opt.icon;
            iconSpan.style.width = '16px';
            iconSpan.style.textAlign = 'center';

            const labelSpan = document.createElement('span');
            labelSpan.innerText = opt.label;

            item.appendChild(iconSpan);
            item.appendChild(labelSpan);

            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            item.addEventListener('mouseleave', () => {
                if (opt.state !== currentState) {
                    item.style.backgroundColor = 'transparent';
                }
            });

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                this.toggleHiHat(tickIndex, instrument, opt.state);
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Adjust position if menu goes off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }

    // Toggle hi-hat note with specific state (closed/open/accent)
    private toggleHiHat(tickIndex: number, instrument: GroupedInstrument, targetState: HiHatState) {
        if (!this.currentBarContext || this.currentBar === null) return;

        // Parse the bar to understand its structure
        // We need more sophisticated parsing that preserves decorations and prefixes

        const hiHatGrid = this.parseBarToHiHatGrid(this.currentBar, instrument.closedChar, instrument.openChar);
        const currentState = hiHatGrid[tickIndex];

        if (targetState === currentState) {
            targetState = null;
        }

        let noteStr = '';
        if (targetState === 'closed') {
            // WAS: n${instrument.closedChar}
            noteStr = `${instrument.closedChar}`;
        } else if (targetState === 'open') {
            // WAS: on${instrument.openChar}
            // Keep 'o' if you want the !open! symbol, OR just the char if char implies open
            // Based on your example: "o^g"
            noteStr = `o${instrument.openChar}`;
        } else if (targetState === 'accent') {
            // WAS: !>!n${instrument.closedChar}
            noteStr = `!>!${instrument.closedChar}`;
        }

        this.modifyHiHatInBar(tickIndex, instrument, currentState, targetState, noteStr);
    }

    // Modify hi-hat note in the bar
    private modifyHiHatInBar(tickIndex: number, instrument: GroupedInstrument, currentState: HiHatState, targetState: HiHatState, noteStr: string) {
        // This is complex because we need to handle:
        // 1. Chords with multiple notes
        // 2. Decoration prefixes (!>!, o) can be OUTSIDE chords
        // 3. Beat grouping

        // Strategy: Parse to tokens, find the token at tickIndex, modify it, rebuild

        // Extended token regex that captures generic decorations (including outside chords)
        // - (?:!.*?!)* - any number of decorations
        // - (?:o)? - optional 'o'
        // - "[^"]*" - quoted strings (annotations) - consume but ignore
        const tokenRegex = /((?:!.*?!)*(?:o)?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

        interface ExtToken {
            text: string;
            start: number;
            end: number;
            duration: number;
        }

        const tokens: ExtToken[] = [];
        let match;

        while ((match = tokenRegex.exec(this.currentBar)) !== null) {
            const fullText = match[0];
            const coreContent = match[1];
            const durationStr = match[2];

            let duration = 0;
            if (coreContent.startsWith('"')) {
                duration = 0; // Ignore duration for annotations
            } else {
                duration = 1;
                if (durationStr === '/') duration = 0.5;
                else if (durationStr.includes('/')) {
                    const parts = durationStr.split('/');
                    const num = parts[0] ? parseInt(parts[0]) : 1;
                    const den = parts[1] ? parseInt(parts[1]) : 2;
                    duration = num / den;
                } else if (durationStr) {
                    duration = parseInt(durationStr);
                }
            }

            tokens.push({
                text: fullText,
                start: match.index,
                end: match.index + fullText.length,
                duration: (duration === 0 && fullText.startsWith('"')) ? 0 : (Math.round(duration) || 1)
            });
        }

        // Find token at tick
        let currentTick = 0;
        let targetTokenIdx = -1;

        for (let i = 0; i < tokens.length; i++) {
            if (currentTick <= tickIndex && (currentTick + tokens[i].duration) > tickIndex) {
                targetTokenIdx = i;
                break;
            }
            currentTick += tokens[i].duration;
        }

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
                const lengthDiff = newBarText.length - this.currentBar.length;
                this.currentBar = newBarText;
                this.currentBarContext.end += lengthDiff;
                this.render();
            }
        };

        if (targetTokenIdx === -1) {
            // DEBUG: Log why we didn't find the token
            console.log("ModifyHiHat: Token not found (Append Mode)", {
                tickIndex,
                currentBar: this.currentBar,
                barContext: this.currentBarContext,
                tokens: tokens.map(t => ({ text: t.text, range: [t.start, t.end], dur: t.duration }))
            });

            // APPEND MODE
            const gap = tickIndex - currentTick;
            if (gap < 0) return;

            let appendStr = '';
            // Add beat grouping spaces
            for (let k = 0; k < gap; k++) {
                const tick = currentTick + k;
                if (tick > 0 && tick % 4 === 0) appendStr += ' ';
                appendStr += 'z';
            }

            // Add the new note with beat grouping
            if (tickIndex > 0 && tickIndex % 4 === 0) appendStr += ' ';

            if (targetState) {
                appendStr += noteStr;
            } else {
                appendStr += 'z';
            }

            applyChange(this.currentBar + appendStr);
            return;
        }

        // Modify existing token
        const token = tokens[targetTokenIdx];
        let newTokenText = '';

        // Get duration part
        const durMatch = token.text.match(/([\d\/]+)$/);
        const durationPart = durMatch ? durMatch[1] : '';

        if (targetState === null) {
            // Remove hi-hat from this position
            // Check if token is a chord (may have prefixes outside)
            if (token.text.includes('[')) {
                // Parse prefix and content more robustly
                const prefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(\[.*)/);
                let decorations = prefixMatch?.[1] || '';


                decorations = decorations.replace(/!>!/g, '');
                const chordPart = prefixMatch?.[3] || token.text;

                // Remove hi-hat notes from chord
                let inner = chordPart.match(/\[([^\]]+)\]/)?.[1] || '';

                // Remove patterns like: ^g, g (the hi-hat chars inside chord)
                const removePatterns = [
                    instrument.openChar,
                    instrument.closedChar
                ];

                // Escape special chars for regex
                const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                for (const pat of removePatterns) {
                    inner = inner.replace(new RegExp(escapeRegExp(pat), 'g'), '');
                }

                // Clean up any remaining notes (without hi-hat prefixes since those went outside)
                // Use the robust note extraction pattern
                const remainingNotes: string[] = [];
                const notePattern = /[\^=_]*[A-Ga-g][,']*/g;
                let m;
                while ((m = notePattern.exec(inner)) !== null) {
                    remainingNotes.push(m[0]);
                }

                if (remainingNotes.length === 0) {
                    newTokenText = 'z' + durationPart;
                } else if (remainingNotes.length === 1) {
                    // Apply the CLEANED decorations to the single remaining note
                    newTokenText = `${decorations}${remainingNotes[0]}${durationPart}`;
                } else {
                    // Apply the CLEANED decorations to the remaining chord
                    newTokenText = `${decorations}[${remainingNotes.join('')}]${durationPart}`;
                }
            } else {
                // Single note - just replace with rest
                newTokenText = 'z' + durationPart;
            }
        } else {
            // Add/change hi-hat state
            // noteStr examples: "g" (closed), "o^g" (open), "!>!g" (accent)

            // Extract modifiers from the requested noteStr
            const noteMatch = noteStr.match(/^((?:!.*?!)*)(o)?(.*)$/);
            const newDecorations = noteMatch?.[1] || '';
            const newOpenPrefix = noteMatch?.[2] || '';
            const innerNote = noteMatch?.[3] || noteStr;

            if (token.text.includes('[')) {
                // Chord - need to replace/add hi-hat
                // First, extract any existing prefixes from the chord token
                const existingPrefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(\[.*)/);
                let existingDecorations = existingPrefixMatch?.[1] || '';
                // const existingOpen = existingPrefixMatch?.[2] || '';
                const chordPart = existingPrefixMatch?.[3] || token.text;

                let inner = chordPart.match(/\[([^\]]+)\]/)?.[1] || '';

                // First remove any existing hi-hat patterns from inside the chord
                const removePatterns = [
                    `!>!${instrument.openChar}`,
                    `!>!${instrument.closedChar}`,
                    instrument.openChar,
                    instrument.closedChar
                ];

                const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                for (const pat of removePatterns) {
                    inner = inner.replace(new RegExp(escapeRegExp(pat), 'g'), '');
                }

                // Add new hi-hat note (just the inner part, without o prefix)
                inner = inner + innerNote;

                // Since we are setting a specific Hi-Hat state, we remove the 'Accent' (!>!) 
                // from the existing decorations because the new state will provide it if needed.
                existingDecorations = existingDecorations.replace(/!>!/g, '');

                // Combine decorations
                let combinedDecorations = existingDecorations;
                // Add the new decorations (e.g. if new state is Accent, this adds !>!)
                if (newDecorations && !combinedDecorations.includes(newDecorations)) {
                    combinedDecorations += newDecorations;
                }

                // logic: If we are changing the Hi-Hat, the 'o' state is determined PURELY 
                // by the new target state (newOpenPrefix). We discard the old 'o'.
                const combinedOpen = newOpenPrefix || '';

                // Build with prefixes OUTSIDE the chord
                newTokenText = `${combinedDecorations}${combinedOpen}[${inner}]${durationPart}`;
            } else if (token.text.match(/^z/i)) {
                // Rest - replace with note (full noteStr is fine here, no chord)
                newTokenText = noteStr + durationPart;
            } else {
                // Single note - check if it's a hi-hat note or another instrument
                // First strip any existing prefixes from the token
                const existingMatch = token.text.match(/^((?:!.*?!)*)(o)?(.*)$/);
                const existingDecorations = existingMatch?.[1] || '';
                const coreToken = existingMatch?.[3] || token.text;
                const coreTokenNoDir = coreToken.replace(/[\d\/]+$/, '');

                const isHiHat = coreTokenNoDir.includes(instrument.closedChar) ||
                    coreTokenNoDir.includes(instrument.openChar);

                if (isHiHat) {
                    // Replace with new hi-hat state
                    newTokenText = noteStr + durationPart;
                    // Preserve existing generic decorations if not provided in noteStr
                    if (existingDecorations && !noteStr.startsWith(existingDecorations)) {
                        const cleanNoteStr = noteStr.replace(/^!.*?!/, '');
                        if (noteStr.includes('!>!')) {
                            newTokenText = existingDecorations + '!>!' + cleanNoteStr + durationPart;
                        } else {
                            newTokenText = existingDecorations + cleanNoteStr + durationPart;
                        }
                    }
                } else {
                    // Create chord with hi-hat + existing note
                    let combinedDecorations = existingDecorations;
                    if (newDecorations && !combinedDecorations.includes(newDecorations)) {
                        combinedDecorations += newDecorations;
                    }
                    const combinedOpen = newOpenPrefix || existingMatch?.[2] || '';

                    newTokenText = `${combinedDecorations}${combinedOpen}[${innerNote}${coreTokenNoDir}]${durationPart}`;
                }
            }
        }

        // Rebuild bar with beat grouping
        let newBar = '';
        currentTick = 0;

        for (let i = 0; i < tokens.length; i++) {
            if (currentTick > 0 && currentTick % 4 === 0) {
                newBar += ' ';
            }

            if (i === targetTokenIdx) {
                newBar += newTokenText;
            } else {
                // Reconstruct original token without extra spaces
                newBar += tokens[i].text.trim();
            }

            currentTick += tokens[i].duration;
        }

        applyChange(newBar);
    }
}
