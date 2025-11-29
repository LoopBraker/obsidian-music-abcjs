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

        // Header for info
        const header = this.container.createDiv({ cls: 'abc-bar-info' });
        header.style.fontSize = '0.6em';
        header.style.color = 'var(--text-muted)';
        header.style.fontFamily = 'sans-serif';
        // Height matching font size? 
        // User said: "height should be as the height of the font above it, i mean the font of the text 'Time:...'"
        // Font size is 0.8em. Let's assume approx 14px or use '1em' relative to this container.

        // Container for the visual bars
        this.barContainer = this.container.createDiv({ cls: 'abc-bar-visuals' });
        this.barContainer.style.display = 'flex';
        this.barContainer.style.gap = '2px';
        this.barContainer.style.height = '0.8em'; // Match font height roughly (0.8em * 1.5 line height approx?) or just use same size
        this.barContainer.style.width = '100%';
        // Background removed or transparent? User didn't specify container bg, just rectangles.
        // But previously it had bg. Let's keep it clean.
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
        const beforeCursor = content.substring(0, cursor);
        const lastNewline = beforeCursor.lastIndexOf('\n');
        const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;

        const afterCursor = content.substring(cursor);
        const nextNewline = afterCursor.search('\n');
        const lineEnd = nextNewline === -1 ? content.length : cursor + nextNewline;

        const currentLine = content.substring(lineStart, lineEnd).trim();

        if (currentLine.startsWith('%%') || currentLine.startsWith('w:') || /^[A-Z]:/.test(currentLine)) {
            return '';
        }

        const barSeparator = /\||::/;

        const lastPipe = beforeCursor.lastIndexOf('|');
        const lastDoubleColon = beforeCursor.lastIndexOf('::');

        let start = -1;
        let delimiterLength = 1;

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

        const barContent = (beforeCursor.substring(start + delimiterLength) + afterCursor.substring(0, end)).trim();
        return barContent;
    }

    private parseNoteDuration(note: string): number {
        const durationMatch = note.match(/(\d+)?(\/+)(\d+)?|(\d+)/);
        let multiplier = 1;

        if (durationMatch) {
            if (durationMatch[4]) {
                multiplier = parseInt(durationMatch[4]);
            } else {
                const num = durationMatch[1] ? parseInt(durationMatch[1]) : 1;
                const slashes = durationMatch[2] ? durationMatch[2].length : 0;
                const den = durationMatch[3] ? parseInt(durationMatch[3]) : Math.pow(2, slashes);
                multiplier = num / den;
            }
        }
        return multiplier;
    }

    private calculateBarDuration(barContent: string): number {
        let duration = 0;
        let cleanBar = barContent.replace(/"[^"]*"/g, '');
        cleanBar = cleanBar.replace(/!.*?!/g, '');
        cleanBar = cleanBar.replace(/\+.*?\+/g, '');
        cleanBar = cleanBar.replace(/\[[A-Za-z]:.*?\]/g, '');
        cleanBar = cleanBar.replace(/\[%%.*?\]/g, '');
        cleanBar = cleanBar.replace(/%%.*/g, '');

        const chordRegex = /\[.*?\](\d+(?:\/\d*)?|\/+\d*)?/g;
        const noteRegex = /(?:[\^=_]*)?[A-Ga-gzZ][,']*(\d+(?:\/\d*)?|\/+\d*)?/g;

        let remaining = cleanBar;

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

        remaining = remaining.replace(chordRegex, (match, dur) => {
            duration += getDur(dur);
            return '';
        });

        remaining.replace(noteRegex, (match, dur) => {
            duration += getDur(dur);
            return '';
        });

        return duration;
    }

    private render(barContent: string) {
        this.barContainer.empty();

        const numRects = this.timeSignature.num;
        const currentDurationInL = this.calculateBarDuration(barContent);
        const blockSize = 1 / this.timeSignature.den;
        const lSize = this.unitNoteLength;
        const lPerBlock = blockSize / lSize;

        let filledL = currentDurationInL;

        // Determine Color
        // 3rd button (Normal): #A89917 (Dark), #EFE600 (Light)
        // 4th button (Full): #4CB014 (Dark), #00D300 (Light)
        // 1st button (Overflow): #A62114 (Dark), #ff0000 (Light)

        const isDark = document.body.classList.contains('theme-dark');

        const normalColor = isDark ? '#A89917' : '#EFE600';
        const fullColor = isDark ? '#4CB014' : '#00D300';
        const overflowColor = isDark ? '#A62114' : '#ff0000';

        // Calculate total capacity
        const totalCapacity = numRects * lPerBlock;

        let barColor = normalColor;
        if (currentDurationInL >= totalCapacity) {
            barColor = fullColor;
        }
        if (currentDurationInL > totalCapacity) {
            barColor = overflowColor;
        }

        for (let i = 0; i < numRects; i++) {
            const rect = this.barContainer.createDiv({ cls: 'abc-bar-rect' });
            rect.style.flex = '1';
            rect.style.backgroundColor = 'var(--background-primary)';
            // Border matching chord buttons: 1px solid var(--background-modifier-border)
            // But user said "border the same". Chord buttons use that variable.
            // Wait, chord buttons use `var(--background-modifier-border)` for the button element?
            // In `chord_button_bar.ts`: `btn.style.border = '1px solid var(--background-modifier-border)';`
            // But the SVG buttons have internal rects.
            // The user said "Each rectangle should have the same corner rounded as the button are, as well as the border the same."
            // The modifier buttons have border. The chord buttons are SVGs.
            // Assuming user means the modifier buttons style or the general "button" look.
            // Let's use the modifier button style: border and radius.

            rect.style.border = '1px solid var(--background-modifier-border)';
            rect.style.borderRadius = '4px'; // Same as modifier buttons
            rect.style.position = 'relative';
            rect.style.overflow = 'hidden'; // For rounded corners on fill

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
                fill.style.backgroundColor = barColor;
                // Opacity? User didn't specify, but previous code had 0.6.
                // "progress should take the color of rectangles".
                // Let's use solid color or slight opacity to see grid?
                // Previous was 0.6. Let's keep it or make it solid if it looks better.
                // User said "take the color", implying exact match.
                fill.style.opacity = '0.8';
            }
        }

        // Update info text
        const info = this.container.querySelector('.abc-bar-info');
        if (info) {
            info.textContent = `Time: ${this.timeSignature.num}/${this.timeSignature.den} | Unit: 1/${Math.round(1 / this.unitNoteLength)} | Bar: ${currentDurationInL.toFixed(2)} L`;
        }
    }
}
