
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
