import { MidiBuffer, TuneObject, renderAbc, synth, SynthOptions } from 'abcjs';
import { MarkdownRenderChild, MarkdownPostProcessorContext } from 'obsidian';
import { AUDIO_PARAMS, DEFAULT_OPTIONS, OPTIONS_REGEX, PLAYBACK_CONTROLS_ID, SYNTH_INIT_OPTIONS } from './cfg';
import { NoteHighlighter, togglePlayingHighlight } from './note_highlighter';

/**
 * This class abstraction is needed to support load/unload hooks
 * 
 * "If your post processor requires lifecycle management, for example, to clear an interval, kill a subprocess, etc when this element is removed from the app..."
 * https://marcus.se.net/obsidian-plugin-docs/reference/typescript/interfaces/MarkdownPostProcessorContext#addchild
 */
export class PlaybackElement extends MarkdownRenderChild {
  private playPauseButton: HTMLButtonElement;
  private isPlaying: boolean = false;
  private readonly abortController = new AbortController();
  private readonly midiBuffer: MidiBuffer = new synth.CreateSynth();
  private readonly synthCtrl = new synth.SynthController();
  private visualObj: TuneObject | null = null;
  private abcSource: string = '';

  constructor(
    private readonly el: HTMLElement,
    private readonly markdownSource: string,
    private readonly ctx?: MarkdownPostProcessorContext,
  ) {
    super(el); // important
  }

  onload() {
    const { userOptions, source } = this.parseOptionsAndSource();
    this.abcSource = source;
    const options = { 
      ...DEFAULT_OPTIONS, 
      ...userOptions,
      clickListener: this.handleElementClick
    };
    const renderResp = renderAbc(this.el, source, options);
    this.visualObj = renderResp[0];
    this.addPlaybackButtons();
    this.enableAudioPlayback(renderResp[0]);
  }

  /**
   * Stop the music and clean things up.
   * 
   * (Tested) Called when:
   * 1. Cursor focus goes into the text area (which switches from preview to edit mode)
   * 2. A tab containing this is closed (very important)
   * 
   * Not called when:
   * 1. Switching tabs to a different one (audio keeps playing)
   */
  onunload() {
    this.abortController.abort(); // dom event listeners

    // A lot of steps, but I think all these things need to happen to really stop in-progress audio playback for ABCjs.
    this.synthCtrl.restart();
    this.synthCtrl.pause();
    this.midiBuffer.stop(); // doesn't stop the music by itself?
  }

  parseOptionsAndSource(): { userOptions: Record<string, any>, source: string } {
    let userOptions: Record<string, any> = {};

    const optionsMatch = this.markdownSource.match(OPTIONS_REGEX);
    let source = this.markdownSource; // can be modified, removes the options portion.
    if (optionsMatch !== null) {
      source = optionsMatch.groups["source"];
      try {
        userOptions = JSON.parse(optionsMatch.groups["options"]);
      } catch (e) {
        console.error(e);
        this.renderError(`<strong>Failed to parse user-options</strong>
	${e}`);
      }
    }

    return { userOptions, source };
  }

  renderError(error?: string) {
    if (error == null) return;
    const errorNode = document.createElement('div');
    errorNode.innerHTML = error;
    errorNode.addClass("obsidian-plugin-abcjs-error");
    this.el.appendChild(errorNode);
  }

  // Audio playback features
  // Many variants, options, and guidance here: https://paulrosen.github.io/abcjs/audio/synthesized-sound.html
  enableAudioPlayback(visualObj: TuneObject) {
  if (!synth.supportsAudio()) return;

  // Extract user options (already done in onload via parseOptionsAndSource)
  const { userOptions } = this.parseOptionsAndSource();

  // Separate visual vs audio options? (Optional)
  // For now, assume any unknown options are for audio/synth
  const audioParamsFromUser: Record<string, any> = {};
  const knownAudioKeys = ['swing', 'chordsOff']; // add others as needed

  for (const key of knownAudioKeys) {
    if (userOptions.hasOwnProperty(key)) {
      audioParamsFromUser[key] = userOptions[key];
    }
  }

  // Merge: defaults (from cfg) <- user overrides
  const finalAudioParams: SynthOptions = { ...AUDIO_PARAMS, ...audioParamsFromUser };

  // We need the SynthController to drive NoteHighlighter (CursorControl)
  this.synthCtrl.load(
    `#${PLAYBACK_CONTROLS_ID}`,
    new NoteHighlighter(this.el),
  );

  this.midiBuffer.init({ visualObj, options: SYNTH_INIT_OPTIONS })
    .then(() => this.synthCtrl.setTune(visualObj, false, finalAudioParams))
    .catch(console.warn.bind(console));
}

  private addPlaybackButtons() {
    const buttonContainer = this.el.createDiv({ cls: 'abcjs-controls' });

    this.playPauseButton = buttonContainer.createEl('button');
    this.playPauseButton.innerHTML = '▶';
    this.playPauseButton.setAttribute('aria-label', 'Play');
    this.playPauseButton.addEventListener('click', this.togglePlayback);

    const restartButton = buttonContainer.createEl('button');
    restartButton.innerHTML = '⏮';
    restartButton.setAttribute('aria-label', 'Restart');
    restartButton.addEventListener('click', this.restartPlayback);
  }

  private readonly togglePlayback = () => {
    const isCurrentlyPlaying = (this.midiBuffer as any)?.isRunning;
    
    if (isCurrentlyPlaying) {
      this.synthCtrl.pause();
      this.isPlaying = false;
      togglePlayingHighlight(this.el)(false);
    } else {
      this.synthCtrl.play();
      this.isPlaying = true;
      togglePlayingHighlight(this.el)(true);
    }
  };

  // start again at the begining of the tune
  private readonly restartPlayback = () => {
    this.synthCtrl.restart();
    this.isPlaying = false;
    togglePlayingHighlight(this.el)(false);
  };

  // All ABC pitches from lowest to highest
  private readonly allPitches = [
    'C,,,,', 'D,,,,', 'E,,,,', 'F,,,,', 'G,,,,', 'A,,,,', 'B,,,,',
    'C,,,', 'D,,,', 'E,,,', 'F,,,', 'G,,,', 'A,,,', 'B,,,',
    'C,,', 'D,,', 'E,,', 'F,,', 'G,,', 'A,,', 'B,,',
    'C,', 'D,', 'E,', 'F,', 'G,', 'A,', 'B,',
    'C', 'D', 'E', 'F', 'G', 'A', 'B',
    'c', 'd', 'e', 'f', 'g', 'a', 'b',
    "c'", "d'", "e'", "f'", "g'", "a'", "b'",
    "c''", "d''", "e''", "f''", "g''", "a''", "b''",
    "c'''", "d'''", "e'''", "f'''", "g'''", "a'''", "b'''",
    "c''''", "d''''", "e''''", "f''''", "g''''", "a''''", "b''''"
  ];

  private moveNote(note: string, step: number): string {
    const index = this.allPitches.indexOf(note);
    if (index >= 0 && index - step >= 0 && index - step < this.allPitches.length) {
      return this.allPitches[index - step];
    }
    return note;
  }

  private tokenize(str: string): string[] {
    // Split by decorations and quoted strings, preserving them
    const arr = str.split(/(!.+?!|".+?")/);
    const output: string[] = [];
    
    for (let i = 0; i < arr.length; i++) {
      const token = arr[i];
      if (token.length > 0) {
        if (token[0] !== '"' && token[0] !== '!') {
          // Further split to isolate note names
          const arr2 = token.split(/([A-Ga-g][,']*)/);
          output.push(...arr2);
        } else {
          output.push(token);
        }
      }
    }
    return output;
  }

  private readonly handleElementClick = async (abcElem: any, tuneNumber: number, classes: string, analysis: any, drag: any) => {
    // Only process if this is a note drag with valid character positions
    if (!abcElem.pitches || !drag || !drag.step || abcElem.startChar < 0 || abcElem.endChar < 0) {
      return;
    }

    const originalText = this.abcSource.substring(abcElem.startChar, abcElem.endChar);
    
    // Tokenize the original text
    const tokens = this.tokenize(originalText);
    
    // Move each note in the tokens by the drag step
    for (let i = 0; i < tokens.length; i++) {
      tokens[i] = this.moveNote(tokens[i], drag.step);
    }
    
    const newText = tokens.join('');
    
    // Update the ABC source
    this.abcSource = this.abcSource.substring(0, abcElem.startChar) + 
                     newText + 
                     this.abcSource.substring(abcElem.endChar);
    
    // Save the change to the file
    await this.updateFileContent();
    
    // Re-render with the updated source
    this.reRender();
  };

  private async updateFileContent() {
    if (!this.ctx) return;
    
    const sectionInfo = this.ctx.getSectionInfo(this.el);
    if (!sectionInfo) return;

    const { lineStart, lineEnd } = sectionInfo;
    const sourcePath = (this.ctx as any).sourcePath;
    if (!sourcePath) return;

    const app = (window as any).app;
    const file = app.vault.getAbstractFileByPath(sourcePath);
    if (!file) return;

    try {
      // Read the entire file content
      const content = await app.vault.read(file);
      const lines = content.split('\n');
      
      // Find the code block boundaries
      let codeBlockStart = -1;
      let codeBlockEnd = -1;
      
      for (let i = lineStart; i >= 0; i--) {
        if (lines[i].trim().startsWith('```abc') || lines[i].trim().startsWith('```music-abc')) {
          codeBlockStart = i;
          break;
        }
      }
      
      for (let i = lineStart; i < lines.length; i++) {
        if (i > codeBlockStart && lines[i].trim().startsWith('```')) {
          codeBlockEnd = i;
          break;
        }
      }
      
      if (codeBlockStart >= 0 && codeBlockEnd > codeBlockStart) {
        // Replace the code block content
        const beforeBlock = lines.slice(0, codeBlockStart + 1);
        const afterBlock = lines.slice(codeBlockEnd);
        
        const newLines = [
          ...beforeBlock,
          this.abcSource,
          ...afterBlock
        ];
        
        const newContent = newLines.join('\n');
        await app.vault.modify(file, newContent);
      }
    } catch (error) {
      console.error('Failed to update file:', error);
    }
  }

  private reRender() {
    const { userOptions } = this.parseOptionsAndSource();
    const options = { 
      ...DEFAULT_OPTIONS, 
      ...userOptions,
      clickListener: this.handleElementClick
    };
    
    // Clear existing SVG
    const svg = this.el.querySelector('svg');
    if (svg) svg.remove();
    
    // Re-render with updated source
    const renderResp = renderAbc(this.el, this.abcSource, options);
    this.visualObj = renderResp[0];
    
    // Update audio
    if (this.visualObj) {
      const { userOptions } = this.parseOptionsAndSource();
      const audioParamsFromUser: Record<string, any> = {};
      const knownAudioKeys = ['swing', 'chordsOff'];
      
      for (const key of knownAudioKeys) {
        if (userOptions.hasOwnProperty(key)) {
          audioParamsFromUser[key] = userOptions[key];
        }
      }
      
      const finalAudioParams: SynthOptions = { ...AUDIO_PARAMS, ...audioParamsFromUser };
      this.midiBuffer.init({ visualObj: this.visualObj, options: SYNTH_INIT_OPTIONS })
        .then(() => this.synthCtrl.setTune(this.visualObj!, false, finalAudioParams))
        .catch(console.warn.bind(console));
    }
  }
}