import { EditorView } from '@codemirror/view';

export class BarVisualizer {
    public container: HTMLElement;
    private barContainer: HTMLElement;
    private timeSignature: { num: number, den: number } = { num: 4, den: 4 };
    private unitNoteLength: number = 1 / 8; // Default L: 1/8

    constructor(parent: HTMLElement) {
        this.container = parent.createDiv({ cls: 'abc-bar-visualizer-container' });
        this.container.style.marginBottom = '0.3em';
        this.container.style.marginTop = '10px';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.gap = '0.3em';

        const header = this.container.createDiv({ cls: 'abc-bar-info' });
        header.style.fontSize = '0.6em';
        header.style.color = 'var(--text-muted)';
        header.style.fontFamily = 'sans-serif';

        this.barContainer = this.container.createDiv({ cls: 'abc-bar-visuals' });
        this.barContainer.style.display = 'flex';
        this.barContainer.style.gap = '2px';
        this.barContainer.style.height = '0.8em';
        this.barContainer.style.width = '100%';
    }

    update(content: string, cursor: number) {
        this.parseHeader(content);
        const currentBar = this.getCurrentBar(content, cursor);
        this.render(currentBar);
    }

    private parseHeader(content: string) {
        const mMatch = content.match(/^M:\s*(\d+)\/(\d+)/m);
        if (mMatch) {
            this.timeSignature = { num: parseInt(mMatch[1]), den: parseInt(mMatch[2]) };
        } else {
            const mSymbolMatch = content.match(/^M:\s*([C|])/m);
            if (mSymbolMatch) {
                this.timeSignature = mSymbolMatch[1] === 'C' ? { num: 4, den: 4 } : { num: 2, den: 2 };
            }
        }

        const lMatch = content.match(/^L:\s*1\/(\d+)/m);
        if (lMatch) {
            this.unitNoteLength = 1 / parseInt(lMatch[1]);
        }
    }

    private getCurrentBar(content: string, cursor: number): string {
        const beforeCursor = content.substring(0, cursor);
        const lastNewline = beforeCursor.lastIndexOf('\n');
        const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

        const afterCursor = content.substring(cursor);
        const nextNewline = afterCursor.search('\n');
        const lineEnd = nextNewline === -1 ? content.length : cursor + nextNewline;

        const currentLine = content.substring(lineStart, lineEnd).trim();
        if (currentLine.startsWith('%') || currentLine.startsWith('w:') || /^[A-Z]:/.test(currentLine)) return '';

        const barSeparator = /\||::/;
        const lastPipe = beforeCursor.lastIndexOf('|');
        const lastDoubleColon = beforeCursor.lastIndexOf('::');

        let start = Math.max(lastNewline, lastPipe, lastDoubleColon);
        let delimiterLength = (start === lastDoubleColon && start !== lastNewline) ? 2 : 1;
        if (start === -1) { start = 0; delimiterLength = 0; }

        let end = afterCursor.search(barSeparator);
        if (end === -1) end = afterCursor.length;
        if (nextNewline !== -1 && nextNewline < end) end = nextNewline;

        return (beforeCursor.substring(start + delimiterLength) + afterCursor.substring(0, end)).trim();
    }

    // Helper to parse ABC duration strings into numbers
    private getDur(durStr: string | undefined): number {
        if (!durStr) return 1;
        if (durStr.match(/^\d+$/)) return parseInt(durStr);
        if (durStr.startsWith('/')) {
            const slashes = (durStr.match(/\//g) || []).length;
            const denStr = durStr.replace(/\//g, '');
            const den = denStr ? parseInt(denStr) : Math.pow(2, slashes);
            return 1 / den;
        }
        if (durStr.includes('/')) {
            const parts = durStr.split('/');
            const num = parts[0] ? parseInt(parts[0]) : 1;
            const den = parts[1] ? parseInt(parts[1]) : 2;
            return num / den;
        }
        return 1;
    }

    private calculateBarDuration(barContent: string): number {
        let totalDuration = 0;

        // 1. Clean the bar
        let cleanBar = barContent.replace(/"[^"]*"/g, '')
            .replace(/\{.*?\}/g, '')
            .replace(/!.*?!/g, '')
            .replace(/\[[A-Za-z]:.*?\]/g, '')
            .replace(/%%.*/g, '');

        // 2. Combined Regex to find:
        // Group 1: Tuplets (e.g., "(3", "(3:2:3")
        // Group 2: Chords (e.g., "[abc]2")
        // Group 5: Notes/Rests (e.g., "A", "z/2")
        const combinedRegex = /(\(\d+(?::\d+(?::\d+)?)?)|(\[([^\]]*)\](\d+(?:\/\d*)?|\/+\d*)?)|((?:[\^=_]*)?[A-Ga-gzZxX][,']*(\d+(?:\/\d*)?|\/+\d*)?)/g;

        let tupletRemaining = 0;
        let tupletFactor = 1;

        let match;
        while ((match = combinedRegex.exec(cleanBar)) !== null) {
            const tupletMarker = match[1];
            const chordFull = match[2];
            const chordContent = match[3];
            const chordOuterDur = match[4];
            const noteFull = match[5];
            const noteDur = match[6];

            // Case A: Found a Tuplet Marker
            if (tupletMarker) {
                const parts = tupletMarker.substring(1).split(':');
                const p = parseInt(parts[0]); // number of notes
                // Default q (time units) based on ABC spec
                let q = (p === 3 || p === 6 || p === 9) ? 2 : (p === 2 || p === 4 || p === 8) ? 3 : p;
                if (parts[1]) q = parseInt(parts[1]);
                let r = p; // how many notes are affected
                if (parts[2]) r = parseInt(parts[2]);

                tupletRemaining = r;
                tupletFactor = q / p; // e.g., (3 becomes 2/3
                continue;
            }

            let itemDuration = 0;

            // Case B: Found a Chord
            if (chordFull) {
                const firstNoteMatch = chordContent.match(/(?:[\^=_]*)?[A-Ga-g][,']*(\d+(?:\/\d*)?|\/+\d*)?/);
                const innerDur = firstNoteMatch ? this.getDur(firstNoteMatch[1]) : 1;
                const outerDur = this.getDur(chordOuterDur);
                itemDuration = innerDur * outerDur;
            }
            // Case C: Found a Note or Rest
            else if (noteFull) {
                itemDuration = this.getDur(noteDur);
            }

            // Apply Tuplet logic if active
            if (tupletRemaining > 0) {
                totalDuration += (itemDuration * tupletFactor);
                tupletRemaining--;
            } else {
                totalDuration += itemDuration;
            }
        }

        return totalDuration;
    }

    private render(barContent: string) {
        this.barContainer.empty();

        const numRects = this.timeSignature.num;
        const currentDurationInL = this.calculateBarDuration(barContent);
        const blockSize = 1 / this.timeSignature.den;
        const lSize = this.unitNoteLength;
        const lPerBlock = blockSize / lSize;

        let filledL = currentDurationInL;
        const isDark = document.body.classList.contains('theme-dark');
        const normalColor = isDark ? '#A89917' : '#EFE600';
        const fullColor = isDark ? '#4CB014' : '#00D300';
        const overflowColor = isDark ? '#A62114' : '#ff0000';

        const totalCapacity = numRects * lPerBlock;
        let barColor = normalColor;
        if (currentDurationInL >= totalCapacity - 0.01) barColor = fullColor;
        if (currentDurationInL > totalCapacity + 0.01) barColor = overflowColor;

        for (let i = 0; i < numRects; i++) {
            const rect = this.barContainer.createDiv({ cls: 'abc-bar-rect' });
            rect.style.flex = '1';
            rect.style.backgroundColor = 'var(--background-primary)';
            rect.style.border = '1px solid var(--background-modifier-border)';
            rect.style.borderRadius = '4px';
            rect.style.position = 'relative';
            rect.style.overflow = 'hidden';

            let fillAmount = 0;
            if (filledL >= lPerBlock) {
                fillAmount = 100;
                filledL -= lPerBlock;
            } else if (filledL > 0) {
                fillAmount = (filledL / lPerBlock) * 100;
                filledL = 0;
            }

            if (fillAmount > 0) {
                const fill = rect.createDiv({ cls: 'abc-bar-fill' });
                fill.style.position = 'absolute';
                fill.style.left = '0'; fill.style.top = '0';
                fill.style.height = '100%';
                fill.style.width = `${fillAmount}%`;
                fill.style.backgroundColor = barColor;
                fill.style.opacity = '0.8';
            }
        }

        const info = this.container.querySelector('.abc-bar-info');
        if (info) {
            info.textContent = `Time: ${this.timeSignature.num}/${this.timeSignature.den} | Unit: 1/${Math.round(1 / this.unitNoteLength)} | Bar: ${currentDurationInL.toFixed(2)} L`;
        }
    }
}