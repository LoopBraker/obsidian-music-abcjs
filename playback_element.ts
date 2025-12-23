import { MidiBuffer, TuneObject, renderAbc, synth, SynthOptions, TimingCallbacks, AnimationOptions } from 'abcjs';
import { MarkdownRenderChild, MarkdownPostProcessorContext, App } from 'obsidian';
import { AUDIO_PARAMS, DEFAULT_OPTIONS, OPTIONS_REGEX, PLAYBACK_CONTROLS_ID, getSynthInitOptions } from './cfg';
import { NoteHighlighter, togglePlayingHighlight } from './note_highlighter';
import { NoteEditor } from './note_editor';
import { AbcEditorView, ABC_EDITOR_VIEW_TYPE } from './editor_view';
import { globalAbcState } from './global_state';

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
    super(el);
  }

  onload() {
    const { userOptions, source } = this.parseOptionsAndSource();
    this.noteEditor = new NoteEditor(source, this.ctx, this.el);
    this.draggingEnabled = source.includes('%%allowDrag');

    this.sheetWrapper = document.createElement('div');
    this.sheetWrapper.addClass('abcjs-sheet-wrapper');

    this.addPlaybackButtons();
    this.el.appendChild(this.sheetWrapper);

    const options = {
      ...DEFAULT_OPTIONS,
      ...userOptions,
      dragging: this.draggingEnabled,
      add_classes: true,
      clickListener: this.handleElementClick
    };
    const renderResp = renderAbc(this.sheetWrapper, source, options);
    this.visualObj = renderResp[0];

    if (this.visualObj) {
      this.visualObj.setTiming();
      this.beatsPerMeasure = this.visualObj.getBeatsPerMeasure();
      this.totalBeats = this.visualObj.getTotalBeats();
      this.totalMeasures = Math.ceil(this.totalBeats / this.beatsPerMeasure);
    }

    this.addDraggingAndLoopToggles();
    this.enableAudioPlayback(this.visualObj);
    this.updateEditorCallbacks();

    // Check if we need to reopen the editor after a file write (reload)
    const preserve = globalAbcState.getPreserveEditor();
    const sourcePath = (this.ctx as any)?.sourcePath;
    const lineStart = this.ctx?.getSectionInfo(this.el)?.lineStart;

    if (preserve && preserve.path === sourcePath && preserve.lineStart === lineStart) {
      globalAbcState.clearPreserveEditor();
      this.openEditorProgrammatically(preserve.source);
    }
  }

  async onunload() {
    this.abortController.abort();
    this.timingCallbacks?.stop();
    this.midiBuffer.stop();

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }

    const app = (window as any).app as App;
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);

    // Clear this block from global state
    globalAbcState.clearBlock(this);

    // CRITICAL: Check if we are reloading because of a save we initiated
    const preserve = globalAbcState.getPreserveEditor();
    const sourcePath = (this.ctx as any)?.sourcePath;
    const lineStart = this.ctx?.getSectionInfo(this.el)?.lineStart;

    // Only close the editor if this is NOT a "preserve" reload
    const isPreserveForThis = preserve && preserve.path === sourcePath && preserve.lineStart === lineStart;

    if (!isPreserveForThis && leaves.length > 0 && globalAbcState.isActiveEditor(this)) {
      leaves[0].detach();
    }
  }

  // --- HELPER TO HANDLE AUTO-SAVE WITHOUT CLOSING EDITOR ---
  private async saveAndPreserve(newSource: string) {
    const sourcePath = (this.ctx as any)?.sourcePath;
    const sectionInfo = this.ctx?.getSectionInfo(this.el);
    const lineStart = sectionInfo?.lineStart ?? -1;

    // 1. Set the Flag: "I am about to reload the plugin, please keep editor open"
    globalAbcState.setPreserveEditor({
      path: sourcePath,
      lineStart: lineStart,
      source: newSource
    });

    // 2. Update Internal State
    this.noteEditor.setSource(newSource);

    // 3. Write to File (Triggers Reload)
    await this.updateFileWithSource(newSource);
  }

  private readonly toggleEditor = async () => {
    const app = (window as any).app as App;
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);

    if (leaves.length > 0) {
      // Closing manually -> Just save and close
      const currentSource = this.noteEditor.getSource();
      await this.updateFileWithSource(currentSource);
      leaves[0].detach();
      this.editorButton.style.backgroundColor = '';
      this.editorButton.style.color = '';
      globalAbcState.setActiveEditor(null);
    } else {
      if (this.draggingEnabled) {
        this.draggingCheckbox.checked = false;
        this.draggingEnabled = false;
        globalAbcState.setActiveDragging(null);
      }

      globalAbcState.setActiveEditor(this);

      const leaf = app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: ABC_EDITOR_VIEW_TYPE, active: true });

      const leaves2 = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
      if (leaves2.length > 0) {
        const view = leaves2[0].view as AbcEditorView;
        let sourceToSet = this.noteEditor.getSource();

        view.setContent(
          sourceToSet,
          async (newSource: string) => {
            // onChange (Preview Update)
            this.noteEditor.setSource(newSource);
            this.reRender();
          },
          async (newSource: string) => {
            // onSave (Auto-Save from Editor)
            await this.saveAndPreserve(newSource);
          },
          (startChar: number, endChar: number) => {
            this.highlightNotesInRange(startChar, endChar);
          }
        );

        app.workspace.revealLeaf(leaves2[0]);
        this.editorButton.style.backgroundColor = 'var(--interactive-accent)';
        this.editorButton.style.color = 'var(--text-on-accent)';
      }
    }
  };

  private updateEditorCallbacks(): void {
    const app = (window as any).app as App;
    const leaves = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);

    if (leaves.length > 0 && globalAbcState.isActiveEditor(this)) {
      const view = leaves[0].view as AbcEditorView;
      // Reattach callbacks to the existing view
      view.updateCallbacks(
        async (newSource: string) => {
          this.noteEditor.setSource(newSource);
          this.reRender();
        },
        async (newSource: string) => {
          // onSave (Auto-Save from Editor - connected to NEW block instance)
          await this.saveAndPreserve(newSource);
        },
        (startChar: number, endChar: number) => {
          this.highlightNotesInRange(startChar, endChar);
        }
      );
    }
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
        if (!event) {
          if (!this.loopEnabled) {
            this.isPlaying = false;
            this.playPauseButton.innerHTML = '▶';
            this.playPauseButton.setAttribute('aria-label', 'Play');
            togglePlayingHighlight(this.el)(false);
          }
          return undefined; // Explicitly return undefined
        }

        const selected = Array.from(this.el.querySelectorAll(".abcjs-highlight"));
        selected.forEach(el => el.classList.remove("abcjs-highlight"));

        if (event.elements) {
          event.elements.flat().forEach((el: Element) => el.classList.add("abcjs-highlight"));
        }
        return undefined; // Explicitly return undefined
      },
      beatCallback: (beatNumber: number, totalBeats: number, totalTime: number) => {
        const loop = this.getLoopTimings();
        if (!loop) return;

        // Calculate current progress as a percentage
        const currentPercent = (beatNumber / totalBeats);

        // If we've passed the end of the loop range
        if (currentPercent >= loop.endPercent) {
          this.midiBuffer.seek(loop.startPercent);
          this.timingCallbacks?.setProgress(loop.startPercent);
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

  private getLoopTimings() {
    if (!this.loopEnabled || !this.visualObj || !this.timingCallbacks?.noteTimings) return null;

    const startMeasure = parseInt(this.loopStartInput.value) - 1;
    const endMeasure = parseInt(this.loopEndInput.value) - 1;
    const totalTimeMs = (this.visualObj.getTotalTime() || 0) * 1000;

    if (isNaN(startMeasure) || isNaN(endMeasure) || startMeasure < 0 || endMeasure < startMeasure) return null;

    const startTiming = this.timingCallbacks.noteTimings.find(t => t.measureNumber === startMeasure);
    // Find the start of the measure AFTER the end measure to know when to loop back
    const endTiming = this.timingCallbacks.noteTimings.find(t => t.measureNumber === endMeasure + 1);

    if (startTiming && totalTimeMs > 0) {
      return {
        startPercent: startTiming.milliseconds / totalTimeMs,
        // If we can't find the "next" measure, we loop at the very end (percent 1.0)
        endPercent: endTiming ? endTiming.milliseconds / totalTimeMs : 1.0
      };
    }
    return null;
  }

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
    this.selectedNoteStartTime = null;

    // REMOVE THE SELECTION CLASS
    this.el.querySelectorAll('.abcjs-selected-note').forEach(e => e.classList.remove('abcjs-selected-note'));

    this.timingCallbacks?.stop();
    this.midiBuffer.stop();

    if (this.isPlaying) {
      this.timingCallbacks?.start();
      this.midiBuffer.start();
    } else {
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

      // 1. Play the note sound (Immediate feedback)
      if (abcElem.midiPitches && abcElem.midiPitches.length > 0) {
        synth.activeAudioContext()?.resume();
        const tempo = this.visualObj?.getBpm() || 120;
        const millisecondsPerMeasure = (60000 * this.beatsPerMeasure) / tempo;
        synth.playEvent(abcElem.midiPitches, abcElem.midiGraceNotePitches, millisecondsPerMeasure);
      }

      // 2. Find the timing for the clicked note
      if (this.timingCallbacks && this.timingCallbacks.noteTimings) {
        const noteTiming = this.timingCallbacks.noteTimings.find(
          timing => timing && timing.startChar === abcElem.startChar
        );

        if (noteTiming && noteTiming.milliseconds != null) {
          const totalTimeMs = (this.visualObj?.getTotalTime() || 0) * 1000;
          const seekPos = noteTiming.milliseconds / totalTimeMs;

          if (this.isPlaying) {
            // JUMP IMMEDIATELY if already playing
            this.midiBuffer.seek(seekPos);
            this.timingCallbacks.setProgress(seekPos);
          } else {
            // SAVE POSITION for next play click
            this.selectedNoteStartTime = noteTiming.milliseconds;

            // Visual feedback: clear old selection and add to new one
            this.el.querySelectorAll('.abcjs-selected-note').forEach(e => e.classList.remove('abcjs-selected-note'));
            if (abcElem.abselem?.elemset) {
              abcElem.abselem.elemset.forEach((elem: SVGElement) => elem.classList.add('abcjs-selected-note'));
            }
          }
        }
      }

      // 3. Highlight in the text editor (Keep your existing logic)
      if (abcElem.startChar !== undefined && abcElem.startChar >= 0) {
        const app = (window as any).app as App;
        const view = app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE)[0]?.view as AbcEditorView;
        if (view) view.highlightRange(abcElem.startChar, abcElem.endChar);
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
    this.draggingEnabled = abcSource.includes('%%allowDrag');
    const { userOptions } = this.parseOptionsAndSource();

    // --- 1. SAVE CURRENT STATE BEFORE WE DESTROY ANYTHING ---
    const wasPlaying = this.isPlaying;
    // Get current position in milliseconds before stopping
    const currentMs = this.timingCallbacks ? this.timingCallbacks.currentMillisecond() : 0;

    if (!this.sheetWrapper) {
      this.sheetWrapper = document.createElement('div');
      this.sheetWrapper.addClass('abcjs-sheet-wrapper');
      const buttonsContainer = this.el.querySelector('.abcjs-controls');
      if (buttonsContainer) this.el.insertBefore(this.sheetWrapper, buttonsContainer);
      else this.el.appendChild(this.sheetWrapper);
    }

    const options = {
      ...DEFAULT_OPTIONS,
      ...userOptions,
      dragging: this.draggingEnabled,
      add_classes: true,
      clickListener: this.handleElementClick
    };

    const renderResp = renderAbc(this.sheetWrapper, abcSource, options);
    this.visualObj = renderResp[0];

    if (this.visualObj) {
      this.visualObj.setTiming();
      this.beatsPerMeasure = this.visualObj.getBeatsPerMeasure();
      this.totalBeats = this.visualObj.getTotalBeats();
      this.totalMeasures = Math.ceil(this.totalBeats / this.beatsPerMeasure);

      this.updateEditorButtonState();
      this.updateEditorCallbacks();
    }

    // Update audio engine
    if (this.visualObj) {
      const { userOptions } = this.parseOptionsAndSource();
      const audioParamsFromUser: Record<string, any> = {};
      const knownAudioKeys = ['swing', 'chordsOff'];
      for (const key of knownAudioKeys) {
        if (userOptions.hasOwnProperty(key)) audioParamsFromUser[key] = userOptions[key];
      }

      const finalAudioParams: SynthOptions = { ...AUDIO_PARAMS, ...audioParamsFromUser };

      // Define animation options (using the fix from previous prompt)
      const animationOptions: AnimationOptions = {
        eventCallback: (event: any) => {
          if (!event) {
            // Hot update logic: only stop the UI if we aren't looping
            if (!this.loopEnabled) {
              this.isPlaying = false;
              this.playPauseButton.innerHTML = '▶';
              this.playPauseButton.setAttribute('aria-label', 'Play');
              togglePlayingHighlight(this.el)(false);
            }
            return undefined; // Explicitly return undefined
          }

          const selected = Array.from(this.el.querySelectorAll(".abcjs-highlight"));
          selected.forEach(el => el.classList.remove("abcjs-highlight"));

          if (event.elements) {
            event.elements.flat().forEach((el: Element) => el.classList.add("abcjs-highlight"));
          }
          return undefined; // Explicitly return undefined
        },
        beatCallback: (beatNumber: number, totalBeats: number, totalTime: number) => {
          const loop = this.getLoopTimings();
          if (!loop) return;

          // Calculate current progress as a percentage
          const currentPercent = (beatNumber / totalBeats);

          // If we've passed the end of the loop range
          if (currentPercent >= loop.endPercent) {
            this.midiBuffer.seek(loop.startPercent);
            this.timingCallbacks?.setProgress(loop.startPercent);
          }
        }
      };

      // Stop old audio/visual components before starting new ones
      this.timingCallbacks?.stop();
      this.midiBuffer.stop();

      this.midiBuffer.init({ visualObj: this.visualObj, options: finalAudioParams })
        .then(() => {
          this.timingCallbacks = new TimingCallbacks(this.visualObj!, animationOptions);
          return this.midiBuffer.prime();
        })
        .then(() => {
          // --- 2. RESTORE PLAYBACK STATE ---
          if (wasPlaying) {
            const totalTimeSec = this.visualObj?.getTotalTime() || 0;
            const seekPos = currentMs / (totalTimeSec * 1000);

            // Ensure the UI shows we are playing
            this.isPlaying = true;
            this.playPauseButton.innerHTML = '❚❚';
            togglePlayingHighlight(this.el)(true);

            // Start engine and jump to saved position
            this.midiBuffer.start();
            this.timingCallbacks?.start();

            if (seekPos > 0 && seekPos < 1) {
              this.midiBuffer.seek(seekPos);
              this.timingCallbacks?.setProgress(seekPos);
            }
          }
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