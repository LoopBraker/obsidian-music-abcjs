import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

interface PercMap {
    label: string; // The note name or label (e.g. "Kick", "Snare") - derived or explicit? User just gives char and midi. 
    // The user example: %%percmap g 42.  
    // 42 is Closed Hi-Hat in GM. 38 is Snare. 35 (sic, usually 36) is Kick (35 is Acoustic Bass Drum).
    char: string;
    midi: number;
}

// State now represents the logical intent, not just "closed/open"
type NoteState = 'base' | 'alt' | 'decoration' | 'flam' | null;

interface GroupedInstrument {
    type: 'grouped';
    label: string;
    style: 'hihat' | 'snare'; // Determines the icons and specific decorations

    baseChar: string;    // e.g. 'g' (Closed HH) or 'c' (Snare)
    baseMidi: number;

    altChar: string;     // e.g. '^g' (Open HH) or 'd' (Side Stick)
    altMidi: number;
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
    35: "Kick",
    36: "E-Kick",
    37: "Side Stick",
    38: "Snare",
    39: "Hand Clap",
    40: "E-Snare",
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

        let nextVisible: PercMap[] = [];

        if (usedMaps.length > 0) {
            nextVisible = usedMaps;
        } else {
            // Fall back to first 3 instruments
            nextVisible = this.percMaps.slice(0, this.maxVisible);
        }

        // --- ENFORCE HI-HAT PAIRING (42 & 46) ---
        const hasClosed = nextVisible.some(m => m.midi === 42);
        const hasOpen = nextVisible.some(m => m.midi === 46);

        if (hasClosed && !hasOpen) {
            const openMap = this.percMaps.find(m => m.midi === 46);
            if (openMap) nextVisible.push(openMap);
        } else if (!hasClosed && hasOpen) {
            const closedMap = this.percMaps.find(m => m.midi === 42);
            if (closedMap) nextVisible.push(closedMap);
        }

        // --- ENFORCE SNARE PAIRING (38 & 37) ---
        // FIX: Add this block so Snare always pulls in Side Stick
        const hasSnare = nextVisible.some(m => m.midi === 38);
        const hasSideStick = nextVisible.some(m => m.midi === 37);

        if (hasSnare && !hasSideStick) {
            const sideStickMap = this.percMaps.find(m => m.midi === 37);
            if (sideStickMap) nextVisible.push(sideStickMap);
        } else if (!hasSnare && hasSideStick) {
            const snareMap = this.percMaps.find(m => m.midi === 38);
            if (snareMap) nextVisible.push(snareMap);
        }

        this.visibleMaps = nextVisible;
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

        // 1. Check for Hi-Hat Pair (42 & 46)
        const closedHH = this.visibleMaps.find(m => m.midi === 42);
        const openHH = this.visibleMaps.find(m => m.midi === 46);

        if (closedHH && openHH) {
            rows.push({
                type: 'grouped',
                label: 'Hi-Hat',
                style: 'hihat',
                baseChar: closedHH.char,
                baseMidi: 42,
                altChar: openHH.char,
                altMidi: 46
            });
            processed.add(closedHH.char);
            processed.add(openHH.char);
        }

        // 2. Check for Snare Pair (38 & 37)
        const snare = this.visibleMaps.find(m => m.midi === 38);
        const sideStick = this.visibleMaps.find(m => m.midi === 37);

        if (snare && sideStick) {
            rows.push({
                type: 'grouped',
                label: 'Snare',
                style: 'snare',
                baseChar: snare.char,
                baseMidi: 38,
                altChar: sideStick.char,
                altMidi: 37
            });
            processed.add(snare.char);
            processed.add(sideStick.char);
        }

        // 3. Add remaining singles
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

    // Generic parser for grouped instruments
    // Returns: { char: string, state: HiHatState }[][] for 16 ticks
    private parseBarToStateGrid(barText: string, instrument: GroupedInstrument): NoteState[] {
        const grid: NoteState[] = Array(16).fill(null);
        const tokenRegex = /((?:!.*?!)*(?:o)?(?:\{[^}]+\})?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

        let currentTick = 0;
        let match;

        while ((match = tokenRegex.exec(barText)) !== null) {
            if (currentTick >= 16) break;
            const fullText = match[0];
            const coreContent = match[1];
            const durationStr = match[2];

            // ... (Duration parsing logic - same as before) ...
            let duration = 1;
            if (durationStr === '/') duration = 0.5;
            else if (durationStr && !durationStr.includes('/')) duration = parseInt(durationStr);
            if (coreContent.startsWith('"')) duration = 0;
            const ticks = (duration === 0 && coreContent.startsWith('"')) ? 0 : (Math.round(duration) || 1);

            const tickIdx = Math.floor(currentTick);

            // 1. Detect Flam (Presence of curly braces)
            const isFlam = /\{[^}]+\}/.test(coreContent);

            // 2. Detect Decorations
            const isDecorated = instrument.style === 'hihat'
                ? (coreContent.includes('!>!'))
                : (coreContent.includes('!g!'));

            // 3. Detect "Alternate" State
            const hasOpenPrefix = /^((?:!.*?!)*)o/.test(coreContent);

            // Clean content to check inner chars
            // Remove decorations, 'o', AND grace notes to find the main note
            let innerContent = coreContent.replace(/^((?:!.*?!)*)(o)?(?:\{[^}]+\})?/, '');

            if (innerContent.startsWith('[')) innerContent = innerContent.slice(1, -1);

            const hasBaseChar = innerContent.includes(instrument.baseChar);
            const hasAltChar = innerContent.includes(instrument.altChar);

            if (hasBaseChar || hasAltChar) {
                if (isFlam && instrument.style === 'snare') {
                    grid[tickIdx] = 'flam'; // Priority to Flam for Snare
                } else if (isDecorated) {
                    grid[tickIdx] = 'decoration';
                } else if ((instrument.style === 'hihat' && hasOpenPrefix) || hasAltChar) {
                    grid[tickIdx] = 'alt';
                } else {
                    grid[tickIdx] = 'base';
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

        // Initial Absolute start index (immediately after the pipe)
        let absStart = lineStart + localStart;

        // Search forwards from cursor for | or ::
        // We search in the substring from cursor to lineEnd
        const lineAfterCursor = content.substring(cursor, lineEnd);
        let localEnd = lineAfterCursor.search(barSeparator);

        if (localEnd === -1) {
            localEnd = lineAfterCursor.length;
        }

        // Absolute end index
        const absEnd = cursor + localEnd;

        // --- NEW STEP 4: Trim Inline Headers (e.g., [V:K], [M:4/4]) ---
        // We look at the candidate bar string to see if it starts with an inline field.
        // We only want to shift the start, we don't change the end.

        const rawBarCandidate = content.substring(absStart, absEnd);

        // Regex Explanation:
        // ^\s*             : Matches optional whitespace at the beginning (e.g. "|  [V:1]")
        // (                : Group to capture the headers
        //   (?:            : Non-capturing group for the field itself
        //     \[[A-Za-z]:  : Starts with '[' followed by a Letter and ':' (e.g. [V:, [M:)
        //     [^\]]*       : Anything that isn't a closing bracket
        //     \]           : Closing bracket
        //     \s*          : Optional whitespace after the bracket
        //   )+             : Allow one or more headers (e.g. [V:1][K:perc])
        // )
        const inlineHeaderRegex = /^\s*((?:\[[A-Za-z]:[^\]]*\]\s*)+)/;

        const headerMatch = rawBarCandidate.match(inlineHeaderRegex);

        if (headerMatch) {
            // headerMatch[0] is the full text of the headers including surrounding spaces.
            // Example: "  [V:K]  "
            // We shift absStart forward by this length.
            absStart += headerMatch[0].length;
        }

        // 5. Set Context
        // If the shift moved start past end (empty bar with just header), handle gracefully
        if (absStart > absEnd) {
            absStart = absEnd;
        }

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

            let stateGrid: NoteState[] | null = null; // Renamed variable for clarity

            if (instrumentRow.type === 'grouped') {
                stateGrid = this.parseBarToStateGrid(this.currentBar, instrumentRow);
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

                    if (instrumentRow.type === 'grouped' && stateGrid) {
                        const stateGrid = this.parseBarToStateGrid(this.currentBar, instrumentRow);
                        // Grouped hi-hat rendering
                        const state = stateGrid[globalStep];
                        if (state) {
                            const diamond = stepContainer.createDiv({ cls: 'abc-drum-diamond' });
                            // styling...
                            diamond.style.width = '14px';
                            diamond.style.height = '14px';
                            diamond.style.backgroundColor = 'var(--text-normal)';
                            diamond.style.transform = 'rotate(45deg)';
                            diamond.style.display = 'flex';
                            diamond.style.justifyContent = 'center';
                            diamond.style.alignItems = 'center';

                            // Indicator Logic
                            const indicator = diamond.createDiv({ cls: 'abc-drum-diamond-indicator' });
                            indicator.style.transform = 'rotate(-45deg)';
                            indicator.style.fontSize = '10px';
                            indicator.style.fontWeight = 'bold';
                            indicator.style.color = 'var(--background-primary)';
                            indicator.style.lineHeight = '1';

                            if (instrumentRow.style === 'hihat') {
                                if (state === 'alt') indicator.innerText = '○'; // Open
                                if (state === 'decoration') indicator.innerText = '>'; // Accent
                            }
                            else if (instrumentRow.style === 'snare') {
                                if (state === 'alt') {
                                    indicator.innerText = 'x'; // Side Stick
                                    // Optional: Make font slightly larger for x
                                    indicator.style.fontSize = '12px';
                                }
                                if (state === 'decoration') {
                                    indicator.innerText = '(•)'; // Ghost Note
                                    indicator.style.fontSize = '8px'; // Smaller to fit
                                }
                                if (state === 'flam') {
                                    indicator.innerText = '♪';
                                    indicator.style.fontSize = '10px';
                                    indicator.style.marginLeft = '-2px'; // Adjust centering
                                }
                            }
                        }

                        // Click Handlers
                        stepContainer.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.toggleGroupedNote(globalStep, instrumentRow, 'base');
                        });

                        stepContainer.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            this.showGroupedContextMenu(e, globalStep, instrumentRow, state);
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
                        ? (stateGrid && stateGrid[globalStep] !== null)
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
                visibleChars.add(row.baseChar);
                visibleChars.add(row.altChar);
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

                    // Check if remaining note is an "open-able" or "alt" instrument
                    let shouldKeepOpen = false;
                    for (const row of this.visibleRows) {
                        if (row.type === 'grouped' && remainingNote.includes(row.altChar)) {
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
        menu.style.maxHeight = '300px';
        menu.style.overflowY = 'auto';

        const header = document.createElement('div');
        header.innerText = "Add Instrument";
        header.style.padding = '4px 12px';
        header.style.fontSize = '11px';
        header.style.color = 'var(--text-muted)';
        header.style.borderBottom = '1px solid var(--background-modifier-border)';
        header.style.marginBottom = '4px';
        menu.appendChild(header);

        // --- CUSTOM LOGIC: Handle Hi-Hat grouping in menu ---
        const closedHH = hiddenMaps.find(m => m.midi === 42);
        const openHH = hiddenMaps.find(m => m.midi === 46);
        const processedMidis = new Set<number>();

        // 1. If both Hi-Hats are hidden, create a single "Hi-Hat" entry
        if (closedHH && openHH) {
            const item = document.createElement('div');
            item.className = 'abc-drum-context-menu-item';
            item.style.padding = '6px 12px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.fontSize = '12px';
            item.style.color = 'var(--text-normal)';

            const labelSpan = document.createElement('span');
            labelSpan.innerText = "Hi-Hat"; // Combined label
            item.appendChild(labelSpan);

            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'transparent';
            });

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                // Add BOTH to visible maps
                this.visibleMaps.push(closedHH);
                this.visibleMaps.push(openHH);
                this.render();
            });

            menu.appendChild(item);
            processedMidis.add(42);
            processedMidis.add(46);
        }

        // 2. Add remaining hidden maps
        hiddenMaps.forEach(map => {
            if (processedMidis.has(map.midi)) return;

            const item = document.createElement('div');
            item.className = 'abc-drum-context-menu-item';
            item.style.padding = '6px 12px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.fontSize = '12px';
            item.style.color = 'var(--text-normal)';

            const labelSpan = document.createElement('span');
            labelSpan.innerText = map.label;
            item.appendChild(labelSpan);

            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'transparent';
            });

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                this.visibleMaps.push(map);
                this.render();
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }
    // Show context menu for hi-hat with Close/Open/Accent options
    private showGroupedContextMenu(event: MouseEvent, tickIndex: number, instrument: GroupedInstrument, currentState: NoteState) {
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

        const options: { label: string; state: NoteState; icon: string }[] = [];

        if (instrument.style === 'hihat') {
            options.push({ label: 'Closed', state: 'base', icon: '✕' });
            options.push({ label: 'Open', state: 'alt', icon: '○' });
            options.push({ label: 'Accent', state: 'decoration', icon: '>' });
        } else if (instrument.style === 'snare') {
            options.push({ label: 'Snare', state: 'base', icon: '●' });
            options.push({ label: 'Side Stick', state: 'alt', icon: 'x' });
            options.push({ label: 'Ghost', state: 'decoration', icon: '(•)' });
            options.push({ label: 'Flam', state: 'flam', icon: '♪' });
        }

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
                this.toggleGroupedNote(tickIndex, instrument, opt.state);
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
    private toggleGroupedNote(tickIndex: number, instrument: GroupedInstrument, targetState: NoteState) {
        if (!this.currentBarContext || this.currentBar === null) return;

        const stateGrid = this.parseBarToStateGrid(this.currentBar, instrument);
        const currentState = stateGrid[tickIndex];

        if (targetState === currentState) targetState = null;

        let noteStr = '';

        if (targetState === 'base') {
            // Closed HH or Normal Snare
            noteStr = instrument.baseChar;
        }
        else if (targetState === 'alt') {
            // Open HH (o^g) or Side Stick (d)
            if (instrument.style === 'hihat') {
                noteStr = `o${instrument.altChar}`;
            } else {
                noteStr = instrument.altChar; // Side stick is just the note char, no prefix
            }
        }
        else if (targetState === 'decoration') {
            // Accent (!>!g) or Ghost (!g!c)
            if (instrument.style === 'hihat') {
                noteStr = `!>!${instrument.baseChar}`;
            } else {
                noteStr = `!g!${instrument.baseChar}`;
            }
        }
        else if (targetState === 'flam') {
            // Flam syntax: {grace}main
            // We assume the grace note is the base char (e.g. {c}c)
            noteStr = `{${instrument.baseChar}}${instrument.baseChar}`;
        }

        this.modifyGroupedNoteInBar(tickIndex, instrument, currentState, targetState, noteStr);
    }

    // Modify hi-hat note in the bar
    private modifyGroupedNoteInBar(tickIndex: number, instrument: GroupedInstrument, currentState: NoteState, targetState: NoteState, noteStr: string) {
        // 1. Parse tokens (Existing logic - kept exactly as is)
        const tokenRegex = /((?:!.*?!)*(?:o)?(?:\{[^}]+\})?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

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
                duration = 0;
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

        // 2. Find token at tick (Existing logic)
        let currentTick = 0;
        let targetTokenIdx = -1;

        for (let i = 0; i < tokens.length; i++) {
            if (currentTick <= tickIndex && (currentTick + tokens[i].duration) > tickIndex) {
                targetTokenIdx = i;
                break;
            }
            currentTick += tokens[i].duration;
        }

        // Helper for dispatching changes
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

        // 3. Handle Append Mode (Existing logic)
        if (targetTokenIdx === -1) {
            const gap = tickIndex - currentTick;
            if (gap < 0) return;

            let appendStr = '';
            for (let k = 0; k < gap; k++) {
                const tick = currentTick + k;
                if (tick > 0 && tick % 4 === 0) appendStr += ' ';
                appendStr += 'z';
            }
            if (tickIndex > 0 && tickIndex % 4 === 0) appendStr += ' ';

            if (targetState) {
                appendStr += noteStr;
            } else {
                appendStr += 'z';
            }

            applyChange(this.currentBar + appendStr);
            return;
        }

        // 4. Modify existing token
        const token = tokens[targetTokenIdx];
        let newTokenText = '';

        // Get duration part
        const durMatch = token.text.match(/([\d\/]+)$/);
        const durationPart = durMatch ? durMatch[1] : '';

        // --- NEW GENERIC LOGIC STARTS HERE ---

        // Define what specific decoration we need to look for based on style
        // HiHat uses !>!, Snare uses !g!
        const decorationToRemove = instrument.style === 'hihat' ? '!>!' : '!g!';
        const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (targetState === null) {
            // == DELETION CASE ==

            if (token.text.includes('[')) {
                // Parse existing prefix and content
                const prefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(\[.*)/);

                let decorations = prefixMatch?.[1] || '';
                // const openPrefix = prefixMatch?.[2] || '';
                // const gracePart = prefixMatch?.[3] || ''; // Ignore, we are deleting
                const chordPart = prefixMatch?.[4] || token.text;

                // Remove instrument specific decoration
                decorations = decorations.replace(new RegExp(escapeRegExp(decorationToRemove), 'g'), '');

                // Note: We automatically lose the Grace Note ({}) because we aren't rebuilding it here,
                // and the "flam" state logic below (in Add/Change) handles putting it back if needed.
                // Since we are deleting, losing the grace note attached to THIS instrument is correct.
                // (Assuming the grace note belongs to this instrument).

                let inner = chordPart.match(/\[([^\]]+)\]/)?.[1] || '';

                //Remove Base and Alt chars (generic)
                const removePatterns = [
                    instrument.baseChar,
                    instrument.altChar
                ];

                for (const pat of removePatterns) {
                    inner = inner.replace(new RegExp(escapeRegExp(pat), 'g'), '');
                }

                // Check what remains
                const remainingNotes = inner.match(/[\^=_]*[A-Ga-g][,']*/g) || [];

                // If remaining notes exist, we reconstruct. 
                // IMPORTANT: If other instruments had a grace note (unlikely in drum map), 
                // losing the {} prefix here might affect them. 
                // But generally {c}[Kc] -> flam is on snare. If we remove snare, we remove flam.

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
            // == ADD / CHANGE CASE ==

            // noteStr comes from toggleGroupedNote (e.g., "!g!c" or "o^g")

            // Extract modifiers from the REQUESTED noteStr
            const noteMatch = noteStr.match(/^((?:!.*?!)*)(o)?(.*)$/);
            const newDecorations = noteMatch?.[1] || '';
            const newOpenPrefix = noteMatch?.[2] || '';
            const newGrace = noteMatch?.[3] || ''; // Capture {c}
            const innerNote = noteMatch?.[4] || noteStr;

            if (token.text.includes('[')) {
                // -- CHORD LOGIC --

                // Regex to capture existing parts
                const existingPrefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(\[.*)/);
                let existingDecorations = existingPrefixMatch?.[1] || '';
                // const existingOpen = existingPrefixMatch?.[2] || '';
                // const existingGrace = existingPrefixMatch?.[3] || ''; // Discard old grace
                const chordPart = existingPrefixMatch?.[4] || token.text;

                let inner = chordPart.match(/\[([^\]]+)\]/)?.[1] || '';

                // 1. Remove any existing versions of this instrument (Base or Alt)
                const removePatterns = [
                    instrument.baseChar,
                    instrument.altChar
                ];

                for (const pat of removePatterns) {
                    inner = inner.replace(new RegExp(escapeRegExp(pat), 'g'), '');
                }

                // 2. Add new note content
                inner = inner + innerNote;

                // 3. Clean up OLD specific decorations (remove !>! or !g! from the existing set)
                // This ensures if we switch from Ghost (!g!) to Normal, !g! is gone.
                existingDecorations = existingDecorations.replace(new RegExp(escapeRegExp(decorationToRemove), 'g'), '');

                // 4. Combine decorations
                let combinedDecorations = existingDecorations;
                if (newDecorations && !combinedDecorations.includes(newDecorations)) {
                    combinedDecorations += newDecorations;
                }

                // 5. Determine 'o' prefix
                // If the new note is Open HiHat, it brings 'o'. If it's Snare or Closed HH, 'newOpenPrefix' is empty.
                // We discard the old 'o' because the state of this instrument dictates it.
                const combinedOpen = newOpenPrefix || '';

                const combinedGrace = newGrace || '';

                // Build token
                newTokenText = `${combinedDecorations}${combinedOpen}[${inner}]${durationPart}`;

            } else if (token.text.match(/^z/i)) {
                // -- REST LOGIC --
                newTokenText = noteStr + durationPart;

            } else {
                // -- SINGLE NOTE LOGIC --

                // Existing single note... check if it IS this instrument or another one
                const existingMatch = token.text.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(.*)$/);
                const existingDecorations = existingMatch?.[1] || '';
                // const existingGrace = existingMatch?.[3] || '';
                const coreToken = existingMatch?.[4] || token.text;
                const coreTokenNoDir = coreToken.replace(/[\d\/]+$/, '');


                const isThisInstrument = coreTokenNoDir.includes(instrument.baseChar) ||
                    coreTokenNoDir.includes(instrument.altChar);

                if (isThisInstrument) {
                    // REPLACE: It's currently a snare/hihat, and we are changing its state
                    newTokenText = noteStr + durationPart;

                    // Preserve generic decorations (like !f!) if they aren't in the new noteStr
                    if (existingDecorations && !noteStr.startsWith(existingDecorations)) {
                        // Strip the specific decoration from the old string so we don't double up
                        const cleanExisting = existingDecorations.replace(new RegExp(escapeRegExp(decorationToRemove), 'g'), '');

                        // If noteStr has decorations (e.g. !>!), prepend the clean existing ones
                        if (noteStr.match(/^!.*?!/)) {
                            // noteStr already has !>!, just add existing generic ones before it
                            newTokenText = cleanExisting + noteStr + durationPart;
                        } else {
                            newTokenText = cleanExisting + noteStr + durationPart;
                        }
                    }
                } else {
                    // MERGE
                    let combinedDecorations = existingDecorations;
                    if (newDecorations && !combinedDecorations.includes(newDecorations)) combinedDecorations += newDecorations;

                    const combinedOpen = newOpenPrefix || existingMatch?.[2] || '';

                    // Priority to NEW grace note (flam)
                    const combinedGrace = newGrace || existingMatch?.[3] || '';

                    newTokenText = `${combinedDecorations}${combinedOpen}${combinedGrace}[${innerNote}${coreTokenNoDir}]${durationPart}`;
                }
            }
        }

        // 5. Rebuild bar (Existing logic)
        let newBar = '';
        currentTick = 0;

        for (let i = 0; i < tokens.length; i++) {
            if (currentTick > 0 && currentTick % 4 === 0) {
                newBar += ' ';
            }
            if (i === targetTokenIdx) {
                newBar += newTokenText;
            } else {
                newBar += tokens[i].text.trim();
            }
            currentTick += tokens[i].duration;
        }

        applyChange(newBar);
    }
}
