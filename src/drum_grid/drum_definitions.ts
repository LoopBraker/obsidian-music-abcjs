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