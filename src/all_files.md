# Table of Contents

1. [drum_grid.ts](#drum_grid.ts)
2. [drum_grid/drum_definitions.ts](#drum_grid/drum_definitions.ts)
3. [drum_grid/drum_duration_manager.ts](#drum_grid/drum_duration_manager.ts)
4. [drum_grid/drum_grid_parser.ts](#drum_grid/drum_grid_parser.ts)
5. [drum_grid/drum_types.ts](#drum_grid/drum_types.ts)

---

## drum_grid.ts
ts
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { DRUM_DEFS, DrumGroupDefinition, DrumDecoration } from './drum_grid/drum_definitions';
import { DurationManager } from './drum_grid/drum_duration_manager';
import { DrumGridParser } from './drum_grid/drum_grid_parser';
import { PercMap, NoteState, GroupedInstrument, SingleInstrument, InstrumentRow, Token, OptimizableToken } from './drum_grid/drum_types';

// GM Drum Map (Subset for labels)

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
    51: "Ride",
    52: "China",
    53: "Ride Bell",
    54: "Tambourine",
    55: "Splash",
    56: "Cowbell",
    57: "Crash 2",
    58: "Vibraslap",
    59: "Ride Edge",
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
    private currentBar: string = "";
    private currentBarContext: { start: number, end: number } | null = null;
    private durationManager = new DurationManager();
    private parser: DrumGridParser;
    private timeSignatureOpt = 16; // Granularity (16th notes)
    private contextMenu: HTMLElement | null = null;
    private manuallyShownMidis: Set<number> = new Set();
    private isLocked: boolean = false; //
    private fullContent: string = "";  // <--- Store full content for global scanning
    private beatSubdivisions: ('straight' | 'triplet')[] = ['straight', 'straight', 'straight', 'straight'];

    constructor(parent: HTMLElement, private editorViewGetter: () => EditorView | null) {
        this.parser = new DrumGridParser(this.durationManager);
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
        this.fullContent = content;

        this.durationManager.updateHeaderConfig(content);


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
            this.detectBeatSubdivisions(this.parseBarToTokens(this.currentBar));
            this.updateVisibleInstruments();
            this.render();
        }
    }

    private detectBeatSubdivisions(tokens: Token[]) {
        const newModes: ('straight' | 'triplet')[] = ['straight', 'straight', 'straight', 'straight'];

        let currentTick = 0;

        for (const token of tokens) {
            // Calculate current tick (parser provides tokens in sequence)
            const beatIdx = Math.floor(currentTick / 24);

            if (beatIdx >= 0 && beatIdx < 4) {
                const relTick = currentTick % 24;

                // Evidence 1: Timing (Triplet 8th note slots: 0, 8, 16)
                if (relTick === 8 || relTick === 16) {
                    newModes[beatIdx] = 'triplet';
                }

                // Evidence 2: Duration (Triplet 8th is 8 ticks)
                // Note: We check if duration is approx 8 (rounding for safety against floating point issues if any)
                if (Math.round(token.duration) === 8) {
                    newModes[beatIdx] = 'triplet';
                }
            }

            currentTick += token.duration;
        }

        this.beatSubdivisions = newModes;
    }



    private extractNotesFromEntireTune(): Set<string> {
        const allNotes = new Set<string>();
        const lines = this.fullContent.split('\n');

        for (let line of lines) {
            const trimmed = line.trim();

            // Skip empty lines
            if (!trimmed) continue;

            // Skip Comments (%) and Directives (%%)
            if (trimmed.startsWith('%')) continue;

            // Skip Header Fields (Letter + Colon, e.g., "M:4/4", "K:perc", "V:1")
            // Regex checks for Start of line, Letter, Colon.
            if (/^[A-Za-z]:/.test(trimmed)) continue;

            // Skip Lyrics (w:) - covered by the header check above (w is a field)

            // If we are here, it's likely a music line.
            // Use existing extraction logic on this line
            const notesInLine = this.extractNotesFromBar(trimmed);
            notesInLine.forEach(n => allNotes.add(n));
        }

        return allNotes;
    }

    // Extract unique note characters from a bar
    private extractNotesFromBar(barContent: string): Set<string> {
        return this.parser.extractNotesFromBar(barContent);
    }

    // Update visible instruments based on notes in current bar (or previous bar as fallback)
    private updateVisibleInstruments() {
        if (this.percMaps.length === 0) return;

        // 1. Find notes currently written in the text
        let usedNotes: Set<string>;

        // --- CHECK LOCK STATUS ---
        if (this.isLocked) {
            // If locked, scan the WHOLE file
            usedNotes = this.extractNotesFromEntireTune();
        } else {
            // If unlocked, use current bar (Standard behavior)
            usedNotes = this.extractNotesFromBar(this.currentBar);
            if (usedNotes.size === 0 && this.previousBarContent) {
                usedNotes = this.extractNotesFromBar(this.previousBarContent);
            }
        }


        // 2. Initialize visible list with maps found in text
        const nextVisible: PercMap[] = [];

        for (const map of this.percMaps) {
            if (usedNotes.has(map.char)) {
                nextVisible.push(map);
            }
        }

        // 3. Merge in Manually Shown Instruments (from '+' button)
        this.manuallyShownMidis.forEach(midi => {
            if (!nextVisible.some(m => m.midi === midi)) {
                const map = this.percMaps.find(m => m.midi === midi);
                if (map) nextVisible.push(map);
            }
        });

        // 4. GENERIC GROUP ENFORCEMENT (Data-Driven)
        // This replaces the hardcoded Hi-Hat and Snare blocks
        for (const def of DRUM_DEFS) {
            // Collect all midis for this group (Base + all Alts)
            const groupMidis = [def.baseMidi, ...def.alts.map(a => a.midi)];

            // Check if ANY instrument from this group is currently visible
            const isGroupActive = nextVisible.some(m => groupMidis.includes(m.midi));

            if (isGroupActive) {
                // If the group is active, pull in ALL members of the group
                // (provided they exist in the user's mapping)
                groupMidis.forEach(midi => {
                    const isAlreadyVisible = nextVisible.some(m => m.midi === midi);
                    if (!isAlreadyVisible) {
                        const map = this.percMaps.find(m => m.midi === midi);
                        if (map) nextVisible.push(map);
                    }
                });
            }
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

        // 1. Loop through our Definitions (Data-Driven)
        for (const def of DRUM_DEFS) {
            const baseMap = this.visibleMaps.find(m => m.midi === def.baseMidi);

            // For now, we look for the first matching Alt in the definition
            // (The code supports 1 active alt, though config allows many)
            let altMap: PercMap | undefined;
            let activeAltDef = def.alts[0];

            for (const altDef of def.alts) {
                const found = this.visibleMaps.find(m => m.midi === altDef.midi);
                if (found) {
                    altMap = found;
                    activeAltDef = altDef;
                    break;
                }
            }

            // We create a Grouped Row if:
            // A) We have Base AND Alt (e.g. HiHat Closed + Open)
            // B) We have Base AND the definition has NO Alts (e.g. Tom with just Flams/Ghosts)
            const isCompletePair = baseMap && altMap;
            const isSoloWithAdvancedFeatures = baseMap && def.alts.length === 0;

            if (isCompletePair || isSoloWithAdvancedFeatures) {
                // Determine chars. If no alt exists, use a unique placeholder that won't match any note
                // so the parser doesn't get confused.
                const resolvedBase = baseMap!.char;
                const resolvedAlt = altMap ? altMap.char : "%%__NO_ALT__%%";

                rows.push({
                    type: 'grouped',
                    def: def,
                    label: def.label,
                    baseChar: resolvedBase,
                    altChar: resolvedAlt
                });

                processed.add(resolvedBase);
                if (altMap) processed.add(resolvedAlt);
            }
        }

        // 2. Add remaining singles (Generic fallback)
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
    private parseBarToStateGrid(barText: string, instrument: GroupedInstrument): NoteState[] {
        return this.parser.parseBarToStateGrid(barText, instrument);
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

    private getDecorationIconAtTick(barText: string, tickIndex: number, def: DrumGroupDefinition): string {
        return this.parser.getDecorationIconAtTick(barText, tickIndex, def);
    }

    private render() {
        this.gridContainer.empty();

        if (this.percMaps.length === 0) {
            this.gridContainer.createDiv({ text: "No %%percmap directives found." });
            return;
        }

        const beatWidth = 160; // 8 * 20px
        const cellHeight = 32;
        const labelWidth = 90;
        const beatGroupGap = 2;

        // --- Render Header Row ---
        const headerRow = this.gridContainer.createDiv({ cls: 'abc-drum-row abc-drum-header' });
        headerRow.style.display = 'flex';
        headerRow.style.alignItems = 'center';

        // 1. CREATE SLIDING TOGGLE SWITCH (Lock)
        const lockContainer = headerRow.createDiv({ cls: 'abc-drum-lock-container' });
        lockContainer.style.width = `${labelWidth}px`;
        lockContainer.style.marginRight = '10px';
        lockContainer.style.display = 'flex';
        lockContainer.style.justifyContent = 'center';
        lockContainer.style.alignItems = 'center';
        lockContainer.style.flexShrink = '0';

        const toggleTrack = lockContainer.createDiv({ cls: 'abc-drum-toggle-track' });
        toggleTrack.style.position = 'relative';
        toggleTrack.style.width = '50px';
        toggleTrack.style.height = '22px';
        toggleTrack.style.borderRadius = '11px';
        toggleTrack.style.cursor = 'pointer';
        toggleTrack.style.transition = 'all 0.2s ease';
        toggleTrack.style.display = 'flex';
        toggleTrack.style.alignItems = 'center';
        toggleTrack.style.justifyContent = 'space-between';
        toggleTrack.style.padding = '0 6px';
        toggleTrack.style.boxSizing = 'border-box';

        if (this.isLocked) {
            toggleTrack.style.backgroundColor = 'transparent';
            toggleTrack.style.border = '2px solid var(--text-accent)';
        } else {
            toggleTrack.style.backgroundColor = 'transparent';
            toggleTrack.style.border = '2px solid var(--background-modifier-border)';
        }

        const iconLocked = toggleTrack.createDiv();
        iconLocked.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
        iconLocked.style.color = this.isLocked ? 'var(--text-accent)' : 'transparent';
        iconLocked.style.display = 'flex';
        iconLocked.style.opacity = this.isLocked ? '1' : '0';
        iconLocked.style.transition = 'opacity 0.2s ease';

        const iconUnlocked = toggleTrack.createDiv();
        iconUnlocked.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
        iconUnlocked.style.color = 'var(--text-muted)';
        iconUnlocked.style.display = 'flex';
        iconUnlocked.style.opacity = this.isLocked ? '0' : '1';
        iconUnlocked.style.transition = 'opacity 0.2s ease';

        const knob = toggleTrack.createDiv({ cls: 'abc-drum-toggle-knob' });
        knob.style.position = 'absolute';
        knob.style.top = '2px';
        knob.style.width = '14px';
        knob.style.height = '14px';
        knob.style.borderRadius = '50%';
        knob.style.transition = 'all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)';
        knob.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';

        if (this.isLocked) {
            knob.style.left = '30px';
            knob.style.backgroundColor = 'var(--text-accent)';
        } else {
            knob.style.left = '3px';
            knob.style.backgroundColor = 'var(--text-muted)';
            knob.style.opacity = '0.5';
        }

        toggleTrack.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isLocked = !this.isLocked;
            this.updateVisibleInstruments();
            this.render();
        });

        const headerGridArea = headerRow.createDiv({ cls: 'abc-drum-header-grid-area' });
        headerGridArea.style.display = 'flex';
        headerGridArea.style.gap = `${beatGroupGap}px`;

        // Render Beat Labels and Subdivisions
        for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
            const beatGroup = headerGridArea.createDiv({ cls: 'abc-drum-beat-group' });
            beatGroup.style.display = 'flex';
            beatGroup.style.width = `${beatWidth}px`; // Fixed width
            beatGroup.style.border = '1px solid var(--background-modifier-border)';
            beatGroup.style.borderRadius = '4px';
            beatGroup.style.padding = '0';
            beatGroup.style.backgroundColor = 'var(--background-secondary)';
            beatGroup.style.overflow = 'hidden';
            beatGroup.style.cursor = 'pointer';
            beatGroup.title = 'Left-Click or Right-Click to change subdivision';

            // Use mousedown to catch clicks reliably in Obsidian environment
            // Handle both left (0) and right (2) clicks
            const handleHeaderClick = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                this.showBeatContextMenu(e, beatIdx);
            };

            beatGroup.addEventListener('click', handleHeaderClick);
            beatGroup.addEventListener('contextmenu', handleHeaderClick);

            const mode = this.beatSubdivisions[beatIdx];
            // Remove the inner button if it exists/conflicts, or keep it strictly visual
            // The entire group is now the interaction target.
            // 8 steps for straight (32nd note grid), 3 steps for triplet
            const steps = mode === 'straight' ? 8 : 3;
            const currentCellWidth = beatWidth / steps;

            for (let s = 0; s < steps; s++) {
                const cell = beatGroup.createDiv();
                cell.style.width = `${currentCellWidth}px`;
                cell.style.height = '100%';
                cell.style.display = 'flex';
                cell.style.alignItems = 'center';
                cell.style.justifyContent = 'center';
                cell.style.fontSize = '10px';
                cell.style.color = 'var(--text-muted)';

                // Optional: vertical dividers to match grid lines?
                // cell.style.borderRight = '1px solid var(--background-modifier-border-hover)';

                let text = '';
                if (s === 0) {
                    text = (beatIdx + 1).toString();
                    cell.style.fontWeight = 'bold';
                    cell.style.fontSize = '12px';
                    cell.style.color = 'var(--text-normal)';
                    if (mode === 'triplet') cell.style.color = 'var(--text-accent)';
                }
                else if (mode === 'straight') {
                    // Straight (32nd grid, 8 slots): 0, 1, 2(e), 3, 4(&), 5, 6(a), 7
                    if (s === 2) text = 'e';
                    if (s === 4) text = '&';
                    if (s === 6) text = 'a';
                }
                else {
                    // Triplet (3 slots): 0, 1, 2
                    if (s === 1) text = 'Trip';
                    if (s === 2) text = 'let';
                }

                cell.innerText = text;
            }
        }

        // Build instrument rows
        this.visibleRows = this.buildInstrumentRows();
        const parsedNotes = this.parseBarToGrid(this.currentBar); // 96-tick grid

        this.visibleRows.forEach((instrumentRow, rowIndex) => {
            const row = this.gridContainer.createDiv({ cls: 'abc-drum-row abc-drum-instrument-row' });
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.position = 'relative';
            row.style.height = `${cellHeight}px`;

            // Label
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

            // Grid area
            const gridArea = row.createDiv({ cls: 'abc-drum-grid-area' });
            gridArea.style.display = 'flex';
            gridArea.style.position = 'relative';
            gridArea.style.height = `${cellHeight}px`;
            gridArea.style.gap = `${beatGroupGap}px`;

            let stateGrid: NoteState[] | null = null;
            if (instrumentRow.type === 'grouped') {
                stateGrid = this.parseBarToStateGrid(this.currentBar, instrumentRow);
            }

            // Render 4 beats
            for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
                const mode = this.beatSubdivisions[beatIdx];
                const steps = mode === 'straight' ? 8 : 3;
                const tickIncrement = mode === 'straight' ? 3 : 8; // 24 ticks per beat (3*8=24)

                // Calculate cell width for this beat
                // Total width 160px. Straight: 20px. Triplet: 160/3 = 53.33px.
                const currentCellWidth = 160 / steps;

                const beatGroup = gridArea.createDiv({ cls: 'abc-drum-beat-grid-group' });
                beatGroup.style.display = 'flex';
                beatGroup.style.position = 'relative';
                beatGroup.style.height = '100%';
                beatGroup.style.width = `${beatWidth}px`; // Fixed width

                const hLine = beatGroup.createDiv({ cls: 'abc-drum-h-line' });
                hLine.style.position = 'absolute';
                hLine.style.top = '50%';
                hLine.style.left = '0';
                hLine.style.right = '0';
                hLine.style.height = '1px';
                hLine.style.borderTop = '1px dashed var(--background-modifier-border)';
                hLine.style.pointerEvents = 'none';

                for (let s = 0; s < steps; s++) {
                    const currentTick = (beatIdx * 24) + (s * tickIncrement);

                    const stepContainer = beatGroup.createDiv({ cls: 'abc-drum-step' });
                    stepContainer.style.width = `${currentCellWidth}px`;
                    stepContainer.style.height = '100%';
                    stepContainer.style.position = 'relative';
                    stepContainer.style.cursor = 'pointer';
                    stepContainer.style.display = 'flex';
                    stepContainer.style.justifyContent = 'center';
                    stepContainer.style.alignItems = 'center';

                    const vLine = stepContainer.createDiv({ cls: 'abc-drum-v-line' });
                    vLine.style.position = 'absolute';
                    vLine.style.left = '50%';
                    vLine.style.width = '1px';
                    vLine.style.borderLeft = '1px dashed var(--background-modifier-border)';
                    vLine.style.pointerEvents = 'none';

                    if (mode === 'straight') {
                        const is16th = s % 2 === 0;
                        if (is16th) {
                            vLine.style.top = '0'; vLine.style.bottom = '0';
                        } else {
                            vLine.style.top = '30%'; vLine.style.bottom = '30%';
                        }
                    } else {
                        // All triplet lines full height? Or simplified?
                        vLine.style.top = '0'; vLine.style.bottom = '0';
                    }

                    if (instrumentRow.type === 'grouped' && stateGrid) {
                        const state = stateGrid[currentTick];
                        if (state) {
                            const diamond = stepContainer.createDiv({ cls: 'abc-drum-diamond' });
                            const diamSize = (mode === 'straight' && s % 2 !== 0) ? '10px' : '14px';
                            diamond.style.width = diamSize;
                            diamond.style.height = diamSize;
                            diamond.style.backgroundColor = 'var(--text-normal)';
                            diamond.style.transform = 'rotate(45deg)';
                            diamond.style.display = 'flex';
                            diamond.style.justifyContent = 'center';
                            diamond.style.alignItems = 'center';

                            const indicator = diamond.createDiv({ cls: 'abc-drum-diamond-indicator' });
                            indicator.style.transform = 'rotate(-45deg)';
                            indicator.style.fontSize = '8px';
                            indicator.style.fontWeight = 'bold';
                            indicator.style.color = 'var(--background-primary)';
                            indicator.style.lineHeight = '1';

                            const def = instrumentRow.def;
                            if (state === 'alt') {
                                indicator.innerText = def.alts[0].icon;
                            } else if (state === 'decoration') {
                                const icon = this.getDecorationIconAtTick(this.currentBar, currentTick, def);
                                indicator.innerText = icon;
                            } else if (state === 'flam') {
                                indicator.innerText = '♪';
                                indicator.style.marginLeft = '-2px';
                            }
                        }
                        stepContainer.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.toggleGroupedNote(currentTick, instrumentRow, 'base');
                        });
                        stepContainer.addEventListener('contextmenu', (e) => {
                            e.preventDefault();
                            this.showGroupedContextMenu(e, currentTick, instrumentRow, state);
                        });
                    } else if (instrumentRow.type === 'single') {
                        const isActive = parsedNotes[currentTick] && parsedNotes[currentTick].includes(instrumentRow.char);
                        if (isActive) {
                            const diamond = stepContainer.createDiv({ cls: 'abc-drum-diamond' });
                            const diamSize = (mode === 'straight' && s % 2 !== 0) ? '10px' : '14px';
                            diamond.style.width = diamSize;
                            diamond.style.height = diamSize;
                            diamond.style.backgroundColor = 'var(--text-normal)';
                            diamond.style.transform = 'rotate(45deg)';
                        }
                        stepContainer.addEventListener('click', () => {
                            this.toggleNote(currentTick, instrumentRow.char);
                        });
                    }

                    const isActive = instrumentRow.type === 'grouped'
                        ? (stateGrid && stateGrid[currentTick] !== null)
                        : (parsedNotes[currentTick] && parsedNotes[currentTick].includes((instrumentRow as SingleInstrument).char));

                    stepContainer.addEventListener('mouseenter', () => {
                        if (!isActive) stepContainer.style.backgroundColor = 'var(--background-modifier-hover)';
                    });
                    stepContainer.addEventListener('mouseleave', () => {
                        stepContainer.style.backgroundColor = 'transparent';
                    });
                }
            }
        });

        // Add Instrument Button (Same as before)
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
            addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.showAddInstrumentMenu(e, hiddenMaps); });
        }
    }

    private toggleBeatSubdivision(beatIdx: number) {
        if (this.beatSubdivisions[beatIdx] === 'straight') {
            this.beatSubdivisions[beatIdx] = 'triplet';
        } else {
            this.beatSubdivisions[beatIdx] = 'straight';
        }
        // TODO: Clear notes in this beat?
        // Yes, per requirement: "all notes in the beat should be cleared"
        this.clearBeat(beatIdx);
        this.render();
    }

    private clearBeat(beatIdx: number) {
        // Parse current bar and remove notes within the beat range
        const tokens = this.parser.parseBarToTokens(this.currentBar);
        const beatStart = beatIdx * 24;
        const beatEnd = beatStart + 24;

        // We can use rebuildBarWithOptimizedDurations but it rebuilds ONE position.
        // Better: rebuild the GridTokens by filtering out notes in range?
        // Or using buildOptimizableGrid, filtering, then serializing.

        let grid = this.buildOptimizableGrid(tokens);

        // Remove notes in range
        grid.forEach(token => {
            if (token.tickPosition >= beatStart && token.tickPosition < beatEnd) {
                token.notes = [];
                token.decorations = '';
                token.graceNote = '';
                token.openPrefix = '';
            }
        });

        // Add triplet grouping for the beat if in triplet mode?
        // The serialization logic currently doesn't add `(3...`. 
        // I need to update serializeOptimizedBar to support `(3...` syntax!

        const newBar = this.serializeOptimizedBar(grid, this.needsBarDelimiter());
        this.applyChange(newBar);
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



    // --- DELEGATED PARSING METHODS ---
    private parseBarToTokens(barText: string): Token[] {
        return this.parser.parseBarToTokens(barText);
    }


    // Convert current bar string into 32 time slots using tokens
    private parseBarToGrid(barText: string): string[][] {
        return this.parser.parseBarToGrid(barText);
    }



    private buildOptimizableGrid(tokens: Token[]): OptimizableToken[] {
        const result: OptimizableToken[] = [];
        let currentTick = 0;

        for (const token of tokens) {
            // Skip quoted annotations
            if (token.text.startsWith('"')) continue;

            const tickIdx = Math.round(currentTick);
            if (tickIdx >= this.durationManager.ticksPerBar) break;

            // Extract decorations, grace notes, open prefix from token text
            const prefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(\{[^}]+\})?(.*)$/);
            const decorations = prefixMatch?.[1] || '';
            const openPrefix = prefixMatch?.[2] || '';
            const graceNote = prefixMatch?.[3] || '';

            result.push({
                tickPosition: tickIdx,
                notes: [...token.notes], // Clone the notes array
                duration: Math.round(token.duration) || 1,
                decorations,
                graceNote,
                openPrefix
            });

            currentTick += token.duration;
        }

        return result;
    }

    /**
     * Serialize optimized tokens back to ABC string with beat spacing.
     * Groups notes by beat with spaces for readability.
     * @param addBarDelimiter If true, adds ' |' at the end if not already present
     */
    private serializeOptimizedBar(tokens: OptimizableToken[], addBarDelimiter: boolean = false): string {
        // Group tokens by beat for cleaner spacing
        const beats: string[] = ['', '', '', ''];

        // Iterate by beat to handle grouping logic
        for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
            const beatStart = beatIdx * this.durationManager.ticksPerBeat;
            const beatEnd = beatStart + this.durationManager.ticksPerBeat;

            const mode = this.beatSubdivisions[beatIdx];

            if (mode === 'triplet') {
                // STEP SEQUENCER LOGIC for Triplets
                // Strictly sample grid at 3 positions: 0, 8, 16 relative to beatStart
                // Output format: (3[note][note][note] with forced 1/8 note suffixes (12 ticks)

                let beatString = '(3';
                const offsets = [0, 8, 16];

                // Force a "virtual" duration of 12 ticks (1/8 note) to generate the correct suffix
                const forcedDurationTicks = 12;
                const durationSuffix = this.durationManager.ticksToAbcSuffix(forcedDurationTicks);

                for (const offset of offsets) {
                    const targetTick = beatStart + offset;

                    const token = tokens.find(t =>
                        t.tickPosition <= targetTick &&
                        (t.tickPosition + t.duration) > targetTick &&
                        t.notes.length > 0
                    );

                    let tokenText = '';
                    if (token) {
                        if (token.notes.length === 1) {
                            tokenText = token.decorations + token.openPrefix + token.graceNote + token.notes[0];
                        } else {
                            // Join chords correctly
                            tokenText = token.decorations + token.openPrefix + token.graceNote + '[' + token.notes.join('') + ']';
                        }
                        tokenText += durationSuffix;
                    } else {
                        // Rest
                        tokenText = 'z' + durationSuffix;
                    }

                    beatString += tokenText;
                }

                beats[beatIdx] = beatString;

            } else {
                // STRAIGHT MODE (Existing Logic)
                const beatTokens = tokens.filter(t => t.tickPosition >= beatStart && t.tickPosition < beatEnd);
                if (beatTokens.length === 0) continue;

                for (const token of beatTokens) {
                    const durationSuffix = this.durationManager.ticksToAbcSuffix(token.duration);
                    let tokenText = '';
                    if (token.notes.length === 0) {
                        tokenText = 'z' + durationSuffix;
                    } else if (token.notes.length === 1) {
                        tokenText = token.decorations + token.openPrefix + token.graceNote + token.notes[0] + durationSuffix;
                    } else {
                        tokenText = token.decorations + token.openPrefix + token.graceNote + '[' + token.notes.join('') + ']' + durationSuffix;
                    }
                    beats[beatIdx] += tokenText;
                }
            }
        }

        // Join beats with spaces
        const content = beats.join(' ');

        // Add bar delimiter if requested
        return addBarDelimiter ? content + ' |' : content;
    }

    /**
     * Check if the current bar needs a closing delimiter added.
     * Returns true if there's no '|' immediately after the bar content.
     */
    private needsBarDelimiter(): boolean {
        const view = this.editorViewGetter();
        if (!view || !this.currentBarContext) return false;

        const doc = view.state.doc;
        const endPos = this.currentBarContext.end;

        // Look at characters after the bar content
        const textAfter = doc.sliceString(endPos, Math.min(endPos + 10, doc.length));

        // Check if there's already a '|' (possibly with spaces before it)
        const hasBarDelimiter = /^\s*\|/.test(textAfter);

        return !hasBarDelimiter;
    }

    /**
     * Optimizes and rebuilds a bar with dynamic durations.
     * Notes fill to next note or beat boundary, rests consolidate.
     */
    private rebuildBarWithOptimizedDurations(tokens: Token[], modifiedTickIndex: number, newNotes: string[], decorations: string = '', openPrefix: string = '', graceNote: string = ''): string {
        // 1. Build optimizable grid from existing tokens
        const grid = this.buildOptimizableGrid(tokens);

        // 2. Apply the modification at the specified tick
        // Find if there's already a token at this position
        let existingIdx = grid.findIndex(t => t.tickPosition === modifiedTickIndex);

        if (existingIdx >= 0) {
            // Update existing token
            grid[existingIdx].notes = newNotes;
            grid[existingIdx].decorations = decorations;
            grid[existingIdx].openPrefix = openPrefix;
            grid[existingIdx].graceNote = graceNote;
        } else {
            // Insert new token at this position
            grid.push({
                tickPosition: modifiedTickIndex,
                notes: newNotes,
                duration: 1, // Will be recalculated by optimizer
                decorations,
                graceNote,
                openPrefix
            });
            // Sort by tick position
            grid.sort((a, b) => a.tickPosition - b.tickPosition);
        }

        // 3. Optimize durations
        const optimized = this.durationManager.optimizeBarDurations(grid);

        // 4. Serialize back to ABC
        return this.serializeOptimizedBar(optimized);
    }

    private toggleNote(tickIndex: number, char: string) {
        if (!this.currentBarContext || this.currentBar === null) return;

        // 1. Parse existing tokens and build optimizable grid
        const tokens = this.parseBarToTokens(this.currentBar);
        const grid = this.buildOptimizableGrid(tokens);

        // 2. Find if there's already a token covering this tick position
        let existingToken: OptimizableToken | null = null;
        let existingIdx = -1;

        for (let i = 0; i < grid.length; i++) {
            const t = grid[i];
            if (t.tickPosition <= tickIndex && (t.tickPosition + t.duration) > tickIndex) {
                existingToken = t;
                existingIdx = i;

                // NEW LOGIC: If interaction is within a sustained note (starts before), SPLIT IT.
                // This is critical for triplet interactions where a Quarter note might cover triplet slots.
                if (t.tickPosition < tickIndex) {
                    // Truncate the existing note to end at our new tick
                    t.duration = tickIndex - t.tickPosition;

                    // We detach from 'existingToken' because we want to treat the target slot as empty
                    // so we can insert a NEW note or toggle comfortably.
                    existingToken = null;
                    existingIdx = -1;
                }
                break;
            }
        }

        // 3. Determine the new notes array for this tick
        let newNotes: string[];
        let decorations = '';
        let openPrefix = '';
        let graceNote = '';

        if (existingToken && existingToken.notes.length > 0) {
            // There's an existing note token
            const hasChar = existingToken.notes.includes(char);

            if (hasChar) {
                // Remove the char
                newNotes = existingToken.notes.filter(n => n !== char);
                decorations = existingToken.decorations;
                openPrefix = existingToken.openPrefix;
                graceNote = existingToken.graceNote;
            } else {
                // Add the char to existing notes
                newNotes = [...existingToken.notes, char];
                decorations = existingToken.decorations;
                openPrefix = existingToken.openPrefix;
                graceNote = existingToken.graceNote;
            }
        } else {
            // No existing note at this position (or it's a rest)
            newNotes = [char];
        }

        // 4. Update the grid at this tick position
        // First, remove any existing token at exactly this tick position
        const exactMatchIdx = grid.findIndex(t => t.tickPosition === tickIndex);
        if (exactMatchIdx >= 0) {
            grid[exactMatchIdx].notes = newNotes;
            grid[exactMatchIdx].decorations = decorations;
            grid[exactMatchIdx].openPrefix = openPrefix;
            grid[exactMatchIdx].graceNote = graceNote;
        } else {
            // Insert new token
            grid.push({
                tickPosition: tickIndex,
                notes: newNotes,
                duration: 1, // Will be recalculated
                decorations,
                graceNote,
                openPrefix
            });
            grid.sort((a, b) => a.tickPosition - b.tickPosition);
        }

        // 5. Optimize durations
        const optimized = this.durationManager.optimizeBarDurations(grid);

        // --- NEW: CLAMP TRIPLETS TO DISCRETE STEPS ---
        // For triplet beats, we force tokens to be maximum 8 ticks (one triplet step).
        // This effectively turns triplet mode into a step-sequencer grid, 
        // preventing single long notes from covering multiple interaction points.
        for (const token of optimized) {
            const beatIdx = Math.floor(token.tickPosition / 24);
            if (this.beatSubdivisions[beatIdx] === 'triplet') {
                if (token.duration > 8) {
                    token.duration = 8;
                }
            }
        }

        // 5b. Serialize
        const newBar = this.serializeOptimizedBar(optimized, this.needsBarDelimiter());

        this.applyChange(newBar);
    }

    private applyChange(newBarText: string) {
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

        const processedMidis = new Set<number>();

        // 1. DATA-DRIVEN GROUP LOGIC
        // Iterate through all definitions (Hi-Hat, Snare, Toms, etc.)
        for (const def of DRUM_DEFS) {
            // Check if the BASE instrument of this group is in the hidden list
            const baseMap = hiddenMaps.find(m => m.midi === def.baseMidi);

            if (baseMap) {
                // Find any ALT instruments for this group that are ALSO hidden
                const hiddenAlts = def.alts
                    .map(a => hiddenMaps.find(m => m.midi === a.midi))
                    .filter((m): m is PercMap => !!m);

                const item = document.createElement('div');
                item.className = 'abc-drum-context-menu-item';
                item.style.padding = '6px 12px';
                item.style.cursor = 'pointer';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.fontSize = '12px';
                item.style.color = 'var(--text-normal)';

                const labelSpan = document.createElement('span');
                // Use the Group Label from config (e.g. "Hi-Hat", "Snare")
                labelSpan.innerText = def.label;
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

                    // Add Base
                    this.visibleMaps.push(baseMap);
                    this.manuallyShownMidis.add(baseMap.midi);

                    // Add all found Alts automatically
                    hiddenAlts.forEach(altMap => {
                        this.visibleMaps.push(altMap);
                        this.manuallyShownMidis.add(altMap.midi);
                    });

                    this.render();
                });

                menu.appendChild(item);

                // Mark these as processed so they don't appear in the "Singles" list below
                processedMidis.add(baseMap.midi);
                hiddenAlts.forEach(m => processedMidis.add(m.midi));
            }
        }

        // 2. REMAINING SINGLES LOGIC
        // Any instrument not caught by the group definitions above
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
                this.manuallyShownMidis.add(map.midi);
                this.render();
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        // Position adjustment
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

        const def = instrument.def;

        // Define a unified interface for our menu items
        interface MenuOption {
            label: string;
            state: NoteState;
            icon: string;
            decoration?: DrumDecoration; // Optional property for decorations
        }

        const options: MenuOption[] = [];

        // 1. Base Option
        options.push({ label: def.label, state: 'base', icon: def.baseIcon });

        // 2. Alt Option
        if (def.alts.length > 0) {
            const alt = def.alts[0];
            options.push({
                label: alt.label,
                state: 'alt',
                icon: alt.icon
            });
        }

        // 3. Decorations (Add them to the list instead of rendering immediately)
        def.decorations.forEach(dec => {
            options.push({
                label: dec.label,
                state: 'decoration',
                icon: dec.icon,
                decoration: dec // Store the reference
            });
        });

        // 4. Flam
        if (def.allowFlam) {
            options.push({ label: 'Flam', state: 'flam', icon: '♪' });
        }

        // 5. Remove
        if (currentState) {
            options.push({ label: 'Remove', state: null, icon: '−' });
        }

        // Check which specific decoration is active (for highlighting)
        let activeDecorationIcon = '';
        if (currentState === 'decoration') {
            activeDecorationIcon = this.getDecorationIconAtTick(this.currentBar, tickIndex, def);
        }

        // --- SINGLE RENDERING LOOP ---
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

            // Highlight Logic
            let isSelected = false;

            if (opt.state === null) {
                // Remove button never highlighted
                isSelected = false;
            } else if (opt.state === 'decoration') {
                // Only highlight if it matches the specific active decoration icon
                isSelected = (currentState === 'decoration' && opt.icon === activeDecorationIcon);
            } else {
                // Base, Alt, Flam
                isSelected = (opt.state === currentState);
            }

            if (isSelected) {
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
                if (!isSelected) {
                    item.style.backgroundColor = 'transparent';
                }
            });

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                // Pass the decoration if it exists
                this.toggleGroupedNote(tickIndex, instrument, opt.state, opt.decoration);
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

    // Toggle hi-hat note with specific state (closed/open/accent)
    private toggleGroupedNote(tickIndex: number, instrument: GroupedInstrument, targetState: NoteState, specificDecoration?: DrumDecoration) {
        if (!this.currentBarContext || this.currentBar === null) return;

        const stateGrid = this.parseBarToStateGrid(this.currentBar, instrument);
        const currentState = stateGrid[tickIndex];

        // Logic: If clicking same state...
        // For decorations, we also check if it's the SAME decoration.
        // If I click "Accent" and it's already "Accent", toggle off.
        // If I click "Ghost" and it's "Accent", switch to "Ghost".

        let shouldToggleOff = false;
        if (targetState === currentState) {
            if (targetState === 'decoration' && specificDecoration) {
                // Check if the current token actually HAS this specific decoration
                const currentIcon = this.getDecorationIconAtTick(this.currentBar, tickIndex, instrument.def);
                if (currentIcon === specificDecoration.icon) {
                    shouldToggleOff = true;
                }
            } else {
                shouldToggleOff = true;
            }
        }

        if (shouldToggleOff) targetState = null;


        const def = instrument.def;
        let noteStr = '';

        if (targetState === 'base') {
            noteStr = instrument.baseChar;
        }
        else if (targetState === 'alt') {
            // const altDef = def.alts[0]; // Assuming first alt;
            noteStr = instrument.altChar;

        }
        else if (targetState === 'decoration') {
            // Assuming first decoration (Accent or Ghost)
            // If you have multiple decorations, NoteState needs to store which one
            const dec = specificDecoration || def.decorations[0];
            noteStr = `${dec.abc}${instrument.baseChar}`
        }
        else if (targetState === 'flam') {
            noteStr = `{ ${instrument.baseChar}}${instrument.baseChar} `;
        }

        this.modifyGroupedNoteInBar(tickIndex, instrument, currentState, targetState, noteStr);
    }

    // Modify hi-hat note in the bar
    private modifyGroupedNoteInBar(tickIndex: number, instrument: GroupedInstrument, currentState: NoteState, targetState: NoteState, noteStr: string) {
        const def = instrument.def;

        // 1. Parse existing tokens and build optimizable grid
        const tokens = this.parseBarToTokens(this.currentBar);
        const grid = this.buildOptimizableGrid(tokens);

        // Helper to apply change
        const applyChange = (newBarText: string) => {
            const view = this.editorViewGetter();
            if (view && this.currentBarContext) {
                view.dispatch({ changes: { from: this.currentBarContext.start, to: this.currentBarContext.end, insert: newBarText } });
                const lengthDiff = newBarText.length - this.currentBar.length;
                this.currentBar = newBarText;
                this.currentBarContext.end += lengthDiff;
                this.render();
            }
        };

        // 2. Parse the noteStr to extract its components
        const noteMatch = noteStr.match(/^((?:!.*?!)*)(o)?(\{[^}]+\})?(.*)$/);
        const newDecorations = noteMatch?.[1] || '';
        const newOpenPrefix = noteMatch?.[2] || '';
        const newGrace = noteMatch?.[3] || '';
        const innerNote = noteMatch?.[4] || noteStr;

        // 3. Find or create the token at this tick position
        let existingIdx = grid.findIndex(t => t.tickPosition === tickIndex);

        // Helper to clean decorations from existing token
        const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cleanDecorations = (decs: string): string => {
            let result = decs;
            def.decorations.forEach(dec => {
                result = result.replace(new RegExp(escapeRegExp(dec.abc), 'g'), '');
            });
            return result;
        };

        if (existingIdx >= 0) {
            const existingToken = grid[existingIdx];

            if (targetState === null) {
                // Remove this instrument's notes from the token
                const remainingNotes = existingToken.notes.filter(
                    n => n !== instrument.baseChar && n !== instrument.altChar
                );

                grid[existingIdx] = {
                    ...existingToken,
                    notes: remainingNotes,
                    decorations: remainingNotes.length > 0 ? cleanDecorations(existingToken.decorations) : '',
                    graceNote: remainingNotes.length > 0 ? existingToken.graceNote : '',
                    openPrefix: remainingNotes.length > 0 ? existingToken.openPrefix : ''
                };
            } else {
                // Replace/update this instrument's note
                // First remove any existing notes for this instrument
                const filteredNotes = existingToken.notes.filter(
                    n => n !== instrument.baseChar && n !== instrument.altChar
                );

                // Add the new note
                const newNotes = [...filteredNotes, innerNote];

                // Combine decorations
                let combinedDecorations = cleanDecorations(existingToken.decorations);
                if (newDecorations && !combinedDecorations.includes(newDecorations)) {
                    combinedDecorations += newDecorations;
                }

                grid[existingIdx] = {
                    ...existingToken,
                    notes: newNotes,
                    decorations: combinedDecorations,
                    graceNote: newGrace || existingToken.graceNote,
                    openPrefix: newOpenPrefix || existingToken.openPrefix
                };
            }
        } else {
            // No token at this position - insert new one
            if (targetState !== null) {
                grid.push({
                    tickPosition: tickIndex,
                    notes: [innerNote],
                    duration: 1, // Will be recalculated
                    decorations: newDecorations,
                    graceNote: newGrace,
                    openPrefix: newOpenPrefix
                });
                grid.sort((a, b) => a.tickPosition - b.tickPosition);
            }
            // If targetState is null and there's no token, nothing to do
        }

        // 4. Optimize durations and serialize
        const optimized = this.durationManager.optimizeBarDurations(grid);
        const newBar = this.serializeOptimizedBar(optimized, this.needsBarDelimiter());

        applyChange(newBar);
    }

    private showBeatContextMenu(event: MouseEvent, beatIdx: number) {
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
        menu.style.minWidth = '140px';

        const currentMode = this.beatSubdivisions[beatIdx];

        const options = [
            { label: 'Straight (4)', mode: 'straight' },
            { label: 'Triplet (3)', mode: 'triplet' }
        ];

        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'abc-drum-context-menu-item';
            item.style.padding = '6px 12px';
            item.style.cursor = 'pointer';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.fontSize = '12px';
            item.style.color = 'var(--text-normal)';

            // Checkmark
            const check = document.createElement('span');
            check.style.width = '16px';
            check.innerText = (opt.mode === currentMode) ? '✓' : '';
            check.style.marginRight = '8px';
            check.style.fontWeight = 'bold';
            item.appendChild(check);

            const lbl = document.createElement('span');
            lbl.innerText = opt.label;
            item.appendChild(lbl);

            item.addEventListener('mouseenter', () => item.style.backgroundColor = 'var(--background-modifier-hover)');
            item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeContextMenu();
                if (this.beatSubdivisions[beatIdx] !== opt.mode) {
                    this.toggleBeatSubdivision(beatIdx); // Logic handles clearing notes
                }
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;
    }
}



## drum_grid/drum_definitions.ts
ts
export interface DrumDecoration {
    label: string;      // "Accent", "Ghost"
    abc: string;        // "!>!", "!g!"
    icon: string;       // ">", "(•)"
}

export interface DrumAlt {
    midi: number;       // 46 (Open HH), 37 (Side Stick)
    icon: string;       // "○", "x"
    abcPrefix?: string; // "o" (Specific for HiHat Open)
    label: string;      // Name for the menu
}

export interface DrumGroupDefinition {
    id: string;         // 'hihat', 'snare'
    label: string;      // Display Name
    baseMidi: number;   // The main note (42, 38)
    baseIcon: string;   // "✕", "●"

    // Question 3: Alts as a list (currently we support 1 active alt in the UI logic, but config allows listing)
    alts: DrumAlt[];

    // Question 4: Decorations
    decorations: DrumDecoration[];

    // Question 5: Flam support
    allowFlam: boolean;
}

// THE CONFIGURATION
export const DRUM_DEFS: DrumGroupDefinition[] = [
    {
        id: 'hihat',
        label: 'Hi-Hat',
        baseMidi: 42, // Closed
        baseIcon: '✕',
        alts: [
            { midi: 46, icon: '○', abcPrefix: 'o', label: 'Open' } // Open
        ],
        decorations: [
            { label: 'Accent', abc: '!>!', icon: '>' }
        ],
        allowFlam: false
    },
    {
        id: 'snare',
        label: 'Snare',
        baseMidi: 38, // Snare
        baseIcon: '●',
        alts: [
            { midi: 37, icon: 'x', label: 'Side Stick' } // Side Stick
        ],
        decorations: [
            { label: 'Ghost', abc: '!g!', icon: '(•)' },
            { label: 'Accent', abc: '!>!', icon: '>' }
        ],
        allowFlam: true
    },
    {
        id: 'Hi-Mid Tom',
        label: 'Hi-Mid Tom',
        baseMidi: 48, // Hi-Mid Tom
        baseIcon: '●',
        alts: [],
        decorations: [
            { label: 'Ghost', abc: '!g!', icon: '(•)' },
            { label: 'Accent', abc: '!>!', icon: '>' }
        ],
        allowFlam: true
    },
];


## drum_grid/drum_duration_manager.ts
ts

import { OptimizableToken } from './drum_types';

export class DurationManager {
    public readonly ticksPerBar = 96; // 24 ticks per beat * 4 beats
    public readonly ticksPerBeat = 24;
    private ticksPerL: number = 12; // Default for L:1/8 (96/8 = 12 ticks)

    updateHeaderConfig(content: string) {
        const match = content.match(/^L:\s*(1\/\d+|1)/m);
        const lValue = match ? match[1] : "1/8";

        // We want base resolution to be 96 ticks per bar (4/4)
        // L:1/1 = 96 ticks
        // L:1/4 = 24 ticks
        // L:1/8 = 12 ticks
        // L:1/16 = 6 ticks
        // L:1/32 = 3 ticks

        if (lValue === "1") {
            this.ticksPerL = 96;
        } else {
            const parts = lValue.split('/');
            const den = parseInt(parts[1]) || 1;
            this.ticksPerL = 96 / den;
        }
    }

    abcDurationToTicks(abcDurationStr: string): number {
        if (!abcDurationStr) return this.ticksPerL;
        if (abcDurationStr === "/") return this.ticksPerL / 2;

        if (abcDurationStr.includes("/")) {
            const [n, d] = abcDurationStr.split("/").map(x => x === "" ? undefined : parseInt(x));
            return ((n ?? 1) / (d ?? 2)) * this.ticksPerL;
        }
        return parseInt(abcDurationStr) * this.ticksPerL;
    }

    // Converts grid ticks to ABC string suffix
    // ticks is absolute number of ticks (e.g. 12 for 1/8 note)
    ticksToAbcSuffix(ticks: number): string {
        const ratio = ticks / this.ticksPerL;

        if (ratio === 1) return "";
        if (ratio === 0.5) return "/2";
        if (ratio === 0.25) return "/4";
        if (ratio === 2) return "2";

        // Fraction handling
        return this.toFraction(ratio);
    }

    private toFraction(amount: number): string {
        if (amount === 0.75) return "3/4";
        if (amount === 1.5) return "3/2"; // dotted
        const tolerance = 0.0001;
        // Check common denominators
        for (const den of [2, 3, 4, 6, 8, 12, 16, 24, 32]) {
            const num = Math.round(amount * den);
            if (Math.abs(num / den - amount) < tolerance) {
                if (num === den) return "";
                return `${num}/${den}`;
            }
        }
        return amount.toString();
    }

    /**
     * Optimizes bar durations by:
     * 1. Notes fill to the next note or beat boundary
     * 2. Consecutive rests are merged
     */
    optimizeBarDurations(tokens: OptimizableToken[]): OptimizableToken[] {
        // Build a sparse map of 96 slots
        const slotMap: Map<number, OptimizableToken> = new Map();

        for (const token of tokens) {
            if (token.notes.length > 0) {
                slotMap.set(token.tickPosition, token);
            }
        }

        const optimized: OptimizableToken[] = [];

        // Process each beat (4 beats, 24 ticks each)
        for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
            const beatStart = beatIdx * 24;
            const beatEnd = beatStart + 24;

            let currentTick = beatStart;

            // Sub-loop within the beat
            while (currentTick < beatEnd) {
                // Find next note in this beat
                let nextNoteTick = beatEnd;
                for (let t = currentTick + 1; t < beatEnd; t++) {
                    if (slotMap.has(t)) {
                        nextNoteTick = t;
                        break;
                    }
                }

                if (slotMap.has(currentTick)) {
                    // There is a note at currentTick
                    const token = slotMap.get(currentTick)!;

                    // Duration is distance to next note or beat end
                    const duration = nextNoteTick - currentTick;

                    optimized.push({
                        ...token,
                        tickPosition: currentTick,
                        duration: duration
                    });
                    currentTick = nextNoteTick;
                } else {
                    // Start of a rest period
                    const duration = nextNoteTick - currentTick;
                    optimized.push({
                        tickPosition: currentTick,
                        notes: [], // Rest
                        duration: duration,
                        decorations: '',
                        graceNote: '',
                        openPrefix: ''
                    });
                    currentTick = nextNoteTick;
                }
            }
        }
        return optimized;
    }
}


## drum_grid/drum_grid_parser.ts
ts

import { DurationManager } from './drum_duration_manager';
import { DrumGroupDefinition } from './drum_definitions';
import { Token, NoteState, GroupedInstrument } from './drum_types';

export class DrumGridParser {
    constructor(private durationManager: DurationManager) { }

    // Clean bar content from annotations, decorations, etc.
    cleanBarContent(barContent: string): string {
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
    extractNotesFromBar(barContent: string): Set<string> {
        const cleanBar = this.cleanBarContent(barContent);
        const notes = new Set<string>();

        const chordRegex = /\[([^\]]*)\]/g;
        let remaining = cleanBar;

        const notePattern = /([\^=_]*[A-Ga-g][,']*)/g;

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

    parseBarToTokens(barText: string): Token[] {
        const tokens: Token[] = [];
        // Extract Tuplet Tokens: (p followed by optional :q and :r
        // Also standard tokens
        // Regex needs to split keeping the delimiters or just match all tokens sequentially

        // This regex matches:
        // 1. Tuplets: (\d+(?::\d+(?::\d+)?)?)
        // 2. Notes/Rests/Decorations: ... existing structure ...
        const mainRegex = /(\(\d+(?::\d+(?::\d+)?)?)|((?:!.*?!)*(?:\{[^}]+\})?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

        let match;

        // Tuplet Parsing State
        let tupletRemaining = 0; // r notes remaining
        let tupletFactor = 1;    // q / p

        while ((match = mainRegex.exec(barText)) !== null) {
            const fullMatch = match[0];
            const tupletStr = match[1]; // e.g. (3 or (3:2:3
            const coreContent = match[2];
            const durationStr = match[3]; // only for notes

            // CASE 1: Tuplet Definition found
            if (tupletStr) {
                // Parse (p:q:r
                // Remove '('
                const parts = tupletStr.substring(1).split(':');
                const p = parseInt(parts[0]);
                let q = p === 3 ? 2 : p; // Default q? Standard says: if q not given, it depends on time signature... 
                // A simpler default for now: (3 -> p=3, q=2, r=3.
                // Standard: if q absent, q=2 if p in [3,6,9], else q=some_other. Let's assume (3 always means 2 time units.

                if (parts.length > 1 && parts[1]) q = parseInt(parts[1]);
                let r = p;
                if (parts.length > 2 && parts[2]) r = parseInt(parts[2]);

                tupletRemaining = r;
                tupletFactor = q / p;

                // Do NOT add this as a token to be rendered, but we might want to preserve it?
                // For now, this parser produces TOKENS for the GRID. 
                // The grid generation uses duration. 
                // We should probably NOT output a token for the "(3" text itself if the consumer expects only notes.
                // BUT `parseBarToTokens` is also used for re-serialization?
                // If we don't return it, we lose it when regenerating text?
                // Currently serialization relies on `serializeOptimizedBar` which RE-GENERATES the string from the grid.
                // So we don't need to preserve the source token `(3` if our serializer can reconstruct it.
                // WE DO need to handle it for correct START/END positions if we were doing mapping.

                // Let's Skip adding a token for (3, but effect the state.
                continue;
            }

            // CASE 2: Note/Rest found
            if (coreContent) {
                const start = match.index;
                const end = start + fullMatch.length;

                let durationTicks = 0;
                let notes: string[] = [];

                if (coreContent.startsWith('"')) {
                    durationTicks = 0;
                } else {
                    let rawTicks = this.durationManager.abcDurationToTicks(durationStr);

                    // APPLY TUPLET FACTOR
                    if (tupletRemaining > 0) {
                        // Apply scaling
                        // For (3, factor is 2/3. 
                        // If rawTicks is 12 (1/8 note), result 8.
                        durationTicks = rawTicks * tupletFactor;
                        tupletRemaining--;
                    } else {
                        durationTicks = rawTicks;
                    }
                }

                if (!coreContent.toLowerCase().startsWith('z') && !coreContent.toLowerCase().startsWith('x') && !coreContent.startsWith('"')) {
                    let cleanContent = coreContent.replace(/!.*?!/g, '');
                    let inner = cleanContent.replace(/[\[\]]/g, "");
                    inner = inner.replace(/\{[^}]+\}/g, ""); // strip grace notes

                    const notePattern = /([\^=_]?[A-Ga-g][,']*)/g;
                    let noteMatch;
                    while ((noteMatch = notePattern.exec(inner)) !== null) {
                        if (noteMatch[1]) {
                            notes.push(noteMatch[1]);
                        }
                    }
                }

                tokens.push({ text: fullMatch, start, end, notes, duration: durationTicks });
            }
        }
        return tokens;
    }

    // Convert current bar string into grid time slots using tokens
    parseBarToGrid(barText: string): string[][] {
        const tokens = this.parseBarToTokens(barText);
        const grid: string[][] = Array(this.durationManager.ticksPerBar).fill(null).map((): string[] => []);

        let currentTick = 0;
        for (const token of tokens) {
            const tickIdx = Math.round(currentTick);

            if (tickIdx >= this.durationManager.ticksPerBar) break;

            if (token.notes.length > 0) {
                for (const note of token.notes) {
                    grid[tickIdx].push(note);
                }
            }
            currentTick += token.duration;
        }
        return grid;
    }

    // Generic parser for grouped instruments
    // Returns: { char: string, state: HiHatState }[][] for ticksPerBar
    parseBarToStateGrid(barText: string, instrument: GroupedInstrument): NoteState[] {
        const grid: NoteState[] = Array(this.durationManager.ticksPerBar).fill(null);
        const tokens = this.parseBarToTokens(barText);

        const def = instrument.def;
        const altPrefix = def.alts[0]?.abcPrefix || null;

        let currentTick = 0;
        for (const token of tokens) {
            const tickIdx = Math.round(currentTick);
            if (tickIdx >= this.durationManager.ticksPerBar) break;

            const hasBaseChar = token.notes.includes(instrument.baseChar);
            const hasAltChar = token.notes.includes(instrument.altChar);
            const hasAltPrefix = altPrefix ? token.text.includes(altPrefix) : false;

            if (hasBaseChar || hasAltChar || (hasAltPrefix && hasBaseChar)) {
                const isFlam = /\{[^}]+\}/.test(token.text);
                const activeDecoration = def.decorations.find(d => token.text.includes(d.abc));

                if (def.allowFlam && isFlam) {
                    grid[tickIdx] = 'flam';
                } else if (activeDecoration) {
                    grid[tickIdx] = 'decoration';
                } else if (hasAltPrefix || hasAltChar) {
                    grid[tickIdx] = 'alt';
                } else {
                    grid[tickIdx] = 'base';
                }
            }
            currentTick += token.duration;
        }

        return grid;
    }

    getDecorationIconAtTick(barText: string, tickIndex: number, def: DrumGroupDefinition): string {
        const tokens = this.parseBarToTokens(barText);
        let currentTick = 0;

        for (const token of tokens) {
            const durationTicks = token.duration; // Already scaled by tuplet logic

            // Allow sloppy matching: if the token COVERS this tick index
            // But wait, the grid logic often aligns exactly start?
            // "getDecorationIconAtTick" usually looks for the decoration active on the note STARTING at tickIndex.

            // Check if token STARTS at or BEFORE, and ends AFTER?
            // Usually we want the note at this exact tick grid position.
            // Let's match if the token *contains* the tick or starts there.
            // Actually, based on previous implementation:
            // if (currentTick <= tickIndex && (currentTick + ticks) > tickIndex)

            if (Math.round(currentTick) <= tickIndex && (Math.round(currentTick + durationTicks)) > tickIndex) {
                // Check this token for decorations
                const matched = def.decorations.find(d => token.text.includes(d.abc));
                if (matched) return matched.icon;
            }

            currentTick += durationTicks;
        }
        return '?';
    }
}



## drum_grid/drum_types.ts
ts

import { DrumGroupDefinition } from './drum_definitions';

export interface PercMap {
    label: string;
    char: string;
    midi: number;
}

export type NoteState = 'base' | 'alt' | 'decoration' | 'flam' | null;

export interface GroupedInstrument {
    type: 'grouped';
    def: DrumGroupDefinition;
    label: string;
    baseChar: string;
    altChar: string;
}

export interface SingleInstrument {
    type: 'single';
    label: string;
    char: string;
    midi: number;
}

export type InstrumentRow = GroupedInstrument | SingleInstrument;

export interface Token {
    text: string;
    start: number;
    end: number;
    notes: string[];
    duration: number; // In ticks
    rawText?: string;
}

export interface OptimizableToken {
    tickPosition: number;
    notes: string[];
    duration: number;
    decorations: string;
    graceNote: string;
    openPrefix: string;
}



