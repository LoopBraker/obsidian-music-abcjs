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
        return amount.toString();
    }
}