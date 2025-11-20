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
  private loopCheckbox: HTMLInputElement;
  private loopStartInput: HTMLInputElement;
  private loopEndInput: HTMLInputElement;
  private isPlaying: boolean = false;
  private draggingEnabled: boolean = false;
  private loopEnabled: boolean = false;
  private selectedNoteStartTime: number | null = null;

  private beatsPerMeasure: number = 4;
  private totalBeats: number = 0;
  private totalMeasures: number = 0;
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
    
    // Extract tune metrics and ensure timings are calculated
    if (this.visualObj) {
      // Ensure timing information is calculated
      this.visualObj.setTiming();
      
      this.beatsPerMeasure = this.visualObj.getBeatsPerMeasure();
      this.totalBeats = this.visualObj.getTotalBeats();
      this.totalMeasures = Math.ceil(this.totalBeats / this.beatsPerMeasure);
      
      console.log('Tune loaded with', this.visualObj.lines?.length, 'lines');
      console.log('Total time:', this.visualObj.getTotalTime(), 'seconds');
      console.log('Total measures:', this.totalMeasures);
    }
    
    this.addPlaybackButtons();
    this.addDraggingAndLoopToggles();
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
        // Check if loop is enabled and we need to loop back
        if (!this.loopEnabled || !this.loopStartInput || !this.loopEndInput) return;
        
        const loopStart = parseInt(this.loopStartInput.value);
        const loopEnd = parseInt(this.loopEndInput.value);
        
        if (isNaN(loopStart) || isNaN(loopEnd) || loopStart < 1 || loopEnd < loopStart) return;
        
        // Calculate the beat number for loop end
        const loopEndBeat = loopEnd * this.beatsPerMeasure;
        
        // If we've reached or passed the loop end, jump back to loop start
        if (beatNumber >= loopEndBeat) {
          const loopStartBeat = (loopStart - 1) * this.beatsPerMeasure;
          const totalTimeMs = (this.visualObj?.getTotalTime() || 0) * 1000;
          
          if (totalTimeMs > 0 && this.timingCallbacks && this.timingCallbacks.noteTimings) {
            // Find the timing for the loop start beat
            const startTiming = this.timingCallbacks.noteTimings.find(
              timing => timing.measureStart && timing.measureNumber === loopStart
            );
            
            if (startTiming) {
              const startPosition = startTiming.milliseconds / totalTimeMs;
              console.log(`Looping: beat ${beatNumber} -> measure ${loopStart} (${startTiming.milliseconds}ms, ${(startPosition * 100).toFixed(1)}%)`);
              
              this.midiBuffer.seek(startPosition);
              this.timingCallbacks.setProgress(startPosition);
            }
          }
        }
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

  private addDraggingAndLoopToggles() {
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
    
    // Loop checkbox
    const loopContainer = toggleContainer.createDiv({ cls: 'control-group' });
    this.loopCheckbox = loopContainer.createEl('input', { type: 'checkbox' });
    this.loopCheckbox.id = `loop-toggle-${Math.random().toString(36).substr(2, 9)}`;
    this.loopCheckbox.checked = this.loopEnabled;
    this.loopCheckbox.addEventListener('change', this.toggleLoop);
    
    const loopLabel = loopContainer.createEl('label');
    loopLabel.setAttribute('for', this.loopCheckbox.id);
    loopLabel.setText('Loop');
    
    // Loop Start input
    const loopStartContainer = toggleContainer.createDiv({ cls: 'control-group' });
    const lsLabel = loopStartContainer.createEl('label');
    lsLabel.setText('LS:');
    this.loopStartInput = loopStartContainer.createEl('input', { type: 'number' });
    this.loopStartInput.setAttribute('min', '1');
    if (this.totalMeasures > 0) {
      this.loopStartInput.setAttribute('max', this.totalMeasures.toString());
    }
    this.loopStartInput.setAttribute('placeholder', '1');
    this.loopStartInput.style.width = '50px';
    
    // Loop End input
    const loopEndContainer = toggleContainer.createDiv({ cls: 'control-group' });
    const leLabel = loopEndContainer.createEl('label');
    leLabel.setText('LE:');
    this.loopEndInput = loopEndContainer.createEl('input', { type: 'number' });
    this.loopEndInput.setAttribute('min', '1');
    if (this.totalMeasures > 0) {
      this.loopEndInput.setAttribute('max', this.totalMeasures.toString());
    }
    this.loopEndInput.setAttribute('placeholder', String(this.totalMeasures));
    this.loopEndInput.style.width = '50px';
  }

  private readonly toggleLoop = () => {
    this.loopEnabled = this.loopCheckbox.checked;
    console.log('Loop', this.loopEnabled ? 'enabled' : 'disabled');
  };

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
      // Start playback components first
      this.midiBuffer.start();
      this.timingCallbacks?.start();
      
      // If a note is selected, seek to that position immediately after starting
      if (this.selectedNoteStartTime !== null && this.visualObj) {
        const totalTimeMs = (this.visualObj.getTotalTime() || 0) * 1000;
        
        if (totalTimeMs > 0) {
          // Calculate position as percentage (0-1)
          const startPosition = this.selectedNoteStartTime / totalTimeMs;
          
          console.log(`Seeking to ${this.selectedNoteStartTime}ms (${(startPosition * 100).toFixed(1)}% of ${totalTimeMs}ms)`);
          
          // Seek both audio and visual
          this.midiBuffer.seek(startPosition);
          this.timingCallbacks?.setProgress(startPosition);
        }
        
        // Clear the selection after starting
        this.selectedNoteStartTime = null;
        const previousSelected = this.el.querySelector('.abcjs-selected-note');
        if (previousSelected) {
          previousSelected.classList.remove('abcjs-selected-note');
        }
      }
      
      this.playPauseButton.innerHTML = '❚❚';
      this.playPauseButton.setAttribute('aria-label', 'Pause');
      togglePlayingHighlight(this.el)(true);
    }
    this.isPlaying = !this.isPlaying;
  };

  // start again at the begining of the tune
  private readonly restartPlayback = () => {
    // Clear any selected note
    this.selectedNoteStartTime = null;
    const previousSelected = this.el.querySelector('.abcjs-selected-note');
    if (previousSelected) {
      previousSelected.classList.remove('abcjs-selected-note');
    }
    
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
    // If dragging is enabled and drag occurred, handle note dragging
    if (this.draggingEnabled && drag && drag.step !== 0) {
      const updatedSource = await this.noteEditor.handleNoteDrag(abcElem, drag);
      
      if (updatedSource) {
        // Re-render with the updated source
        this.reRender();
      }
      return;
    }
    
    // Handle note selection for playback (only when not playing)
    if (!this.isPlaying && abcElem && (abcElem.el_type === 'note' || abcElem.el_type === 'rest')) {
      console.log('Clicked element:', abcElem.el_type, 'at startChar:', abcElem.startChar);
      
      // Get timing information from the visualObj
      if (!this.visualObj) {
        console.warn('No visualObj available');
        return;
      }
      
      // Access noteTimings from the TimingCallbacks instance
      if (!this.timingCallbacks || !this.timingCallbacks.noteTimings) {
        console.warn('No timing information available');
        return;
      }
      
      // Find the timing info for the clicked element using startChar
      const noteTiming = this.timingCallbacks.noteTimings.find(
        timing => timing && timing.startChar === abcElem.startChar
      );
      
      console.log('Found timing:', noteTiming);
      
      if (noteTiming && noteTiming.milliseconds != null) {
        this.selectedNoteStartTime = noteTiming.milliseconds;
        
        // Visual feedback: highlight the selected note
        const previousSelected = this.el.querySelector('.abcjs-selected-note');
        if (previousSelected) {
          previousSelected.classList.remove('abcjs-selected-note');
        }
        
        if (abcElem.abselem && abcElem.abselem.elemset) {
          abcElem.abselem.elemset.forEach((elem: SVGElement) => {
            elem.classList.add('abcjs-selected-note');
          });
        }
        
        console.log(`Note selected at ${this.selectedNoteStartTime}ms for playback`);
      } else {
        console.warn('Could not find timing for startChar:', abcElem.startChar);
      }
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
    
    // Re-extract tune metrics and ensure timings are calculated
    if (this.visualObj) {
      // Ensure timing information is calculated
      this.visualObj.setTiming();
      
      this.beatsPerMeasure = this.visualObj.getBeatsPerMeasure();
      this.totalBeats = this.visualObj.getTotalBeats();
      this.totalMeasures = Math.ceil(this.totalBeats / this.beatsPerMeasure);
      
      // Update loop input max values
      if (this.loopStartInput && this.totalMeasures > 0) {
        this.loopStartInput.setAttribute('max', this.totalMeasures.toString());
      }
      if (this.loopEndInput && this.totalMeasures > 0) {
        this.loopEndInput.setAttribute('max', this.totalMeasures.toString());
        this.loopEndInput.setAttribute('placeholder', String(this.totalMeasures));
      }
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
          // Check if loop is enabled and we need to loop back
          if (!this.loopEnabled || !this.loopStartInput || !this.loopEndInput) return;
          
          const loopStart = parseInt(this.loopStartInput.value);
          const loopEnd = parseInt(this.loopEndInput.value);
          
          if (isNaN(loopStart) || isNaN(loopEnd) || loopStart < 1 || loopEnd < loopStart) return;
          
          // Calculate the beat number for loop end
          const loopEndBeat = loopEnd * this.beatsPerMeasure;
          
          // If we've reached or passed the loop end, jump back to loop start
          if (beatNumber >= loopEndBeat) {
            const loopStartBeat = (loopStart - 1) * this.beatsPerMeasure;
            const totalTimeMs = (this.visualObj?.getTotalTime() || 0) * 1000;
            
            if (totalTimeMs > 0 && this.timingCallbacks && this.timingCallbacks.noteTimings) {
              // Find the timing for the loop start beat
              const startTiming = this.timingCallbacks.noteTimings.find(
                timing => timing.measureStart && timing.measureNumber === loopStart
              );
              
              if (startTiming) {
                const startPosition = startTiming.milliseconds / totalTimeMs;
                console.log(`Looping: beat ${beatNumber} -> measure ${loopStart} (${startTiming.milliseconds}ms, ${(startPosition * 100).toFixed(1)}%)`);
                
                this.midiBuffer.seek(startPosition);
                this.timingCallbacks.setProgress(startPosition);
              }
            }
          }
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