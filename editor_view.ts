import { ItemView, WorkspaceLeaf } from 'obsidian';
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

const scaleDegreeExpander = EditorState.transactionFilter.of(tr => {
  if (!tr.isUserEvent('input')) return tr;

  let modified = false;
  const newChanges: any[] = [];

  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (inserted.toString() === " ") {
      const before = tr.startState.doc.sliceString(Math.max(0, fromA - 3), fromA);
      const match = before.match(/\.([1-7])([_#])?$/);
      if (match) {
        const degree = parseInt(match[1]);
        const accidental = match[2];
        const keySig = findKeyAtPos(tr.startState, fromA);
        const { root, mode } = parseKey(keySig);
        let note = getScaleNote(root, mode, degree);

        if (accidental === '_') {
          note = transposeABC(note, -1);
        } else if (accidental === '#') {
          note = transposeABC(note, 1);
        }

        // Replace .N[acc] with Note (consume the space)
        const matchLen = match[0].length;
        newChanges.push({ from: fromA - matchLen, to: fromA, insert: note });
        modified = true;
      } else {
        newChanges.push({ from: fromA, to: toA, insert: inserted });
      }
    } else {
      newChanges.push({ from: fromA, to: toA, insert: inserted });
    }
  });

  if (modified) {
    return {
      changes: newChanges,
      scrollIntoView: true
    };
  }
  return tr;
});

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

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
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

    const header = container.createDiv({ cls: 'abc-editor-view-header' });
    header.createEl('h4', { text: 'ABC Music Code Editor' });

    this.chordButtonBar = new ChordButtonBar(container, () => this.editorView);

    const app = this.app as any;
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    if (plugin?.settings?.showBarVisualizer) {
      this.barVisualizer = new BarVisualizer(container);
    }

    this.editorContainer = container.createDiv({ cls: 'abc-codemirror-container' });
    this.currentTheme = this.getTheme();

    this.editorView = new EditorView({
      state: EditorState.create({
        doc: "", // Start empty
        extensions: [
          this.currentTheme,
          scaleDegreeExpander,
          abc([this.templateCompletionSource.bind(this)]),
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
              }

              if (this.updateTimeout) clearTimeout(this.updateTimeout);
              // Wait 1 second after typing stops to save
              this.updateTimeout = setTimeout(() => {
                const content = update.state.doc.toString();

                // 1. Update Live Preview (Playback)
                if (this.onChange) this.onChange(content);

                // 2. AUTO-SAVE to disk (The Fix)
                // If the user typed, save it. Don't wait for close.
                if (this.isDirty && this.onSave && content.trim().length > 0) {
                  this.onSave(content).catch(e => console.error("Auto-save failed:", e));
                  // We keep isDirty = true until a proper save confirmation or just leave it
                  // to ensure onClose also tries to save any split-second changes.
                }

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

  // Called by the plugin to load content
  setContent(
    content: string,
    onChange: (content: string) => void,
    onSave: (content: string) => Promise<void>,
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
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
          scaleDegreeExpander,
          abc([this.templateCompletionSource.bind(this)]),
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
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              if (!this.isProgrammaticChange) this.isDirty = true;

              if (this.updateTimeout) clearTimeout(this.updateTimeout);
              this.updateTimeout = setTimeout(() => {
                const content = update.state.doc.toString();
                if (this.onChange) this.onChange(content);

                // AUTO-SAVE (Same logic as onOpen)
                if (this.isDirty && this.onSave && content.trim().length > 0) {
                  this.onSave(content).catch(e => console.error("Auto-save failed:", e));
                }

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

  transposeSelection(semitones: number): void {
    if (!this.editorView) return;
    this.isDirty = true;
    const state = this.editorView.state;
    const changes = state.changeByRange((range) => {
      if (range.empty) return { range };
      const selectedText = state.sliceDoc(range.from, range.to);
      const transposedText = transposeABC(selectedText, semitones);
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