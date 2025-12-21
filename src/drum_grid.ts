import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { DRUM_DEFS, DrumGroupDefinition, DrumDecoration } from './drum_grid/drum_definitions';

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
    def: DrumGroupDefinition; // Reference to the config

    label: string;

    // Resolved actual characters from user's ABC
    baseChar: string;
    altChar: string;
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
    private maxVisible = 3;
    private currentBar: string = "";
    private currentBarContext: { start: number, end: number } | null = null;
    private timeSignatureOpt = 16; // Granularity (16th notes)
    private contextMenu: HTMLElement | null = null;
    private manuallyShownMidis: Set<number> = new Set();
    private isLocked: boolean = false; //
    private fullContent: string = "";  // <--- Store full content for global scanning

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
        this.fullContent = content;
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
    // Returns: { char: string, state: HiHatState }[][] for 16 ticks
    private parseBarToStateGrid(barText: string, instrument: GroupedInstrument): NoteState[] {
        const grid: NoteState[] = Array(16).fill(null);
        const tokenRegex = /((?:!.*?!)*(?:o)?(?:\{[^}]+\})?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;

        const def = instrument.def;
        // Pre-calculate what to look for
        const decAbc = def.decorations[0]?.abc || 'NOT_FOUND';
        const altDef = def.alts[0];
        const altPrefix = altDef?.abcPrefix || null;

        let currentTick = 0;
        let match;

        while ((match = tokenRegex.exec(barText)) !== null) {
            if (currentTick >= 16) break;
            const fullText = match[0];
            const coreContent = match[1];
            const durationStr = match[2];

            // ... (Duration parsing logic ...
            let duration = 1;
            if (durationStr === '/') duration = 0.5;
            else if (durationStr && !durationStr.includes('/')) duration = parseInt(durationStr);
            if (coreContent.startsWith('"')) duration = 0;
            const ticks = (duration === 0 && coreContent.startsWith('"')) ? 0 : (Math.round(duration) || 1);

            const tickIdx = Math.floor(currentTick);

            // 1. Detect Flam
            const isFlam = /\{[^}]+\}/.test(coreContent);

            // 2. Detect Decoration (Generic check against config)
            const activeDecoration = def.decorations.find(d => coreContent.includes(d.abc));
            const isDecorated = !!activeDecoration;

            // 3. Detect Alt Prefix (e.g., 'o')
            const hasAltPrefix = altPrefix ? new RegExp(`^((?:!.*?!)*)${altPrefix}`).test(coreContent) : false;

            // Clean content to check inner chars
            // Remove decorations, 'o', AND grace notes to find the main note
            let innerContent = coreContent.replace(/^((?:!.*?!)*)(?:\{[^}]+\})?/, '');

            if (innerContent.startsWith('[')) innerContent = innerContent.slice(1, -1);

            const hasBaseChar = innerContent.includes(instrument.baseChar);
            const hasAltChar = innerContent.includes(instrument.altChar);

            if (hasBaseChar || hasAltChar) {
                if (def.allowFlam && isFlam) {
                    grid[tickIdx] = 'flam';
                } else if (isDecorated) {
                    grid[tickIdx] = 'decoration';
                } else if (hasAltPrefix || hasAltChar) {
                    // Logic tweak: use config to decide if prefix matters
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

    private getDecorationIconAtTick(barText: string, tickIndex: number, def: DrumGroupDefinition): string {
        // Quick tokenizer to find the token at this tick
        const tokenRegex = /((?:!.*?!)*(?:\{[^}]+\})?(?:\[[^\]]+\]|[\^=_]*[A-Ga-g][,']*)|z|Z|x|X|"[^"]*")([\d\/]*)/g;
        let currentTick = 0;
        let match;

        while ((match = tokenRegex.exec(barText)) !== null) {
            const coreContent = match[1];
            // Duration logic
            let duration = 1;
            const durationStr = match[2];
            if (durationStr === '/') duration = 0.5;
            else if (durationStr && !durationStr.includes('/')) duration = parseInt(durationStr);
            if (coreContent.startsWith('"')) duration = 0;
            const ticks = (duration === 0 && coreContent.startsWith('"')) ? 0 : (Math.round(duration) || 1);

            if (currentTick <= tickIndex && (currentTick + ticks) > tickIndex) {
                // Found the token. Find which decoration matches.
                const matched = def.decorations.find(d => coreContent.includes(d.abc));
                return matched ? matched.icon : '?';
            }
            currentTick += ticks;
        }
        return '?';
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
        // headerRow.style.marginLeft = `${labelWidth + 10}px`;
        headerRow.style.gap = `${beatGroupGap}px`;

        // 1. CREATE SLIDING TOGGLE SWITCH
        const lockContainer = headerRow.createDiv({ cls: 'abc-drum-lock-container' });
        lockContainer.style.width = `${labelWidth}px`;
        lockContainer.style.marginRight = '10px';
        lockContainer.style.display = 'flex';
        lockContainer.style.justifyContent = 'center'; // Center the toggle in the column
        lockContainer.style.alignItems = 'center';

        // -- Toggle Track (The pill shape) --
        const toggleTrack = lockContainer.createDiv({ cls: 'abc-drum-toggle-track' });
        toggleTrack.style.position = 'relative';
        toggleTrack.style.width = '50px';
        toggleTrack.style.height = '22px';
        toggleTrack.style.borderRadius = '11px'; // Pill shape
        toggleTrack.style.cursor = 'pointer';
        toggleTrack.style.transition = 'all 0.2s ease';
        toggleTrack.style.display = 'flex';
        toggleTrack.style.alignItems = 'center';
        toggleTrack.style.justifyContent = 'space-between';
        toggleTrack.style.padding = '0 6px';
        toggleTrack.style.boxSizing = 'border-box';

        // -- Dynamic Styles based on State --
        if (this.isLocked) {
            // Locked State (Purple/Accent)
            toggleTrack.style.backgroundColor = 'transparent';
            toggleTrack.style.border = '2px solid var(--text-accent)';
        } else {
            // Unlocked State (Grey/Faint)
            toggleTrack.style.backgroundColor = 'transparent';
            toggleTrack.style.border = '2px solid var(--background-modifier-border)';
        }

        // -- Closed Lock Icon (Visible on Left when Locked) --
        const iconLocked = toggleTrack.createDiv();
        iconLocked.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
        iconLocked.style.color = this.isLocked ? 'var(--text-accent)' : 'transparent';
        iconLocked.style.display = 'flex';
        iconLocked.style.opacity = this.isLocked ? '1' : '0';
        iconLocked.style.transition = 'opacity 0.2s ease';

        // -- Open Lock Icon (Visible on Right when Unlocked) --
        const iconUnlocked = toggleTrack.createDiv();
        iconUnlocked.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;
        iconUnlocked.style.color = 'var(--text-muted)';
        iconUnlocked.style.display = 'flex';
        iconUnlocked.style.opacity = this.isLocked ? '0' : '1';
        iconUnlocked.style.transition = 'opacity 0.2s ease';

        // -- The Knob (The moving square/circle) --
        const knob = toggleTrack.createDiv({ cls: 'abc-drum-toggle-knob' });
        knob.style.position = 'absolute';
        knob.style.top = '2px';
        knob.style.width = '14px';
        knob.style.height = '14px';
        knob.style.borderRadius = '50%'; // Rounded square like image
        knob.style.transition = 'all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1)';
        knob.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';

        // Knob Position & Color Logic
        if (this.isLocked) {
            knob.style.left = '30px'; // Move Right
            knob.style.backgroundColor = 'var(--text-accent)';
        } else {
            knob.style.left = '3px'; // Move Left
            knob.style.backgroundColor = 'var(--text-muted)';
            knob.style.opacity = '0.5';
        }

        // -- Click Event --
        toggleTrack.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isLocked = !this.isLocked;
            this.updateVisibleInstruments(); // Recalculate visibility
            this.render(); // Re-render to animate
        });

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

                            // GENERIC VISUALS FROM CONFIG
                            const def = instrumentRow.def;

                            if (state === 'alt') {
                                indicator.innerText = def.alts[0].icon; // e.g., '○' or 'x'
                                if (def.alts[0].icon === 'x') indicator.style.fontSize = '12px';
                            }
                            else if (state === 'decoration') {
                                // FIX: We know it's a decoration, but which one?
                                // We need to check the grid source or helper. 
                                // Since parseBarToStateGrid only returned the enum, we do a quick check on the BAR text logic or 
                                // simpler: we check which decoration matches the currently applied note in the text?
                                // Actually, simpler: The parseBarToStateGrid logic determined it was a decoration.
                                // But here we don't have the token text easily. 

                                // OPTIMIZATION: To avoid re-parsing, let's look at the parsedNotes (which has the chars). 
                                // But parsedNotes doesn't have decorations.

                                // Reliable fallback: Re-extract decoration from the bar for this specific tick.
                                // Or, simpler: We accept that render might need to peek at the bar again, 
                                // but simpler is to update parseBarToStateGrid to return the OBJECT, not just string?
                                // No, let's keep it consistent.

                                // Let's use a helper method to find the icon:
                                const icon = this.getDecorationIconAtTick(this.currentBar, globalStep, def);
                                indicator.innerText = icon;
                                if (icon.length > 1) indicator.style.fontSize = '8px';
                            }
                            else if (state === 'flam') {
                                indicator.innerText = '♪';
                                indicator.style.fontSize = '10px';
                                indicator.style.marginLeft = '-2px';
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
                let inner = cleanContent;
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
        const prefixMatch = coreText.match(/^((?:!.*?!)*)(.*)$/);
        const decorations = prefixMatch?.[1] || '';
        const afterPrefix = prefixMatch?.[2] || coreText;

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

                    if (decorations) {
                        // Decorations can apply to any note
                        newTokenText = `${decorations}${remainingNote}${durationPart}`;
                    } else {
                        newTokenText = remainingNote + durationPart;
                    }
                } else {
                    // Still a chord - keep prefixes outside
                    newTokenText = `${decorations}[${remainingNotes.join('')}]${durationPart}`;
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
            noteStr = `{${instrument.baseChar}}${instrument.baseChar}`;
        }

        this.modifyGroupedNoteInBar(tickIndex, instrument, currentState, targetState, noteStr);
    }

    // Modify hi-hat note in the bar
    private modifyGroupedNoteInBar(tickIndex: number, instrument: GroupedInstrument, currentState: NoteState, targetState: NoteState, noteStr: string) {

        const def = instrument.def;

        // 1. Parse tokens 
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

        // 2. Find token at tick
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

        // 3. Handle Append Mode
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

        const durMatch = token.text.match(/([\d\/]+)$/);
        const durationPart = durMatch ? durMatch[1] : '';

        // Helper
        const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (targetState === null) {
            // == DELETION CASE ==

            if (token.text.includes('[')) {
                // Parse existing prefix and content
                const prefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(\[.*)/);
                let decorations = prefixMatch?.[1] || '';
                const chordPart = prefixMatch?.[4] || token.text;

                // FIX: Loop through ALL definitions and remove ANY that exist
                def.decorations.forEach(dec => {
                    decorations = decorations.replace(new RegExp(escapeRegExp(dec.abc), 'g'), '');
                });

                const chordInner = prefixMatch?.[4].match(/\[([^\]]+)\]/)?.[1] || '';
                const notes = chordInner.match(/[\^=_]*[A-Ga-g][,']*/g) || [];

                // Filter out base/alt notes
                const remaining = notes.filter(n =>
                    !n.includes(instrument.baseChar) && !n.includes(instrument.altChar)
                );

                if (remaining.length === 0) {
                    newTokenText = 'z' + durationPart;
                } else if (remaining.length === 1) {
                    newTokenText = `${decorations}${remaining[0]}${durationPart}`;
                } else {
                    newTokenText = `${decorations}[${remaining.join('')}]${durationPart}`;
                }
            } else {
                newTokenText = 'z' + durationPart;
            }
        } else {
            // == ADD / CHANGE CASE ==

            // Extract modifiers from the REQUESTED noteStr
            const noteMatch = noteStr.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(.*)$/);

            const newDecorations = noteMatch?.[1] || '';
            const newOpenPrefix = noteMatch?.[2] || '';
            const newGrace = noteMatch?.[3] || '';
            const innerNote = noteMatch?.[4] || noteStr;

            if (token.text.includes('[')) {
                // -- CHORD LOGIC --

                const existingPrefixMatch = token.text.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(\[.*)/);
                let existingDecorations = existingPrefixMatch?.[1] || '';
                const chordPart = existingPrefixMatch?.[4] || token.text;
                const chordInner = chordPart.match(/\[([^\]]+)\]/)?.[1] || '';

                const notes = chordInner.match(/[\^=_]*[A-Ga-g][,']*/g) || [];

                // Filter out OLD instrument notes
                const filtered = notes.filter(n =>
                    !n.includes(instrument.baseChar) && !n.includes(instrument.altChar)
                );

                // Add NEW note
                const newInner = filtered.join('') + innerNote;

                // Cleanup decorations
                def.decorations.forEach(dec => {
                    existingDecorations = existingDecorations.replace(new RegExp(escapeRegExp(dec.abc), 'g'), '');
                });

                let combinedDecorations = existingDecorations;
                if (newDecorations && !combinedDecorations.includes(newDecorations)) {
                    combinedDecorations += newDecorations;
                }

                const combinedOpen = newOpenPrefix || '';
                const combinedGrace = newGrace || '';

                newTokenText = `${combinedDecorations}${combinedOpen}${combinedGrace}[${newInner}]${durationPart}`;

            } else if (token.text.match(/^z/i)) {
                // -- REST LOGIC --
                newTokenText = noteStr + durationPart;

            } else {
                // -- SINGLE NOTE LOGIC --

                const existingMatch = token.text.match(/^((?:!.*?!)*)(o)?(?:(\{.*?\})?)?(.*)$/);
                const existingDecorations = existingMatch?.[1] || '';
                const coreToken = existingMatch?.[4] || token.text;
                const coreTokenNoDir = coreToken.replace(/[\d\/]+$/, '');

                const isThisInstrument = coreTokenNoDir.includes(instrument.baseChar) ||
                    coreTokenNoDir.includes(instrument.altChar);

                if (isThisInstrument) {
                    // REPLACE: It's currently a snare/hihat, and we are changing its state
                    newTokenText = noteStr + durationPart;

                    if (existingDecorations && !noteStr.startsWith(existingDecorations)) {
                        // FIX: Strip ALL specific decorations from the old string so we don't double up
                        let cleanExisting = existingDecorations;
                        def.decorations.forEach(dec => {
                            cleanExisting = cleanExisting.replace(new RegExp(escapeRegExp(dec.abc), 'g'), '');
                        });

                        // If noteStr has decorations (e.g. !>!), prepend the clean existing ones
                        if (noteStr.match(/^!.*?!/)) {
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
                    const combinedGrace = newGrace || existingMatch?.[3] || '';

                    newTokenText = `${combinedDecorations}${combinedOpen}${combinedGrace}[${innerNote}${coreTokenNoDir}]${durationPart}`;
                }
            }
        }

        // 5. Rebuild bar
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
