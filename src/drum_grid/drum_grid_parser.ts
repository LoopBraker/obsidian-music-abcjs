
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
