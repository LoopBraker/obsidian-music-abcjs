import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, foldGutter, foldService, foldEffect, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { solarizedLight } from 'cm6-theme-solarized-light';
import { solarizedDark } from 'cm6-theme-solarized-dark';
import { abc } from './src/abc-lang';
import { BarVisualizer } from './src/bar_visualizer';
import { ChordButtonBar } from './src/chord_button_bar';
import { transposeABC, setSelectionToDegreeABC, getScaleNote, parseKey } from './src/transposer';

export const ABC_EDITOR_VIEW_TYPE = 'abc-music-editor';

// --- HELPERS ---

function findKeyAtPos(state: EditorState, pos: number): string {
  const doc = state.doc;
  const line = doc.lineAt(pos);

  // Check current line for inline K before pos
  const lineText = line.text;
  const inlineMatches = Array.from(lineText.matchAll(/\[K:(.*?)\]/g));
  const validMatches = inlineMatches.filter(m => (line.from + m.index!) < pos);

  if (validMatches.length > 0) {
    return validMatches[validMatches.length - 1][1].trim();
  }

  // Search backwards from previous line
  for (let i = line.number - 1; i >= 1; i--) {
    const l = doc.line(i);
    const txt = l.text;
    const kMatch = txt.match(/^K:(.*)/);
    if (kMatch) return kMatch[1].trim();

    const im = Array.from(txt.matchAll(/\[K:(.*?)\]/g));
    if (im.length > 0) return im[im.length - 1][1].trim();

    if (txt.startsWith('X:')) break; // New tune starts
  }

  return 'C'; // Default
}

// Old scaleDegreeExpander removed - now using auto-suggestion instead

const toggleAbcComment = (view: EditorView): boolean => {
  const { state } = view;
  const changes = [];
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from);
    const lineText = line.text;
    if (lineText.match(/^%%%/)) changes.push({ from: line.from, to: line.from + 3, insert: '%%' });
    else if (lineText.match(/^%%/)) changes.push({ from: line.from, to: line.from, insert: '%' });
    else if (lineText.match(/^%/)) changes.push({ from: line.from, to: line.from + 1, insert: '' });
    else changes.push({ from: line.from, to: line.from, insert: '%' });
  }
  if (changes.length > 0) view.dispatch({ changes });
  return true;
};

const abcFoldService = foldService.of((state, from, to) => {
  const line = state.doc.lineAt(from);
  const lineText = line.text.trim();
  if (lineText.startsWith('%-') || lineText.startsWith('%+')) {
    let endLine = line.number + 1;
    let foldEnd = line.to;
    while (endLine <= state.doc.lines) {
      const nextLine = state.doc.line(endLine);
      const nextLineText = nextLine.text.trim();
      if (nextLineText.startsWith('%-') || nextLineText.startsWith('%+')) {
        foldEnd = state.doc.line(endLine - 1).to;
        break;
      }
      endLine++;
      if (endLine > state.doc.lines) {
        foldEnd = state.doc.length;
        break;
      }
    }
    if (foldEnd > line.to) return { from: line.to, to: foldEnd };
  }
  return null;
});

// --- MAIN CLASS ---

export class AbcEditorView extends ItemView {
  public editorView: EditorView | null = null;

  private onChange: ((content: string) => void) | null = null;
  private onSave: ((content: string) => Promise<void>) | null = null;
  private onSelectionChange: ((startChar: number, endChar: number) => void) | null = null;

  private updateTimeout: NodeJS.Timeout | null = null;
  private editorContainer: HTMLElement | null = null;
  private currentTheme: any = oneDark;
  private barVisualizer: BarVisualizer | null = null;
  private chordButtonBar: ChordButtonBar | null = null;

  // SAFETY FLAGS
  private isDirty: boolean = false;
  private isProgrammaticChange: boolean = false;

  // PATH
  public associatedFilePath: string | null = null; // Path to the file this editor is associated with
  public restrictMode: boolean = true; // <--- NEW FLAG from settings
  private overlayEl: HTMLElement | null = null;
  private overlayMessageEl: HTMLElement | null = null;
  private overlaySubtextEl: HTMLElement | null = null; // Subtext for "Caution"
  private statusEl: HTMLElement | null = null; // Save status banner

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  private updateStatus(status: 'Saved' | 'Unsaved' | 'Saving...') {
    if (!this.statusEl) return;

    this.statusEl.show();
    this.statusEl.removeClass('is-dirty');
    this.statusEl.removeClass('is-saving');
    this.statusEl.removeClass('is-saved');

    if (status === 'Unsaved') {
      this.statusEl.addClass('is-dirty');
      this.statusEl.setAttribute('aria-label', 'Unsaved - Click to save');
    } else if (status === 'Saving...') {
      this.statusEl.addClass('is-saving');
      this.statusEl.setAttribute('aria-label', 'Saving...');
    } else if (status === 'Saved') {
      this.statusEl.addClass('is-saved');
      this.statusEl.setAttribute('aria-label', 'Saved');
      // Hide after 2 seconds
      setTimeout(() => {
        if (this.statusEl && this.statusEl.hasClass('is-saved')) {
          this.statusEl.hide();
        }
      }, 2000);
    }
  }

  getViewType(): string {
    return ABC_EDITOR_VIEW_TYPE;
  }
  getDisplayText(): string {
    return 'ABC Music Editor';
  }
  getIcon(): string {
    return 'music';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('abc-editor-view');

    container.style.position = 'relative';

    // Create the Overlay Element (Hidden by default) ---
    this.overlayEl = container.createDiv({ cls: 'abc-editor-overlay' });
    this.overlayEl.style.position = 'absolute';
    this.overlayEl.style.top = '0';
    this.overlayEl.style.left = '0';
    this.overlayEl.style.width = '100%';
    this.overlayEl.style.height = '100%';
    this.overlayEl.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'; // Dark semi-transparent
    this.overlayEl.style.zIndex = '1000';
    this.overlayEl.style.display = 'none'; // Hidden initially
    this.overlayEl.style.justifyContent = 'center';
    this.overlayEl.style.alignItems = 'center';
    this.overlayEl.style.flexDirection = 'column';
    (this.overlayEl.style as any).backdropFilter = 'blur(2px)';
    this.overlayEl.style.color = '#fff';
    this.overlayEl.style.textAlign = 'center';
    this.overlayEl.style.padding = '20px';

    this.overlayEl.onclick = (e) => {
      // If we are NOT in restrict mode (Caution mode), allow dismissal
      if (!this.restrictMode) {
        this.setObscured(false);
        e.stopPropagation(); // Prevent passing click to editor immediately
      }
    };

    // Add text and a button to the overlay
    const msg = this.overlayEl.createEl('h3', { text: 'Editor Paused' });
    msg.style.marginBottom = '10px';

    // Subtext we can update
    this.overlaySubtextEl = this.overlayEl.createDiv({ text: 'The linked note is not currently active.' });

    this.overlayMessageEl = this.overlayEl.createDiv({ cls: 'abc-overlay-message' });
    this.overlayMessageEl.style.marginTop = '20px';
    this.overlayMessageEl.style.padding = '8px 16px';
    this.overlayMessageEl.style.backgroundColor = 'rgba(255, 255, 255, 0.15)'; // Light translucent bg
    this.overlayMessageEl.style.borderRadius = '6px';
    this.overlayMessageEl.style.fontWeight = 'bold';
    this.overlayMessageEl.style.fontSize = '1.1em';
    this.overlayMessageEl.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    this.overlayMessageEl.innerText = "Please switch to the linked note"; // Default text


    const header = container.createDiv({ cls: 'abc-editor-view-header' });
    header.createEl('h4', { text: 'ABC Music Code Editor' });

    this.chordButtonBar = new ChordButtonBar(container, () => this.editorView);

    const app = this.app as any;
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    if (plugin?.settings?.showBarVisualizer) {
      this.barVisualizer = new BarVisualizer(container);
    }

    this.editorContainer = container.createDiv({ cls: 'abc-codemirror-container' });
    this.editorContainer.style.position = 'relative'; // For absolute positioning of status banner

    // Status Button - clickable save button with icon overlay at top-right of editor
    this.statusEl = this.editorContainer.createEl('button', { cls: 'abc-editor-status' });
    this.statusEl.setAttribute('aria-label', 'Save');
    this.statusEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </svg>
    `;
    this.statusEl.hide(); // Hidden by default

    // Add click handler for save button
    this.statusEl.addEventListener('click', () => {
      if (this.isDirty) {
        this.save().catch(e => console.error("Button save failed:", e));
      }
    });
    this.currentTheme = this.getTheme();

    this.editorView = new EditorView({
      state: EditorState.create({
        doc: "", // Start empty
        extensions: [
          this.currentTheme,
          abc([this.templateCompletionSource.bind(this), this.scaleDegreeCompletionSource.bind(this), this.chordCompletionSource.bind(this)]),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          abcFoldService,
          foldGutter(),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            { key: 'Mod-/', run: toggleAbcComment },
            {
              key: 'Mod-s', run: (view) => {
                this.save().catch(e => console.error("Manual save failed:", e));
                return true;
              }
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              // SAFETY CHECK: Only mark dirty if user typed (not programmatic load)
              if (!this.isProgrammaticChange) {
                this.isDirty = true;
                this.updateStatus('Unsaved');
              }

              if (this.updateTimeout) clearTimeout(this.updateTimeout);
              // Wait 1 second after typing stops to save
              this.updateTimeout = setTimeout(() => {
                const content = update.state.doc.toString();

                // 1. Update Live Preview (Playback)
                if (this.onChange) this.onChange(content);

                // 2. AUTO-SAVE to disk (The Fix)
                // DISABLED: Auto-save triggers reload/glitch. 
                // We now rely on Mod-S or onClose.
                /*
                if (this.isDirty && this.onSave && content.trim().length > 0) {
                  this.onSave(content).catch(e => console.error("Auto-save failed:", e));
                  // We keep isDirty = true until a proper save confirmation or just leave it
                  // to ensure onClose also tries to save any split-second changes.
                }
                */

                // 3. Update visualizers
                const cursor = update.state.selection.main.head;
                if (this.barVisualizer) this.barVisualizer.update(content, cursor);
                if (this.chordButtonBar) this.chordButtonBar.update(content, cursor);
              }, 1000); // 1000ms debounce
            }
            if (update.selectionSet && this.onSelectionChange) {
              const selection = update.state.selection.main;
              this.onSelectionChange(selection.from, selection.to);

              // Update visualizers
              const content = update.state.doc.toString();
              const cursor = update.state.selection.main.head;
              if (this.barVisualizer) this.barVisualizer.update(content, cursor);
              if (this.chordButtonBar) this.chordButtonBar.update(content, cursor);
            }
          }),
          EditorView.theme({
            "&": { fontSize: "14px", height: "100%" },
            ".cm-scroller": { fontFamily: "var(--font-monospace, 'Courier New', monospace)", lineHeight: "1.6" },
            ".cm-content": { padding: "10px 0" },
            ".cm-line": { padding: "0 10px" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
      parent: this.editorContainer,
    });
  }

  async onClose(): Promise<void> {
    // Save final changes on close
    if (this.isDirty && this.editorView && this.onSave) {
      const content = this.editorView.state.doc.toString();
      // Prevent wiping file with empty string
      if (content.trim().length > 0) {
        await this.onSave(content).catch(err => console.error("Save failed", err));
      }
    }

    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    // Clean up
    this.onChange = null;
    this.onSelectionChange = null;
    this.onSave = null;
    this.isDirty = false;
  }

  // Public method for manual save (e.g. via command)
  async save(): Promise<void> {
    if (this.editorView && this.onSave) {
      const content = this.editorView.state.doc.toString();
      if (content.trim().length > 0) {
        this.updateStatus('Saving...');
        try {
          await this.onSave(content);
          this.isDirty = false;
          this.updateStatus('Saved');
        } catch (err) {
          console.error("Save failed", err);
          this.updateStatus('Unsaved'); // Revert to unsaved if failed
        }
      }
    }
  }

  updateOverlayMode(strict: boolean) {
    this.restrictMode = strict;
    if (this.overlaySubtextEl) {
      if (strict) {
        this.overlaySubtextEl.innerText = 'The linked note is not currently active.';
        if (this.overlayEl) this.overlayEl.style.cursor = 'default';
      } else {
        this.overlaySubtextEl.innerText = 'Caution: Linked note is inactive. Click to edit anyway.';
        if (this.overlayEl) this.overlayEl.style.cursor = 'pointer';
      }
    }
  }

  setObscured(obscured: boolean): void {
    if (this.overlayEl) {
      this.overlayEl.style.display = obscured ? 'flex' : 'none';
    }
  }
  // Called by the plugin to load content
  setContent(
    content: string,
    onChange: (content: string) => void,
    onSave: (content: string) => Promise<void>,
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {

    // We assume the user is on the note when they click to open the editor
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.associatedFilePath = activeFile.path;

      if (this.overlayMessageEl) {
        this.overlayMessageEl.innerText = `Switch to '${activeFile.basename}'`;
      }
    }

    this.onChange = onChange;
    this.onSave = onSave;
    this.onSelectionChange = onSelectionChange || null;

    if (this.editorView) {
      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== content) {
        // Mark this as a system change, not a user change
        this.isProgrammaticChange = true;

        const selection = this.editorView.state.selection.main;
        this.editorView.dispatch({
          changes: { from: 0, to: this.editorView.state.doc.length, insert: content },
          selection: EditorSelection.cursor(Math.min(selection.from, content.length)),
        });
        this.applyInitialFolds();

        // Reset flag immediately after dispatch
        this.isProgrammaticChange = false;
        // Ensure dirty is false because we just loaded fresh content
        this.isDirty = false;
      }
    }
  }

  updateCallbacks(
    onChange: (content: string) => void,
    onSave: (content: string) => Promise<void>, // <--- Add this parameter
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
    this.onChange = onChange;
    this.onSave = onSave; // <--- Update the property
    this.onSelectionChange = onSelectionChange || null;
  }

  highlightRange(startChar: number, endChar: number): void {
    if (!this.editorView) return;
    this.app.workspace.revealLeaf(this.leaf);
    setTimeout(() => {
      if (!this.editorView) return;
      const maxLength = this.editorView.state.doc.length;
      const safeStart = Math.max(0, Math.min(startChar, maxLength));
      const safeEnd = Math.max(0, Math.min(endChar, maxLength));
      this.editorView.focus();
      this.editorView.dispatch({
        selection: EditorSelection.single(safeStart, safeEnd),
        scrollIntoView: true
      });
    }, 50);
  }

  // Template Parsing
  private parseTemplateContent(content: string): string | null {
    const codeBlockRegex = /```music-abc\s*\n([\s\S]*?)```/;
    const match = content.match(codeBlockRegex);
    return (match && match[1]) ? match[1].trim() : null;
  }

  // Template autosuggestion source
  private async templateCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const line = context.state.doc.lineAt(context.pos);
    const lineText = context.state.doc.sliceString(line.from, context.pos);
    const match = lineText.match(/^(temp|TEMP)/i);
    if (!match) return null;

    const app = (this.app as any);
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    const templatesFolder = plugin?.settings?.templatesFolder;

    if (!templatesFolder) return null;

    const files = this.app.vault.getMarkdownFiles();
    const templateFiles = files.filter(file =>
      file.path.startsWith(templatesFolder) && file.path.endsWith('.md')
    );

    if (templateFiles.length === 0) return null;
    const word = context.matchBefore(/^(temp|TEMP).*$/i);
    if (!word) return null;

    return {
      from: line.from,
      to: context.pos,
      options: templateFiles.map(file => ({
        label: `temp ${file.basename}`,
        displayLabel: file.basename,
        detail: 'Template',
        type: 'text',
        apply: async (view, completion, from, to) => {
          view.dispatch({ changes: { from, to, insert: "" } });
          try {
            const content = await this.app.vault.read(file);
            const templateContent = this.parseTemplateContent(content);
            if (templateContent) {
              const insertPos = from;
              view.dispatch({
                changes: { from: insertPos, insert: templateContent },
                selection: EditorSelection.cursor(insertPos + templateContent.length)
              });
              setTimeout(() => this.applyInitialFolds(), 10);
            }
          } catch (err) {
            console.error("Failed to load template", err);
          }
        }
      })),
      filter: true
    };
  }

  // Scale degree autosuggestion source
  private async scaleDegreeCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const textBefore = context.state.doc.sliceString(Math.max(0, context.pos - 10), context.pos);
    // Updated regex to match 1-13
    const match = textBefore.match(/\.((?:1[0-3]|[1-9]))?([_#]?)$/);

    if (!match) return null;

    const typedDegree = match[1];
    const typedAccidental = match[2];

    // Build all possible options
    // Extended degrees 1-13
    const degrees = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
    const accidentals = ['', '_', '#'];
    const allOptions: Array<{ degree: string, accidental: string }> = [];

    for (const deg of degrees) {
      for (const acc of accidentals) {
        allOptions.push({ degree: deg, accidental: acc });
      }
    }

    // Filter options based on what user has typed
    const filteredOptions = allOptions.filter(opt => {
      if (typedDegree && !opt.degree.startsWith(typedDegree)) return false;
      if (typedAccidental && opt.accidental !== typedAccidental) return false;
      return true;
    });

    if (filteredOptions.length === 0) return null;

    // Get the key signature at cursor position
    const keySig = findKeyAtPos(context.state, context.pos);
    const { root, mode } = parseKey(keySig);

    const matchStart = context.pos - match[0].length;

    return {
      from: matchStart,
      to: context.pos,
      options: filteredOptions.map(opt => {
        const degreeNum = parseInt(opt.degree);
        let note = getScaleNote(root, mode, degreeNum);

        // Apply accidental
        if (opt.accidental === '_') {
          note = transposeABC(note, -1);
        } else if (opt.accidental === '#') {
          note = transposeABC(note, 1);
        }

        // Apply octave intelligence: adjust octave relative to root
        const rootNote = getScaleNote(root, mode, 1);
        const adjustedNote = this.adjustNoteOctave(note, rootNote, degreeNum);

        // New Display Format: ♭3, 3♯
        let displayLabel = opt.degree;
        if (opt.accidental === '_') {
          displayLabel = `♭${opt.degree}`;
        } else if (opt.accidental === '#') {
          displayLabel = `${opt.degree}♯`;
        }

        return {
          label: `.${opt.degree}${opt.accidental}`, // Keep typing label simple for matching? Or match display?
          // Actually, label is what is inserted if apply isn't used, or used for matching.
          // We want the user to type .3_ and see ♭3.
          // The label property is often used for filtering.
          // Let's keep label as the typed text for robust matching, but displayLabel for UI.
          displayLabel: displayLabel,
          detail: `→ ${adjustedNote}`,
          type: 'text',
          apply: (view, completion, from, to) => {
            view.dispatch({
              changes: { from, to, insert: adjustedNote },
              selection: EditorSelection.cursor(from + adjustedNote.length)
            });
          }
        };
      }),
      filter: false // We handle filtering ourselves
    };
  }

  // Helper to adjust note octave relative to root
  private adjustNoteOctave(note: string, rootNote: string, degree: number): string {
    // Helper to get note value
    const getNoteValue = (n: string) => {
      const match = n.match(/^([\^=_]*)([A-G])$/);
      if (!match) return 0;
      const acc = match[1];
      const base = match[2];
      const NOTE_VALUES: { [key: string]: number } = {
        'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
      };
      const ACCIDENTALS: { [key: string]: number } = {
        '^': 1, '_': -1, '=': 0
      };
      let val = NOTE_VALUES[base];
      if (acc) {
        for (const char of acc) {
          if (ACCIDENTALS[char]) val += ACCIDENTALS[char];
        }
      }
      return val;
    };

    const rootValue = getNoteValue(rootNote);
    let noteValue = getNoteValue(note);

    // Calculate octave offset based on degree
    // 1-7: offset 0
    // 8-14: offset 1
    const octaveOffset = Math.floor((degree - 1) / 7);

    // If degree is 1 (root), always use base octave
    if (degree === 1) {
      return note;
    }

    // For other degrees, if the note value is less than or equal to root value,
    // move it up an octave to ensure it's above root.
    // We EXCLUDE degrees that are octaves of the root (8, 15, etc.) because
    // the octaveOffset calculation already handles their elevation.
    if ((degree - 1) % 7 !== 0 && noteValue <= rootValue) {
      noteValue += 12;
    }

    // Add additional octaves for higher degrees (8, 9, etc.)
    noteValue += (octaveOffset * 12);

    // Format the note with proper octave
    const match = note.match(/^([\^=_]*)([A-G])$/);
    if (!match) return note;
    const acc = match[1];
    const base = match[2];

    if (noteValue >= 12) {
      let suffix = '';
      const octavesAbove = Math.floor((noteValue - 12) / 12);
      for (let k = 0; k < octavesAbove; k++) suffix += "'";
      return `${acc}${base.toLowerCase()}${suffix}`;
    } else {
      return `${acc}${base}`;
    }
  }

  // Chord autosuggestion source  
  private async chordCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const textBefore = context.state.doc.sliceString(Math.max(0, context.pos - 15), context.pos);
    // Enhanced pattern: matches @1-7, @1+9, AND fuzzy @19, @17, etc.
    const match = textBefore.match(/@([1-7]?)([-+]?)([79]|1[13])?$/);

    if (!match) return null;

    const typedDegree = match[1];        // e.g., "1"
    const typedSeparator = match[2];     // e.g., "-" or "+" or ""
    const typedExtension = match[3];     // e.g., "7", "9", "11", "13"

    // Build all chord options with new notation
    const degrees = ['1', '2', '3', '4', '5', '6', '7'];
    const modifiers = ['', '-7', '-9', '-11', '-13', '+9', '+11', '+13'];
    const allOptions: Array<{ degree: string, modifier: string }> = [];

    for (const deg of degrees) {
      for (const mod of modifiers) {
        allOptions.push({ degree: deg, modifier: mod });
      }
    }

    // Enhanced filtering with fuzzy search support
    const filteredOptions = allOptions.filter(opt => {
      // Filter by degree
      if (typedDegree && !opt.degree.startsWith(typedDegree)) return false;

      // Filter by separator and extension
      if (typedSeparator === '-') {
        // User typed "-", show only extended chords (-7, -9, -11, -13)
        if (!opt.modifier.startsWith('-')) return false;
        // If they also typed a number after -, filter by that too
        if (typedExtension && !opt.modifier.substring(1).startsWith(typedExtension)) return false;
      } else if (typedSeparator === '+') {
        // User typed "+", show only add chords (+9, +11, +13)
        if (!opt.modifier.startsWith('+')) return false;
        // If they also typed a number after +, filter by that too
        if (typedExtension && !opt.modifier.substring(1).startsWith(typedExtension)) return false;
      } else if (typedSeparator === '' && typedExtension) {
        // FUZZY SEARCH: User typed @19, @17, etc. (no separator)
        // Match both extended and add versions
        // e.g., @19 matches both -9 and +9
        const extNum = typedExtension;
        if (opt.modifier !== '' &&
          !opt.modifier.endsWith(extNum)) {
          return false;
        }
        // If it's a triad (no modifier), only show if no extension typed
        if (opt.modifier === '') return false;
      } else if (typedSeparator === '') {
        // No separator, no extension - show all options for this degree
      }

      return true;
    });

    if (filteredOptions.length === 0) return null;

    // Get the key signature at cursor position
    const keySig = findKeyAtPos(context.state, context.pos);
    const { root, mode } = parseKey(keySig);

    const matchStart = context.pos - match[0].length;

    return {
      from: matchStart,
      to: context.pos,
      options: filteredOptions.map(opt => {
        const degree = parseInt(opt.degree);
        const is8vaEnabled = this.chordButtonBar?.is8vaEnabled || false;
        const chordString = this.generateChordStringForCompletion(root, mode, degree, opt.modifier, is8vaEnabled);

        // Get roman numeral notation (like chord buttons)
        const romanNumeral = this.getRomanNumeralForChord(degree, mode, opt.modifier);

        const displayLabel = `${opt.degree}${opt.modifier}`;

        return {
          label: `@${displayLabel}`,
          displayLabel: romanNumeral,  // Show roman numeral!
          detail: `→ ${chordString}`,
          type: 'text',
          apply: (view, completion, from, to) => {
            view.dispatch({
              changes: { from, to, insert: chordString },
              selection: EditorSelection.cursor(from + chordString.length)
            });
          }
        };
      }),
      filter: false // We handle filtering ourselves
    };
  }

  // Get roman numeral notation for chord (matching chord button bar)
  private getRomanNumeralForChord(degree: number, mode: 'major' | 'minor', modifier: string): string {
    const majorRomans = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
    const minorRomans = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

    let roman = mode === 'major' ? majorRomans[degree - 1] : minorRomans[degree - 1];

    // Add chord extension notation
    if (modifier === '-7') {
      roman += '⁷';
    } else if (modifier === '-9') {
      roman += '⁹';
    } else if (modifier === '-11') {
      roman += '¹¹';
    } else if (modifier === '-13') {
      roman += '¹³';
    } else if (modifier === '+9') {
      roman += 'add9';
    } else if (modifier === '+11') {
      roman += 'add11';
    } else if (modifier === '+13') {
      roman += 'add13';
    }

    return roman;
  }

  // Helper to generate chord strings for the completion
  private generateChordStringForCompletion(root: string, mode: 'major' | 'minor', degree: number, modifier: string, is8vaEnabled: boolean): string {
    const rootIdx = degree - 1;
    const indices = [rootIdx, (rootIdx + 2) % 7, (rootIdx + 4) % 7]; // Triad base

    // Parse modifier - updated to handle new notation
    if (modifier === '-7') {
      indices.push((rootIdx + 6) % 7);
    } else if (modifier === '-9') {
      indices.push((rootIdx + 6) % 7); // 7th
      indices.push((rootIdx + 8) % 7); // 9th (2nd)
    } else if (modifier === '-11') {
      indices.push((rootIdx + 6) % 7);  // 7th
      indices.push((rootIdx + 8) % 7);  // 9th
      indices.push((rootIdx + 10) % 7); // 11th (4th)
    } else if (modifier === '-13') {
      indices.push((rootIdx + 6) % 7);  // 7th
      indices.push((rootIdx + 8) % 7);  // 9th
      indices.push((rootIdx + 10) % 7); // 11th
      indices.push((rootIdx + 12) % 7); // 13th (6th)
    } else if (modifier === '+9') {
      indices.push((rootIdx + 8) % 7);  // Just add 9th
    } else if (modifier === '+11') {
      indices.push((rootIdx + 10) % 7); // Just add 11th
    } else if (modifier === '+13') {
      indices.push((rootIdx + 12) % 7); // Just add 13th
    }

    // Get notes
    const notes = indices.map(idx => getScaleNote(root, mode, idx + 1));

    // Helper to get note value
    const getNoteValue = (note: string) => {
      const match = note.match(/^([\^=_]*)([A-G])$/);
      if (!match) return 0;
      const acc = match[1];
      const base = match[2];
      const NOTE_VALUES: { [key: string]: number } = {
        'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
      };
      const ACCIDENTALS: { [key: string]: number } = {
        '^': 1, '_': -1, '=': 0
      };
      let val = NOTE_VALUES[base];
      if (acc) {
        for (const char of acc) {
          if (ACCIDENTALS[char]) val += ACCIDENTALS[char];
        }
      }
      return val;
    };

    const noteValues = notes.map(n => getNoteValue(n));
    const adjustedValues = [...noteValues];

    // Adjust octaves to ensure ascending order
    if (!is8vaEnabled) {
      const tonicVal = getNoteValue(getScaleNote(root, mode, 1));
      const chordRootVal = adjustedValues[0];

      // If the chord root is lower than the key tonic, shift the whole chord up an octave
      if (chordRootVal < tonicVal) {
        for (let i = 0; i < adjustedValues.length; i++) {
          adjustedValues[i] += 12;
        }
      }

      for (let i = 1; i < adjustedValues.length; i++) {
        while (adjustedValues[i] <= adjustedValues[i - 1]) {
          adjustedValues[i] += 12;
        }
      }
    }

    // For add chords, ensure the added note is at least an octave up
    if (!is8vaEnabled && modifier.startsWith('+')) {
      const lastIdx = adjustedValues.length - 1;
      while (adjustedValues[lastIdx] < adjustedValues[0] + 12) {
        adjustedValues[lastIdx] += 12;
      }
    }

    // Format notes with proper octave notation
    const formatNote = (note: string, val: number) => {
      const match = note.match(/^([\^=_]*)([A-G])$/);
      if (!match) return note;
      const acc = match[1];
      const base = match[2];

      if (val >= 12) {
        let suffix = '';
        const octavesAbove = Math.floor((val - 12) / 12);
        for (let k = 0; k < octavesAbove; k++) suffix += "'";
        return `${acc}${base.toLowerCase()}${suffix}`;
      } else {
        return `${acc}${base}`;
      }
    };

    const formattedNotes = notes.map((n, i) => formatNote(n, adjustedValues[i]));
    return `[${formattedNotes.join('')}]`;
  }

  private getTheme(): any {
    const app = this.app as any;
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    const isDark = document.body.classList.contains('theme-dark');
    if (isDark) {
      const darkTheme = plugin?.settings?.darkTheme || 'oneDark';
      return darkTheme === 'solarizedDark' ? solarizedDark : oneDark;
    }
    return solarizedLight;
  }

  refreshTheme(): void {
    if (!this.editorView) return;
    const newTheme = this.getTheme();
    if (newTheme !== this.currentTheme) {
      this.currentTheme = newTheme;
      const content = this.editorView.state.doc.toString();
      const selection = this.editorView.state.selection;
      const wasDirty = this.isDirty;

      this.editorView.destroy();
      this.createEditorWithTheme(content, selection);

      this.isDirty = wasDirty;
      if (this.chordButtonBar) this.chordButtonBar.refresh();
    }
  }

  refreshVisualizer(): void {
    const app = this.app as any;
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    const show = plugin?.settings?.showBarVisualizer;

    if (show && !this.barVisualizer) {
      this.barVisualizer = new BarVisualizer(this.contentEl);
      if (this.barVisualizer['container'] && this.editorContainer) {
        this.contentEl.insertBefore(this.barVisualizer['container'], this.editorContainer);
      }
      if (this.editorView) {
        this.barVisualizer.update(this.editorView.state.doc.toString(), 0);
      }
    } else if (!show && this.barVisualizer) {
      if (this.barVisualizer['container']) this.barVisualizer['container'].remove();
      this.barVisualizer = null;
    }
  }

  private createEditorWithTheme(content: string, selection?: any): void {
    if (!this.editorContainer) return;
    this.editorView = new EditorView({
      state: EditorState.create({
        doc: content,
        selection: selection,
        extensions: [
          this.currentTheme,
          abc([this.templateCompletionSource.bind(this), this.scaleDegreeCompletionSource.bind(this), this.chordCompletionSource.bind(this)]),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          abcFoldService,
          foldGutter(),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            { key: 'Mod-/', run: toggleAbcComment },
            {
              key: 'Mod-s', run: (view) => {
                this.save().catch(e => console.error("Manual save failed:", e));
                return true;
              }
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              // SAFETY CHECK: Only mark dirty if user typed (not programmatic load)
              if (!this.isProgrammaticChange) {
                this.isDirty = true;
                this.updateStatus('Unsaved');
              }

              if (this.updateTimeout) clearTimeout(this.updateTimeout);
              this.updateTimeout = setTimeout(() => {
                const content = update.state.doc.toString();
                if (this.onChange) this.onChange(content);

                // AUTO-SAVE to disk (DISABLED to fix glitch)
                // We now rely on Mod-S or onClose.
                /*
                if (this.isDirty && this.onSave && content.trim().length > 0) {
                  this.onSave(content).catch(e => console.error("Auto-save failed:", e));
                }
                */

                const cursor = update.state.selection.main.head;
                if (this.barVisualizer) this.barVisualizer.update(content, cursor);
                if (this.chordButtonBar) this.chordButtonBar.update(content, cursor);
              }, 1000); // 1s Debounce
            }
            if (update.selectionSet && this.onSelectionChange) {
              const selection = update.state.selection.main;
              this.onSelectionChange(selection.from, selection.to);

              const content = update.state.doc.toString();
              const cursor = update.state.selection.main.head;
              if (this.barVisualizer) this.barVisualizer.update(content, cursor);
              if (this.chordButtonBar) this.chordButtonBar.update(content, cursor);
            }
          }),
          EditorView.theme({
            "&": { fontSize: "14px", height: "100%" },
            ".cm-scroller": { fontFamily: "var(--font-monospace, 'Courier New', monospace)", lineHeight: "1.6" },
            ".cm-content": { padding: "10px 0" },
            ".cm-line": { padding: "0 10px" },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
      parent: this.editorContainer,
    });
    this.applyInitialFolds();
  }

  private applyInitialFolds(): void {
    if (!this.editorView) return;
    const state = this.editorView.state;
    const doc = state.doc;
    const effects = [];
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const text = line.text.trim();
      if (text.startsWith('%-')) {
        let endLine = i + 1;
        let foldEnd = line.to;
        let foundEnd = false;
        while (endLine <= doc.lines) {
          const nextLine = doc.line(endLine);
          const nextText = nextLine.text.trim();
          if (nextText.startsWith('%-') || nextText.startsWith('%+')) {
            foldEnd = doc.line(endLine - 1).to;
            foundEnd = true;
            break;
          }
          endLine++;
        }
        if (!foundEnd && endLine > doc.lines) foldEnd = doc.length;
        if (foldEnd > line.to) effects.push(foldEffect.of({ from: line.to, to: foldEnd }));
      }
    }
    if (effects.length > 0) this.editorView.dispatch({ effects });
  }

  transposeSelection(semitones: number, preferFlats?: boolean): void {
    if (!this.editorView) return;
    this.isDirty = true;
    const state = this.editorView.state;
    const changes = state.changeByRange((range) => {
      if (range.empty) return { range };
      const selectedText = state.sliceDoc(range.from, range.to);
      const transposedText = transposeABC(selectedText, semitones, preferFlats);
      return {
        changes: { from: range.from, to: range.to, insert: transposedText },
        range: EditorSelection.range(range.from, range.from + transposedText.length)
      };
    });
    this.editorView.dispatch(state.update(changes, { scrollIntoView: true }));
  }

  setSelectionToDegree(degree: number): void {
    if (!this.editorView) return;
    this.isDirty = true;
    const state = this.editorView.state;
    const doc = state.doc;
    const changes = state.changeByRange((range) => {
      if (range.empty) return { range };

      const keySignature = findKeyAtPos(state, range.from);

      const selectedText = state.sliceDoc(range.from, range.to);
      const newText = setSelectionToDegreeABC(selectedText, degree, keySignature);
      return {
        changes: { from: range.from, to: range.to, insert: newText },
        range: EditorSelection.range(range.from, range.from + newText.length)
      };
    });
    this.editorView.dispatch(state.update(changes, { scrollIntoView: true }));
  }
}