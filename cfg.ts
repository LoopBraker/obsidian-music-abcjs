import { AbcVisualParams, SynthOptions } from 'abcjs';



export const PLAYBACK_CONTROLS_ID = 'abcjs-playback-controls-unused';

export const OPTIONS_REGEX = new RegExp(/(?<options>{.*})\n---\n(?<source>.*)/s);

export const DEFAULT_OPTIONS: AbcVisualParams = {
  add_classes: true,
  responsive: 'resize',
  dragging: true,
  selectTypes: ['note'],
  selectionColor: 'red',
  dragColor: 'rgba(0, 200, 100, 0.5)'
};

export const AUDIO_PARAMS: SynthOptions = {
  // chordsOff: true,
};

export const SOUND_FONT_URLS = {
  'abcjs': 'https://paulrosen.github.io/midi-js-soundfonts/abcjs/',
  'FluidR3_GM': 'https://paulrosen.github.io/midi-js-soundfonts/FluidR3_GM/',
  'MusyngKite': 'https://paulrosen.github.io/midi-js-soundfonts/MusyngKite/'
};

export function getSynthInitOptions(soundFont: 'abcjs' | 'FluidR3_GM' | 'MusyngKite' = 'MusyngKite'): SynthOptions {
  return {
    // Give it a little more room:
    pan: [-0.25, 0.25],
    soundFontUrl: SOUND_FONT_URLS[soundFont]
  };
}
