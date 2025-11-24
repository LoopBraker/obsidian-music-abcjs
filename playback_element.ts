import { MidiBuffer, TuneObject, renderAbc, synth, SynthOptions, TimingCallbacks, AnimationOptions } from 'abcjs';
import { MarkdownRenderChild, MarkdownPostProcessorContext, App } from 'obsidian';
import { AUDIO_PARAMS, DEFAULT_OPTIONS, OPTIONS_REGEX, PLAYBACK_CONTROLS_ID, getSynthInitOptions } from './cfg';
import { NoteHighlighter, togglePlayingHighlight } from './note_highlighter';
import { NoteEditor } from './note_editor';
import { AbcEditorView, ABC_EDITOR_VIEW_TYPE } from './editor_view';
import { globalAbcState } from './global_state';

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
  private editorButton: HTMLButtonElement;

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
  private sheetWrapper: HTMLElement | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;

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
    
    // 1. Create the wrapper
    this.sheetWrapper = document.createElement('div');
    this.sheetWrapper.addClass('abcjs-sheet-wrapper');
    
    // 2. Add playback buttons first (they'll appear at the top)
    this.addPlaybackButtons();
    
    // 3. CRITICAL FIX: Append wrapper to DOM *BEFORE* rendering
    // abcjs needs the element to be in the DOM to calculate width/height
    // for generating selectable SVG paths (elemset). Rendering into a detached
    // div (not yet appended) results in 0 width and empty elemset arrays.
    this.el.appendChild(this.sheetWrapper);
    
    // 4. Now render into the attached wrapper
    const options = { 
      ...DEFAULT_OPTIONS, 
      ...userOptions,
      dragging: this.draggingEnabled,
      add_classes: true,
      clickListener: this.handleElementClick
    };
    const renderResp = renderAbc(this.sheetWrapper, source, options);
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
    
    // 5. Add remaining controls (they'll appear at the bottom)
    this.addDraggingAndLoopToggles();
    
    this.enableAudioPlayback(this.visualObj);
    
    // 6. Reconnect editor to this new live instance
    // When a file is edited, Obsidian destroys the old PlaybackElement and creates a new one.
    // The editor view still has callbacks pointing to the old (dead) instance, causing
    // highlighting to fail. This ensures the editor always talks to the living instance.
    this.updateEditorCallbacks();
    
    // 7. Check if we need to reopen the editor after a file write
    const preserve = globalAbcState.getPreserveEditor();
    const sourcePath = (this.ctx as any)?.sourcePath;
    const lineStart = this.ctx?.getSectionInfo(this.el)?.lineStart;
    
    if (preserve && preserve.path === sourcePath && preserve.lineStart === lineStart) {
      // This block was just reloaded after removing %%allowDrag
      // Reopen the editor programmatically
      globalAbcState.clearPreserveEditor();
      this.openEditorProgrammatically(preserve.source);
    }
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
  async onunload() {
    this.abortController.abort(); // dom event listeners

    // CHANGE: Stop our own components directly
    this.timingCallbacks?.stop();
    this.midiBuffer.stop();
    
    // Clear any pending save
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    
    // If this block has the editor open, save its content before unloading
    const app = (window as any).app as App;
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    if (leaves.length > 0 && globalAbcState.isActiveEditor(this)) {
      const currentSource = this.noteEditor.getSource();
      await this.updateFileWithSource(currentSource);
    }
    
    // Clear this block from global state
    globalAbcState.clearBlock(this);
    
    // Check if we should preserve the editor across this unload
    const preserve = globalAbcState.getPreserveEditor();
    const sourcePath = (this.ctx as any)?.sourcePath;
    const lineStart = this.ctx?.getSectionInfo(this.el)?.lineStart;
    const isPreserveForThis = preserve && preserve.path === sourcePath && preserve.lineStart === lineStart;
    
    if (!isPreserveForThis && leaves.length > 0) {
      // Normal unload - close the editor
      leaves[0].detach();
    }
    // else: We're being unloaded because of an intentional file write.
    // Keep the editor open. The new instance will reattach to it in onload.
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

    // Get plugin settings for soundFont
    const app = (window as any).app as any;
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    const soundFont = plugin?.settings?.soundFont || 'MusyngKite';

    const finalAudioParams: SynthOptions = { ...AUDIO_PARAMS, ...audioParamsFromUser, ...getSynthInitOptions(soundFont) };

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
        
        let loopStart = parseInt(this.loopStartInput.value);
        const loopEnd = parseInt(this.loopEndInput.value);
        
        if (isNaN(loopStart) || isNaN(loopEnd) || loopStart < 1 || loopEnd < loopStart) return;
        
        // Subtract 1 from user's LS input
        loopStart = loopStart - 1;
        
        // Adjust loop values: user inputs measure numbers, we need to subtract 1
        // So if user wants to loop measures 2-3, we calculate as if they entered 1-2
        const adjustedLoopStart = loopStart - 1;
        const adjustedLoopEnd = loopEnd - 1;
        
        // Calculate the beat number for loop end
        const loopEndBeat = (adjustedLoopEnd + 1) * this.beatsPerMeasure;
        
        // If we've reached the end of the LE measure, jump back to loop start
        if (beatNumber >= loopEndBeat) {
          const totalTimeMs = (this.visualObj?.getTotalTime() || 0) * 1000;
          
          if (totalTimeMs > 0 && this.timingCallbacks && this.timingCallbacks.noteTimings) {
            // Find the timing for the first note/event in the loop start measure
            // Use the original loopStart (user's measure number)
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

    this.editorButton = buttonContainer.createEl('button');
    this.editorButton.innerHTML = '✏️';
    this.editorButton.setAttribute('aria-label', 'Editor');
    this.editorButton.addEventListener('click', this.toggleEditor);
    
    // Update editor button state based on whether editor is open
    this.updateEditorButtonState();
  }
  
  private updateEditorButtonState(): void {
    // Only highlight the button if THIS block has the editor open
    const isThisBlockActive = globalAbcState.isActiveEditor(this);
    
    if (isThisBlockActive && this.editorButton) {
      this.editorButton.style.backgroundColor = 'var(--interactive-accent)';
      this.editorButton.style.color = 'var(--text-on-accent)';
    } else if (this.editorButton) {
      this.editorButton.style.backgroundColor = '';
      this.editorButton.style.color = '';
    }
  }
  


  private addDraggingAndLoopToggles() {
    // Create wrapper container for all bottom controls
    const bottomControlsWrapper = this.el.createDiv({ cls: 'abcjs-bottom-controls-wrapper' });
    
    // Dragging controls container
    const draggingContainer = bottomControlsWrapper.createDiv({ cls: 'abcjs-bottom-controls' });
    const dragContainer = draggingContainer.createDiv({ cls: 'control-group' });
    this.draggingCheckbox = dragContainer.createEl('input', { type: 'checkbox' });
    this.draggingCheckbox.id = `drag-toggle-${Math.random().toString(36).substr(2, 9)}`;
    this.draggingCheckbox.checked = this.draggingEnabled;
    this.draggingCheckbox.addEventListener('change', () => this.toggleDragging(true));
    
    const dragLabel = dragContainer.createEl('label');
    dragLabel.setAttribute('for', this.draggingCheckbox.id);
    dragLabel.setText('Dragging');
    
    // Loop controls container (separate box)
    const loopContainer = bottomControlsWrapper.createDiv({ cls: 'abcjs-bottom-controls' });
    
    // Loop checkbox
    const loopCheckboxContainer = loopContainer.createDiv({ cls: 'control-group' });
    this.loopCheckbox = loopCheckboxContainer.createEl('input', { type: 'checkbox' });
    this.loopCheckbox.id = `loop-toggle-${Math.random().toString(36).substr(2, 9)}`;
    this.loopCheckbox.checked = this.loopEnabled;
    this.loopCheckbox.addEventListener('change', this.toggleLoop);
    
    const loopLabel = loopCheckboxContainer.createEl('label');
    loopLabel.setAttribute('for', this.loopCheckbox.id);
    loopLabel.setText('Loop');
    
    // Loop Start input
    const loopStartContainer = loopContainer.createDiv({ cls: 'control-group' });
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
    const loopEndContainer = loopContainer.createDiv({ cls: 'control-group' });
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

  private readonly toggleEditor = async () => {
    const app = (window as any).app as App;
    
    // Check if editor view is already open
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    
    if (leaves.length > 0) {
      // Editor is open - save content before closing
      const currentSource = this.noteEditor.getSource();
      await this.updateFileWithSource(currentSource);
      
      leaves[0].detach();
      
      // Update button visual state
      this.editorButton.style.backgroundColor = '';
      this.editorButton.style.color = '';
      
      // Clear from global state
      globalAbcState.setActiveEditor(null);
    } else {
      // Store whether we need to clean up dragging
      const hadDraggingEnabled = this.draggingEnabled;
      
      // FIRST: If THIS block has dragging enabled, disable it synchronously (but don't save yet)
      if (this.draggingEnabled) {
        this.draggingCheckbox.checked = false;
        this.draggingEnabled = false;
        globalAbcState.setActiveDragging(null);
      }
      
      // Register this block as having the active editor
      // This will close any other editor that might be open
      globalAbcState.setActiveEditor(this);
      
      // THEN: Open the editor
      const leaf = app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: ABC_EDITOR_VIEW_TYPE,
        active: true,
      });
      
      // Get the view and set content
      const leaves2 = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
      if (leaves2.length > 0) {
        const view = leaves2[0].view as AbcEditorView;
        
        // If dragging was enabled, clean the source BEFORE setting content
        let sourceToSet = this.noteEditor.getSource();
        if (hadDraggingEnabled && sourceToSet.includes('%%allowDrag')) {
          sourceToSet = sourceToSet.replace(/%%allowDrag\n?/g, '');
          this.noteEditor.setSource(sourceToSet);
        }
        
        view.setContent(
          sourceToSet,
          async (newSource: string) => {
            // Update internal state and live preview
            this.noteEditor.setSource(newSource);
            this.reRender();
          },
          async (newSource: string) => {
            // Save to file (called on editor close or reload)
            this.noteEditor.setSource(newSource);
            await this.updateFileWithSource(newSource);
          },
          (startChar: number, endChar: number) => {
            // Selection in editor: highlight notes in sheet
            this.highlightNotesInRange(startChar, endChar);
          }
        );
        
        // Reveal the leaf (bring it to front)
        app.workspace.revealLeaf(leaves2[0]);
        
        // Update button visual state IMMEDIATELY
        this.editorButton.style.backgroundColor = 'var(--interactive-accent)';
        this.editorButton.style.color = 'var(--text-on-accent)';
        
        // If we had dragging enabled, we need to save the cleaned source to file
        // Set preserve flag so the new instance reopens the editor after reload
        if (hadDraggingEnabled) {
          const sourcePath = (this.ctx as any).sourcePath;
          const sectionInfo = this.ctx?.getSectionInfo(this.el);
          const lineStart = sectionInfo?.lineStart ?? -1;
          
          // Tell global state to preserve the editor across the file write
          globalAbcState.setPreserveEditor({
            path: sourcePath,
            lineStart: lineStart,
            source: sourceToSet
          });
          
          // Now save to file - this will cause Obsidian to reload the block
          await this.updateFileWithSource(sourceToSet);
          
          // Set timeout fallback to clear flag if something goes wrong
          setTimeout(() => {
            globalAbcState.clearPreserveEditor();
          }, 2000);
        }
      }
    }
  };

  private highlightNotesInRange(startChar: number, endChar: number): void {
    console.log('highlightNotesInRange called:', startChar, endChar);
    
    // Clear previous highlights
    const previousHighlights = this.el.querySelectorAll('.abcjs-editor-selected');
    previousHighlights.forEach(el => el.classList.remove('abcjs-editor-selected'));

    if (!this.visualObj) {
      console.log('No visualObj available');
      return;
    }

    let foundElements = 0;
    let highlightedElements = 0;
    
    // Iterate through visualObj to find matching elements
    for (const line of this.visualObj.lines) {
      for (const staff of line.staff) {
        for (const voice of staff.voices) {
          for (const element of voice) {
            const elem = element as any;
            if (elem.startChar !== undefined && elem.endChar !== undefined) {
              // Check if element overlaps with selection
              if (elem.startChar < endChar && elem.endChar > startChar) {
                foundElements++;
                // Highlight this element - elemset is an array
                if (elem.abselem?.elemset && elem.abselem.elemset.length > 0) {
                  for (let i = 0; i < elem.abselem.elemset.length; i++) {
                    const svgEl = elem.abselem.elemset[i] as SVGElement;
                    if (svgEl && svgEl.classList) {
                      svgEl.classList.add('abcjs-editor-selected');
                      highlightedElements++;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log('Found elements:', foundElements, 'Highlighted SVG elements:', highlightedElements);
  }

  private updateEditorCallbacks(): void {
    const app = (window as any).app as App;
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    
    if (leaves.length > 0) {
      const view = leaves[0].view as AbcEditorView;
      console.log('Updating editor callbacks after re-render');
      // Update callbacks without touching content (preserves cursor position)
      view.updateCallbacks(
        async (newSource: string) => {
          // 1. Update internal state
          this.noteEditor.setSource(newSource);
          
          // 2. Visual update IMMEDIATELY
          this.reRender();
          
          // 3. DO NOT save to file while editing - only save when editor closes
          // This prevents constant reloads while typing
        },
        (startChar: number, endChar: number) => {
          // Selection in editor: highlight notes in sheet
          console.log('Selection callback triggered:', startChar, endChar);
          this.highlightNotesInRange(startChar, endChar);
        }
      );
    }
  }

  private readonly toggleDragging = async (saveToFile: boolean = true) => {
    this.draggingEnabled = this.draggingCheckbox.checked;
    
    // NEW: If enabling dragging, close the editor if it's open
    if (this.draggingEnabled) {
      // Register this block as having dragging enabled
      // This will disable dragging on any other block
      globalAbcState.setActiveDragging(this);
      
      const app = (window as any).app as App;
      const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
      
      if (leaves.length > 0) {
        // Close the editor
        leaves[0].detach();
        
        // Update editor button visual state
        this.editorButton.style.backgroundColor = '';
        this.editorButton.style.color = '';
        
        // Clear from global state
        globalAbcState.setActiveEditor(null);
      }
    } else {
      // Clear from global state when disabling
      globalAbcState.setActiveDragging(null);
    }
    
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
    
    // Only save to file if requested (avoid triggering reload when called from toggleEditor)
    if (saveToFile) {
      await this.updateFileWithSource(currentSource);
    }
    
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
    
    // Handle note/element clicks
    if (abcElem && (abcElem.el_type === 'note' || abcElem.el_type === 'rest')) {
      console.log('Clicked element:', abcElem.el_type, 'at startChar:', abcElem.startChar, 'endChar:', abcElem.endChar);
      
      // ALWAYS highlight in editor if open (regardless of playing state)
      // Check for valid character positions (abcjs sometimes returns -1 for elements without source position)
      if (abcElem.startChar !== undefined && abcElem.startChar >= 0 && abcElem.endChar !== undefined) {
        const app = (window as any).app as App;
        const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
        console.log('Found editor leaves:', leaves.length);
        
        if (leaves.length > 0) {
          const view = leaves[0].view as AbcEditorView;
          console.log('Editor view found, calling highlightRange');
          view.highlightRange(abcElem.startChar, abcElem.endChar);
        } else {
          console.log('No editor view open');
        }
      } else {
        console.log('Invalid character positions:', {
          startChar: abcElem.startChar,
          endChar: abcElem.endChar,
          startDefined: abcElem.startChar !== undefined,
          startValid: abcElem.startChar >= 0,
          endDefined: abcElem.endChar !== undefined
        });
      }
      
      // NEW FEATURE: Play the note sound when clicked (even when paused)
      // This provides immediate audio feedback for any clicked note
      if (abcElem.midiPitches && abcElem.midiPitches.length > 0) {
        // Ensure audio context is active (required for web audio)
        synth.activeAudioContext()?.resume();
        
        // Calculate tempo from visualObj for accurate note duration
        const tempo = this.visualObj?.getBpm() || 120;
        const millisecondsPerMeasure = (60000 * this.beatsPerMeasure) / tempo;
        
        // Play the clicked note with synth.playEvent
        synth.playEvent(
          abcElem.midiPitches,
          abcElem.midiGraceNotePitches,
          millisecondsPerMeasure
        ).then(() => {
          console.log('Note played:', abcElem.midiPitches);
        }).catch((error: any) => {
          console.warn('Error playing note:', error);
        });
      }
      
      // Handle note selection for playback (only when not playing)
      if (!this.isPlaying) {
        
        // Get timing information from the visualObj for playback
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
    
    // CRITICAL FIX: Reuse the existing wrapper instead of destroying it
    // abcjs handles clearing the innerHTML automatically during render
    // Removing and recreating causes a race condition where the browser hasn't
    // finished layout calculations, leading to empty elemset arrays
    if (!this.sheetWrapper) {
      // Only create on first render
      this.sheetWrapper = document.createElement('div');
      this.sheetWrapper.addClass('abcjs-sheet-wrapper');
      
      const buttonsContainer = this.el.querySelector('.abcjs-controls');
      if (buttonsContainer) {
        this.el.insertBefore(this.sheetWrapper, buttonsContainer);
      } else {
        this.el.appendChild(this.sheetWrapper);
      }
    }
    
    // Create fresh options with clickListener to force elemset population
    // Use a new object to ensure abcjs doesn't carry over stale state
    const options = { 
      ...DEFAULT_OPTIONS, 
      ...userOptions,
      dragging: this.draggingEnabled,
      add_classes: true,
      clickListener: this.handleElementClick
    };
    
    // Render into the STABLE container
    // renderAbc will automatically clear the contents of sheetWrapper
    const renderResp = renderAbc(this.sheetWrapper, abcSource, options);
    
    // Restore checkbox state from source
    if (this.draggingCheckbox) {
      this.draggingCheckbox.checked = this.draggingEnabled;
    }
    
    this.visualObj = renderResp[0];
    
    // Re-extract tune metrics and ensure timings are calculated FIRST
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
      
      // Now that visualObj is ready with timing, update editor button and callbacks
      this.updateEditorButtonState();
      this.updateEditorCallbacks();
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
          
          let loopStart = parseInt(this.loopStartInput.value);
          const loopEnd = parseInt(this.loopEndInput.value);
          
          if (isNaN(loopStart) || isNaN(loopEnd) || loopStart < 1 || loopEnd < loopStart) return;
          
          // Subtract 1 from user's LS input
          loopStart = loopStart - 1;
          
          // Adjust loop values: user inputs measure numbers, we need to subtract 1
          // So if user wants to loop measures 2-3, we calculate as if they entered 1-2
          const adjustedLoopStart = loopStart - 1;
          const adjustedLoopEnd = loopEnd - 1;
          
          // Calculate the beat number for loop end
          const loopEndBeat = (adjustedLoopEnd + 1) * this.beatsPerMeasure;
          
          // If we've reached the end of the LE measure, jump back to loop start
          if (beatNumber >= loopEndBeat) {
            const totalTimeMs = (this.visualObj?.getTotalTime() || 0) * 1000;
            
            if (totalTimeMs > 0 && this.timingCallbacks && this.timingCallbacks.noteTimings) {
              // Find the timing for the first note/event in the loop start measure
              // Use the original loopStart (user's measure number)
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
  
  /**
   * Public methods called by global state manager
   */
  
  public async closeEditor(): Promise<void> {
    // Save current editor content to file before closing
    const currentSource = this.noteEditor.getSource();
    await this.updateFileWithSource(currentSource);
    
    // Now close the editor
    this.closeEditorSilently();
  }

  public closeEditorSilently(): void {
    const app = (window as any).app as App;
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    
    if (leaves.length > 0) {
      leaves[0].detach();
    }
    
    // Update button visual state
    if (this.editorButton) {
      this.editorButton.style.backgroundColor = '';
      this.editorButton.style.color = '';
    }
  }
  
  public disableDraggingSilently(): void {
    if (!this.draggingEnabled) return;
    
    this.draggingEnabled = false;
    
    if (this.draggingCheckbox) {
      this.draggingCheckbox.checked = false;
    }
    
    let currentSource = this.noteEditor.getSource();
    // Remove %%allowDrag directive
    currentSource = currentSource.replace(/%%allowDrag\n?/g, '');
    
    // Update the source in noteEditor
    this.noteEditor.setSource(currentSource);
    
    // Don't save to file to avoid triggering reload
    // The user's action on another block will handle the save
    
    this.reRender();
  }
  
  private async openEditorProgrammatically(sourceToSet: string): Promise<void> {
    const app = (window as any).app as App;
    
    // Register this block as having the active editor
    globalAbcState.setActiveEditor(this);
    
    // Check if editor is already open
    let leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    
    if (leaves.length === 0) {
      // Open the editor
      const leaf = app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: ABC_EDITOR_VIEW_TYPE,
        active: true,
      });
      
      leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    }
    
    if (leaves.length > 0) {
      const view = leaves[0].view as AbcEditorView;
      view.setContent(
        sourceToSet,
        async (newSource: string) => {
          // Update internal state and live preview
          this.noteEditor.setSource(newSource);
          this.reRender();
        },
        async (newSource: string) => {
          // Save to file (called on editor close or reload)
          this.noteEditor.setSource(newSource);
          await this.updateFileWithSource(newSource);
        },
        (startChar: number, endChar: number) => {
          // Selection in editor: highlight notes in sheet
          this.highlightNotesInRange(startChar, endChar);
        }
      );
      
      // Reveal the leaf (bring it to front)
      app.workspace.revealLeaf(leaves[0]);
      
      // Update button visual state
      if (this.editorButton) {
        this.editorButton.style.backgroundColor = 'var(--interactive-accent)';
        this.editorButton.style.color = 'var(--text-on-accent)';
      }
    }
  }
}