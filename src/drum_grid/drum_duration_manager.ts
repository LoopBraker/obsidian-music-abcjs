
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
    //Modification start here
    optimizeBarDurations(
        tokens: OptimizableToken[],
        beatSubdivisions: ('straight' | 'triplet')[]
    ): OptimizableToken[] {
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
            const mode = beatSubdivisions[beatIdx];

            let currentTick = beatStart;

            while (currentTick < beatEnd) {
                // Determine the next logical boundary
                let nextBoundary: number;

                if (mode === 'triplet') {
                    // For triplets, every step is a hard boundary (8 ticks)
                    nextBoundary = currentTick + 8;
                } else {
                    // For straight, find next note or end of beat
                    nextBoundary = beatEnd;
                    for (let t = currentTick + 1; t < beatEnd; t++) {
                        if (slotMap.has(t)) {
                            nextBoundary = t;
                            break;
                        }
                    }
                }

                const duration = nextBoundary - currentTick;

                if (slotMap.has(currentTick)) {
                    const token = slotMap.get(currentTick)!;
                    optimized.push({
                        ...token,
                        tickPosition: currentTick,
                        duration: duration
                    });
                } else {
                    // Rest
                    optimized.push({
                        tickPosition: currentTick,
                        notes: [],
                        duration: duration,
                        decorations: '',
                        graceNote: '',
                        openPrefix: ''
                    });
                }
                currentTick = nextBoundary;
            }
        }
        return optimized;
    }
}