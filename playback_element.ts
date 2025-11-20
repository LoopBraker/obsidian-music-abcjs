import { MidiBuffer, TuneObject, renderAbc, synth, SynthOptions, TimingCallbacks, AnimationOptions } from 'abcjs';
import { MarkdownRenderChild, MarkdownPostProcessorContext } from 'obsidian';
import { AUDIO_PARAMS, DEFAULT_OPTIONS, OPTIONS_REGEX, PLAYBACK_CONTROLS_ID, SYNTH_INIT_OPTIONS } from './cfg';
import { NoteHighlighter, togglePlayingHighlight } from './note_highlighter';
import { NoteEditor } from './note_editor';

/**
 * This class abstraction is needed to support load/unload hooks
 * 
 * "If your post processor requires lifecycle management, for example, to clear an interval, kill a subprocess, etc when this element is removed from the app..."
 * https://marcus.se.net/obsidian-plugin-docs/reference/typescript/interfaces/MarkdownPostProcessorContext#addchild
 */
export class PlaybackElement extends MarkdownRenderChild {
  private playPauseButton: HTMLButtonElement;
  private draggingCheckbox: HTMLInputElement;
  private isPlaying: boolean = false;
  private draggingEnabled: boolean = false;

  private beatsPerMeasure: number = 4;
  private totalBeats: number = 0;
  private readonly abortController = new AbortController();
  private readonly midiBuffer: MidiBuffer = new synth.CreateSynth();

  // CHANGE: Removed the SynthController
  // private readonly synthCtrl = new synth.SynthController();

  // CHANGE: Add a direct reference to TimingCallbacks
  private timingCallbacks: TimingCallbacks | null = null;

  private visualObj: TuneObject | null = null;
  private noteEditor: NoteEditor;

  constructor(
    private readonly el: HTMLElement,
    private readonly markdownSource: string,
    private readonly ctx?: MarkdownPostProcessorContext,
  ) {
    super(el); // important
  }

  onload() {
    const { userOptions, source } = this.parseOptionsAndSource();
    this.noteEditor = new NoteEditor(source, this.ctx, this.el);
    
    // Check if %%allowDrag directive exists in source
    this.draggingEnabled = source.includes('%%allowDrag');
    
    const options = { 
      ...DEFAULT_OPTIONS, 
      ...userOptions,
      dragging: this.draggingEnabled,
      clickListener: this.handleElementClick
    };
    const renderResp = renderAbc(this.el, source, options);
    this.visualObj = renderResp[0];
    
    // Extract tune metrics
    if (this.visualObj) {
      this.beatsPerMeasure = this.visualObj.getBeatsPerMeasure();
      this.totalBeats = this.visualObj.getTotalBeats();
    }
    
    this.addPlaybackButtons();
    this.addDraggingToggle();
    this.enableAudioPlayback(this.visualObj);
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

    // CHANGE: Stop our own components directly
    this.timingCallbacks?.stop();
    this.midiBuffer.stop();
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

  // CHANGE: Major rewrite of this method to follow the vanilla JS example
  enableAudioPlayback(visualObj: TuneObject) {
    if (!synth.supportsAudio() || !visualObj) return;

    const { userOptions } = this.parseOptionsAndSource();
    const audioParamsFromUser: Record<string, any> = {};
    const knownAudioKeys = ['swing', 'chordsOff'];

    for (const key of knownAudioKeys) {
      if (userOptions.hasOwnProperty(key)) {
        audioParamsFromUser[key] = userOptions[key];
      }
    }

    const finalAudioParams: SynthOptions = { ...AUDIO_PARAMS, ...audioParamsFromUser, ...SYNTH_INIT_OPTIONS };

    // Define the animation options with callbacks
    const animationOptions: AnimationOptions = {
      eventCallback: (event: any) => {
        if (event && event.measureStart && event.left === null) return undefined;
        
        const selected = Array.from(this.el.querySelectorAll(".abcjs-highlight"));
        selected.forEach(el => el.classList.remove("abcjs-highlight"));
        
        if (event && event.elements) {
          event.elements.flat().forEach((el: Element) => el.classList.add("abcjs-highlight"));
        }
        return undefined;
      },
      beatCallback: (beatNumber: number, totalBeats: number, totalTime: number) => {
        // Beat callback for potential future use
      }
    };

    // Create our own TimingCallbacks instance with callbacks in options
    this.timingCallbacks = new TimingCallbacks(visualObj, animationOptions);

    // Initialize the synth and prime it (pre-generates audio)
    this.midiBuffer.init({ visualObj, options: finalAudioParams })
      .then(() => {
        // priming is necessary to start playback.
        // It's an async call, so we need to wait for it to finish.
        return this.midiBuffer.prime();
      })
      .then(() => {
        console.log("Audio is primed and ready to play.");
        // Set up onFinished handler for midiBuffer
        // Note: This runs when the tune finishes naturally
        const checkFinished = () => {
          if (!this.midiBuffer.getIsRunning() && this.isPlaying) {
            this.isPlaying = false;
            this.playPauseButton.innerHTML = '▶';
            this.playPauseButton.setAttribute('aria-label', 'Play');
            togglePlayingHighlight(this.el)(false);
          }
        };
        // We'll check periodically since there's no direct onFinished callback
        // This is a workaround - the TimingCallbacks handles visual, midiBuffer handles audio
      })
      .catch((error) => {
        console.warn("Audio initialization failed:", error);
      });
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

  private addDraggingToggle() {
    const toggleContainer = this.el.createDiv({ cls: 'abcjs-bottom-controls' });
    
    // Dragging checkbox
    const dragContainer = toggleContainer.createDiv({ cls: 'control-group' });
    this.draggingCheckbox = dragContainer.createEl('input', { type: 'checkbox' });
    this.draggingCheckbox.id = `drag-toggle-${Math.random().toString(36).substr(2, 9)}`;
    this.draggingCheckbox.checked = this.draggingEnabled;
    this.draggingCheckbox.addEventListener('change', this.toggleDragging);
    
    const dragLabel = dragContainer.createEl('label');
    dragLabel.setAttribute('for', this.draggingCheckbox.id);
    dragLabel.setText('Enable dragging');
  }

  private readonly toggleDragging = async () => {
    this.draggingEnabled = this.draggingCheckbox.checked;
    
    let currentSource = this.noteEditor.getSource();
    
    if (this.draggingEnabled) {
      // Add %%allowDrag directive if not present
      if (!currentSource.includes('%%allowDrag')) {
        // Add it at the beginning or after first line
        const lines = currentSource.split('\n');
        if (lines.length > 0 && lines[0].startsWith('X:')) {
          // Insert after X: line
          lines.splice(1, 0, '%%allowDrag');
        } else {
          // Insert at beginning
          lines.unshift('%%allowDrag');
        }
        currentSource = lines.join('\n');
      }
    } else {
      // Remove %%allowDrag directive
      currentSource = currentSource.replace(/%%allowDrag\n?/g, '');
    }
    
    // Update the source in noteEditor
    this.noteEditor.setSource(currentSource);
    
    // Save to file
    await this.updateFileWithSource(currentSource);
    
    this.reRender();
  };

  // CHANGE: Updated playback controls to manage components directly
  private readonly togglePlayback = () => {
    // We need an AudioContext to be created by user action
    synth.activeAudioContext()?.resume();

    if (this.isPlaying) {
      this.midiBuffer.pause();
      this.timingCallbacks?.pause();
      this.playPauseButton.innerHTML = '▶';
      this.playPauseButton.setAttribute('aria-label', 'Play');
      togglePlayingHighlight(this.el)(false);
    } else {
      this.midiBuffer.start();
      this.timingCallbacks?.start();
      this.playPauseButton.innerHTML = '❚❚';
      this.playPauseButton.setAttribute('aria-label', 'Pause');
      togglePlayingHighlight(this.el)(true);
    }
    this.isPlaying = !this.isPlaying;
  };

  // start again at the begining of the tune
  private readonly restartPlayback = () => {
    this.timingCallbacks?.stop();
    this.midiBuffer.stop();
    // After stopping, we can immediately start again for a seamless restart
    if (this.isPlaying) {
        this.timingCallbacks?.start();
        this.midiBuffer.start();
    } else {
        // If it was paused, just reset the cursor to the beginning
        this.timingCallbacks?.reset();
    }
  };

  private readonly handleElementClick = async (abcElem: any, tuneNumber: number, classes: string, analysis: any, drag: any) => {
    const updatedSource = await this.noteEditor.handleNoteDrag(abcElem, drag);
    
    if (updatedSource) {
      // Re-render with the updated source
      this.reRender();
    }
  };

  private async updateFileWithSource(abcSource: string) {
    if (!this.ctx) return;
    
    const sectionInfo = this.ctx.getSectionInfo(this.el);
    if (!sectionInfo) return;

    const { lineStart } = sectionInfo;
    const sourcePath = (this.ctx as any).sourcePath;
    if (!sourcePath) return;

    const app = (window as any).app;
    const file = app.vault.getAbstractFileByPath(sourcePath);
    if (!file) return;

    try {
      const content = await app.vault.read(file);
      const lines = content.split('\n');
      
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
        const beforeBlock = lines.slice(0, codeBlockStart + 1);
        const afterBlock = lines.slice(codeBlockEnd);
        
        const newLines = [
          ...beforeBlock,
          abcSource,
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
    const abcSource = this.noteEditor.getSource();
    
    // Update dragging state based on source
    this.draggingEnabled = abcSource.includes('%%allowDrag');
    
    const { userOptions } = this.parseOptionsAndSource();
    const options = { 
      ...DEFAULT_OPTIONS, 
      ...userOptions,
      dragging: this.draggingEnabled,
      clickListener: this.handleElementClick
    };
    
    // Clear existing SVG only (preserve buttons and checkbox)
    const svg = this.el.querySelector('svg');
    if (svg) svg.remove();
    
    // Find where to insert the new SVG (before the buttons container)
    const buttonsContainer = this.el.querySelector('.abcjs-controls');
    
    // Create a temporary container for rendering
    const tempDiv = document.createElement('div');
    const renderResp = renderAbc(tempDiv, abcSource, options);
    
    // Move the SVG to the correct position
    const newSvg = tempDiv.querySelector('svg');
    if (newSvg && buttonsContainer) {
      this.el.insertBefore(newSvg, buttonsContainer);
    }
    
    // Restore checkbox state from source
    if (this.draggingCheckbox) {
      this.draggingCheckbox.checked = this.draggingEnabled;
    }
    
    this.visualObj = renderResp[0];
    
    // Re-extract tune metrics
    if (this.visualObj) {
      this.beatsPerMeasure = this.visualObj.getBeatsPerMeasure();
      this.totalBeats = this.visualObj.getTotalBeats();
    }
    
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
      // Create animation options for the new visual object
      const animationOptions: AnimationOptions = {
        eventCallback: (event: any) => {
          if (event && event.measureStart && event.left === null) return undefined;
          
          const selected = Array.from(this.el.querySelectorAll(".abcjs-highlight"));
          selected.forEach(el => el.classList.remove("abcjs-highlight"));
          
          if (event && event.elements) {
            event.elements.flat().forEach((el: Element) => el.classList.add("abcjs-highlight"));
          }
          return undefined;
        },
        beatCallback: (beatNumber: number, totalBeats: number, totalTime: number) => {
          // Beat callback for potential future use
        }
      };
      
      this.midiBuffer.init({ visualObj: this.visualObj, options: finalAudioParams })
        .then(() => {
            // Re-initialize timing callbacks with the new visual object
            this.timingCallbacks = new TimingCallbacks(this.visualObj!, animationOptions);
            return this.midiBuffer.prime();
        })
        .catch(console.warn.bind(console));
    }
  }
}