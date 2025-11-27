import { EditorView } from '@codemirror/view';

export class BarVisualizer {
    public container: HTMLElement;
    private barContainer: HTMLElement;
    private timeSignature: { num: number, den: number } = { num: 4, den: 4 };
    private unitNoteLength: number = 1 / 8; // Default L: 1/8

    constructor(parent: HTMLElement) {
        this.container = parent.createDiv({ cls: 'abc-bar-visualizer-container' });
        this.container.style.marginBottom = '10px';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.gap = '5px';

        // Header for info
        const header = this.container.createDiv({ cls: 'abc-bar-info' });
        header.style.fontSize = '0.8em';
        header.style.color = 'var(--text-muted)';

        // Container for the visual bars
        this.barContainer = this.container.createDiv({ cls: 'abc-bar-visuals' });
        this.barContainer.style.display = 'flex';
        this.barContainer.style.gap = '2px';
        this.barContainer.style.height = '20px';
        this.barContainer.style.width = '100%';
        this.barContainer.style.backgroundColor = 'var(--background-secondary)';
        this.barContainer.style.borderRadius = '4px';
        this.barContainer.style.overflow = 'hidden';
    }

    update(content: string, cursor: number) {
        this.parseHeader(content);
        const currentBar = this.getCurrentBar(content, cursor);
        this.render(currentBar);
    }

    private parseHeader(content: string) {
        // Simple regex parsing for M: and L:
        // Look for the last occurrence before the body starts or just generally in the file
        // For simplicity, we'll scan the whole file but prioritize headers closer to the cursor if we were being fancy.
        // For now, let's just find the first valid headers or the ones defined in the tune.

        const mMatch = content.match(/^M:\s*(\d+)\/(\d+)/m);
        if (mMatch) {
            this.timeSignature = { num: parseInt(mMatch[1]), den: parseInt(mMatch[2]) };
        } else {
            // Check for C, C|
            const mSymbolMatch = content.match(/^M:\s*([C|])/m);
            if (mSymbolMatch) {
                if (mSymbolMatch[1] === 'C') {
                    this.timeSignature = { num: 4, den: 4 };
                } else if (mSymbolMatch[1] === '|') {
                    this.timeSignature = { num: 2, den: 2 };
                }
            }
        }

        const lMatch = content.match(/^L:\s*1\/(\d+)/m);
        if (lMatch) {
            this.unitNoteLength = 1 / parseInt(lMatch[1]);
        }
    }

    private getCurrentBar(content: string, cursor: number): string {
        // Find the start of the current bar
        // We look backwards from cursor for a bar line | or start of line
        // We look forwards from cursor for a bar line | or end of line

        // Check if the current line is a non-score line (header or directive)
        const beforeCursor = content.substring(0, cursor);
        const lastNewline = beforeCursor.lastIndexOf('\n');
        const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

        const afterCursor = content.substring(cursor);
        const nextNewline = afterCursor.search('\n');
        const lineEnd = nextNewline === -1 ? content.length : cursor + nextNewline;

        const currentLine = content.substring(lineStart, lineEnd).trim();

        // Ignore directives (%%), lyrics (w:), and headers (X:, T:, M:, etc.)
        // Headers are [Letter]: ...
        // Directives are %%...
        if (currentLine.startsWith('%%') || currentLine.startsWith('w:') || /^[A-Z]:/.test(currentLine)) {
            return '';
        }

        // This is a simplified approach. A full ABC parser would be robust but complex.
        // We assume bars are delimited by | or || or |] or [| or :| or |:

        // Regex for bar lines.
        // We use | and :: as primary separators.
        // We avoid [ and ] because they are used for chords and inline fields.
        const barSeparator = /\||::/;

        const lastPipe = beforeCursor.lastIndexOf('|');
        const lastDoubleColon = beforeCursor.lastIndexOf('::');

        let start = -1;
        let delimiterLength = 1; // Default to 1 (effectively 0 offset if start is -1)

        if (lastPipe > -1 || lastDoubleColon > -1) {
            if (lastPipe > lastDoubleColon) {
                start = lastPipe;
                delimiterLength = 1;
            } else {
                start = lastDoubleColon;
                delimiterLength = 2;
            }
        }

        if (lastNewline > start) {
            start = lastNewline;
            delimiterLength = 1;
        }

        let end = afterCursor.search(barSeparator);

        if (end === -1) end = afterCursor.length;
        if (nextNewline !== -1 && nextNewline < end) end = nextNewline;

        // Adjust start to skip the delimiter itself
        const barContent = (beforeCursor.substring(start + delimiterLength) + afterCursor.substring(0, end)).trim();
        return barContent;
    }

    private parseNoteDuration(note: string): number {
        // Basic parser for note duration
        // A note is [accidental] [note] [octave] [duration]
        // Duration is a number (multiplier) or / (divider)
        // e.g. C2 = 2 * L, C/2 = 0.5 * L, C = 1 * L

        // Remove decorations, chords, etc. for simplicity or assume clean note string
        // The regex below tries to capture the duration part

        // Matches:
        // 1. Digits (multiplier)
        // 2. Slash and optional digits (divider)
        const durationMatch = note.match(/(\d+)?(\/+)(\d+)?|(\d+)/);

        let multiplier = 1;

        if (durationMatch) {
            if (durationMatch[4]) { // Just a number like C2
                multiplier = parseInt(durationMatch[4]);
            } else {
                // Has slashes
                const num = durationMatch[1] ? parseInt(durationMatch[1]) : 1;
                const slashes = durationMatch[2] ? durationMatch[2].length : 0;
                const den = durationMatch[3] ? parseInt(durationMatch[3]) : Math.pow(2, slashes);
                multiplier = num / den;
            }
        }

        return multiplier;
    }

    private calculateBarDuration(barContent: string): number {
        // Tokenize the bar content to find notes
        // This is tricky without a full parser. We'll try to identify notes.
        // Notes: [A-Ga-g] followed optionally by , or ' and then duration
        // Rests: z or Z followed by duration

        // We need to ignore chords [GB] for now or treat them as single duration
        // Ignore inline fields [M:...]

        let duration = 0;

        // Remove strings "..."
        let cleanBar = barContent.replace(/"[^"]*"/g, '');

        // Remove decorations !...! and +...+
        cleanBar = cleanBar.replace(/!.*?!/g, '');
        cleanBar = cleanBar.replace(/\+.*?\+/g, '');

        // Remove inline fields [K:...], [M:...] etc. (Letter followed by colon)
        cleanBar = cleanBar.replace(/\[[A-Za-z]:.*?\]/g, '');

        // Remove inline directives [%%...]
        cleanBar = cleanBar.replace(/\[%%.*?\]/g, '');

        // Remove remaining directives if any leaked in
        cleanBar = cleanBar.replace(/%%.*/g, '');

        // Simple tokenizer
        // We iterate and look for note patterns
        const regex = /([A-Ga-g]zZ)([,']*)(\d*\/?\d*)/g; // Very basic

        // Better approach: split by spaces and process tokens? No, ABC is compact.
        // Let's use a regex that matches a note or rest with its duration

        // Regex for a note/rest:
        // (?:[\^=_]*)?   -> Accidentals (ignored for duration)
        // [A-Ga-g]       -> Note name
        // [,']*          -> Octave (ignored for duration)
        // (\d+(?:\/\d*)?|\/+\d*)? -> Duration

        // Also handle chords [ ... ]
        // Also handle rests z, Z

        // Let's try to match all notes/chords/rests and sum their durations

        // 1. Chords: \[.*?\](\d+(?:\/\d*)?|\/+\d*)?
        // 2. Notes/Rests: (?:[\^=_]*)?[A-Ga-gzZ][,']*(\d+(?:\/\d*)?|\/+\d*)?

        const chordRegex = /\[.*?\](\d+(?:\/\d*)?|\/+\d*)?/g;
        const noteRegex = /(?:[\^=_]*)?[A-Ga-gzZ][,']*(\d+(?:\/\d*)?|\/+\d*)?/g;

        // We need to consume the string.
        let remaining = cleanBar;

        // Helper to extract duration from a match
        const getDur = (durStr: string) => {
            if (!durStr) return 1;
            if (durStr.match(/^\d+$/)) return parseInt(durStr);
            if (durStr.startsWith('/')) {
                const num = 1;
                const slashes = durStr.match(/\//g).length;
                const denStr = durStr.replace(/\//g, '');
                const den = denStr ? parseInt(denStr) : Math.pow(2, slashes);
                return num / den;
            }
            if (durStr.includes('/')) {
                const parts = durStr.split('/');
                const num = parts[0] ? parseInt(parts[0]) : 1;
                const den = parts[1] ? parseInt(parts[1]) : 2;
                return num / den;
            }
            return 1;
        };

        // Replace chords first to avoid matching notes inside
        remaining = remaining.replace(chordRegex, (match, dur) => {
            duration += getDur(dur);
            return ''; // Remove from string
        });

        // Now match remaining notes/rests
        remaining.replace(noteRegex, (match, dur) => {
            duration += getDur(dur);
            return '';
        });

        return duration;
    }

    private render(barContent: string) {
        this.barContainer.empty();

        // Calculate total beats in the bar based on Time Signature
        // M: 4/4 -> 4 beats of 1/4.
        // M: 6/8 -> 2 beats of 3/8 (compound) or 6 beats of 1/8? 
        // The user asked for "rectangles divided by the value of L".
        // "For M: 4/4 ... four rectangles should appear ... Each rectangle divided by the value of L"
        // Wait, "Each rectangle divided by the value of L" might mean each rectangle represents a beat?
        // "if M:3/8 should be three rectangles". 
        // So it seems the number of rectangles = number of beats?
        // Or number of "L" units?

        // User said: "For example for "M: 4/4" ... four rectangles should appear ... Each rectangle divided by the value of "L:""
        // This is slightly ambiguous. 
        // If L: 1/8, and M: 4/4. 4/4 is 8 * 1/8. So 8 units of L.
        // If user wants 4 rectangles, maybe they mean 4 beats (quarter notes)?
        // But then "Each rectangle divided by the value of L" might mean the rectangle represents a quarter note, and it's filled by 1/8 notes?

        // Let's interpret "four rectangles ... if M:3/8 should be three rectangles".
        // M: 4/4 -> 4 beats. M: 3/8 -> 3 beats (of 1/8).
        // So the number of rectangles is the numerator of the time signature?
        // And the "capacity" of each rectangle is the denominator unit?

        // Let's try to map the total duration of the bar to these rectangles.

        const numRects = this.timeSignature.num;
        const beatValue = 1 / this.timeSignature.den; // e.g. 1/4 for 4/4, 1/8 for 3/8

        // Total capacity of the bar in terms of L units
        // L unit value = this.unitNoteLength (e.g. 1/8)

        // Let's calculate how filled the bar is in terms of L units.
        const currentDurationInL = this.calculateBarDuration(barContent);

        // We want to display 'numRects' blocks.
        // Each block represents 1 'denominator' note? 
        // e.g. 4/4 -> 4 blocks of 1/4.
        // e.g. 3/8 -> 3 blocks of 1/8.

        // How much 'L' fits in one block?
        // Block size = 1 / this.timeSignature.den
        // L size = this.unitNoteLength
        // Ratio = Block size / L size
        // e.g. 4/4 (Block=1/4), L=1/8. Ratio = 2. Each block holds 2 L-notes.

        const blockSize = 1 / this.timeSignature.den;
        const lSize = this.unitNoteLength;
        const lPerBlock = blockSize / lSize;

        // Total L units filled so far
        let filledL = currentDurationInL;

        for (let i = 0; i < numRects; i++) {
            const rect = this.barContainer.createDiv({ cls: 'abc-bar-rect' });
            rect.style.flex = '1';
            rect.style.backgroundColor = 'var(--background-primary)';
            rect.style.border = '1px solid var(--text-muted)';
            rect.style.position = 'relative';

            // Calculate fill for this rect
            // This rect represents 'lPerBlock' amount of L units.

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
                fill.style.left = '0';
                fill.style.top = '0';
                fill.style.height = '100%';
                fill.style.width = `${fillAmount}%`;
                fill.style.backgroundColor = 'var(--interactive-accent)';
                fill.style.opacity = '0.6';
            }
        }

        // Update info text
        const info = this.container.querySelector('.abc-bar-info');
        if (info) {
            info.textContent = `Time: ${this.timeSignature.num}/${this.timeSignature.den} | Unit: 1/${Math.round(1 / this.unitNoteLength)} | Bar: ${currentDurationInL.toFixed(2)} L`;
        }
    }
}
