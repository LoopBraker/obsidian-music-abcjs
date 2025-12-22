// Token structure used for duration optimization (matches drum_grid.ts)
interface OptimizableToken {
    tickPosition: number;
    notes: string[];
    duration: number;
    decorations: string;
    graceNote: string;
    openPrefix: string;
}

export class DurationManager {
    private ticksPerL: number = 2; // Default for L:1/8

    updateHeaderConfig(content: string) {
        const match = content.match(/^L:\s*(1\/\d+|1)/m);
        const lValue = match ? match[1] : "1/8";

        if (lValue === "1") {
            this.ticksPerL = 16;
        } else {
            const parts = lValue.split('/');
            const den = parseInt(parts[1]) || 1;
            this.ticksPerL = 16 / den;
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

    // Converts grid ticks (1, 2, 4 etc) to ABC string suffix
    ticksToAbcSuffix(ticks: number): string {
        const ratio = ticks / this.ticksPerL;
        if (ratio === 1) return "";
        if (ratio === 0.5) return "/2"; // Standardized
        if (ratio === 0.25) return "/4";
        if (ratio === 0.125) return "/8";
        if (Number.isInteger(ratio)) return ratio.toString();

        // Handle cases like 3 ticks in L:1/4 -> 0.75 -> 3/4
        return this.toFraction(ratio);
    }

    private toFraction(amount: number): string {
        if (amount === 0.75) return "3/4";
        if (amount === 1.5) return "3/2";
        // General fraction handling for other cases
        const tolerance = 0.0001;
        for (const den of [2, 4, 8, 16]) {
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
     * 2. Consecutive rests are merged into single rest tokens
     * 3. Empty beats become single beat-length rests
     * 
     * @param tokens Array of tokens with tick positions (0-15 for 16th note grid)
     * @returns Optimized array of tokens with recalculated durations
     */
    optimizeBarDurations(tokens: OptimizableToken[]): OptimizableToken[] {
        // Build a sparse 16-slot map: which slots have notes?
        const slotMap: Map<number, OptimizableToken> = new Map();

        for (const token of tokens) {
            if (token.notes.length > 0) {
                // It's a note (not a rest)
                slotMap.set(token.tickPosition, token);
            }
        }

        const optimized: OptimizableToken[] = [];

        // Process each beat (4 beats, 4 ticks each)
        for (let beatIdx = 0; beatIdx < 4; beatIdx++) {
            const beatStart = beatIdx * 4;
            const beatEnd = beatStart + 4;

            // Find all notes in this beat
            const notesInBeat: { pos: number; token: OptimizableToken }[] = [];
            for (let tick = beatStart; tick < beatEnd; tick++) {
                if (slotMap.has(tick)) {
                    notesInBeat.push({ pos: tick, token: slotMap.get(tick)! });
                }
            }

            if (notesInBeat.length === 0) {
                // Empty beat - single rest for the whole beat
                optimized.push({
                    tickPosition: beatStart,
                    notes: [],
                    duration: 4, // Whole beat
                    decorations: '',
                    graceNote: '',
                    openPrefix: ''
                });
            } else {
                // Sort notes by position
                notesInBeat.sort((a, b) => a.pos - b.pos);

                // Add rest before first note if needed
                const firstNotePos = notesInBeat[0].pos;
                if (firstNotePos > beatStart) {
                    optimized.push({
                        tickPosition: beatStart,
                        notes: [],
                        duration: firstNotePos - beatStart,
                        decorations: '',
                        graceNote: '',
                        openPrefix: ''
                    });
                }

                // Add notes with calculated durations
                for (let i = 0; i < notesInBeat.length; i++) {
                    const { pos, token } = notesInBeat[i];
                    const nextPos = (i + 1 < notesInBeat.length)
                        ? notesInBeat[i + 1].pos
                        : beatEnd;

                    optimized.push({
                        ...token,
                        tickPosition: pos,
                        duration: nextPos - pos
                    });
                }
            }
        }

        return optimized;
    }
}