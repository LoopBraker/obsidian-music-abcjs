import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, foldGutter, foldService, foldEffect, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';
import { solarizedLight } from 'cm6-theme-solarized-light';
import { solarizedDark } from 'cm6-theme-solarized-dark';
import { abc } from './src/abc-lang';

export const ABC_EDITOR_VIEW_TYPE = 'abc-music-editor';

// Custom ABC comment toggle
const toggleAbcComment = (view: EditorView): boolean => {
  const { state } = view;
  const changes = [];

  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from);
    const lineText = line.text;

    if (lineText.match(/^%%%/)) {
      changes.push({ from: line.from, to: line.from + 3, insert: '%%' });
    } else if (lineText.match(/^%%/)) {
      changes.push({ from: line.from, to: line.from, insert: '%' });
    } else if (lineText.match(/^%/)) {
      changes.push({ from: line.from, to: line.from + 1, insert: '' });
    } else {
      changes.push({ from: line.from, to: line.from, insert: '%' });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }

  return true;
};

// Custom fold service
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

    if (foldEnd > line.to) {
      return { from: line.to, to: foldEnd };
    }
  }
  return null;
});

export class AbcEditorView extends ItemView {
  private editorView: EditorView | null = null;
  private onChange: ((content: string) => void) | null = null;
  private onSave: ((content: string) => Promise<void>) | null = null;
  private onSelectionChange: ((startChar: number, endChar: number) => void) | null = null;
  private currentContent: string = '';
  private updateTimeout: NodeJS.Timeout | null = null;
  private editorContainer: HTMLElement | null = null;
  private currentTheme: any = oneDark;

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

  private handleBeforeUnload = () => {
    if (this.editorView && this.onSave) {
      const content = this.editorView.state.doc.toString();
      this.onSave(content).catch(err => console.error("Save on close failed", err));
    }
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('abc-editor-view');

    window.addEventListener('beforeunload', this.handleBeforeUnload);

    const header = container.createDiv({ cls: 'abc-editor-view-header' });
    header.createEl('h4', { text: 'ABC Music Code Editor' });

    // DROPDOWN REMOVED HERE

    this.editorContainer = container.createDiv({ cls: 'abc-codemirror-container' });

    this.currentTheme = this.getTheme();

    this.editorView = new EditorView({
      state: EditorState.create({
        doc: this.currentContent,
        extensions: [
          this.currentTheme,
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
              if (this.updateTimeout) clearTimeout(this.updateTimeout);
              this.updateTimeout = setTimeout(() => {
                if (this.onChange) this.onChange(update.state.doc.toString());
              }, 300);
            }
            if (update.selectionSet && this.onSelectionChange) {
              const selection = update.state.selection.main;
              let start = selection.from;
              let end = selection.to;

              if (start === end && start < update.state.doc.length) {
                end = start + 1;
              }
              this.onSelectionChange(start, end);
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

    const helpText = container.createDiv({ cls: 'abc-editor-view-help' });
    helpText.innerHTML = `
      <p><strong>Live editing:</strong> Changes update automatically as you type.</p>
      <p><strong>Templates:</strong> Type "temp" to search and insert templates.</p>
      <p><strong>Shortcuts:</strong> Cmd+D (select word/next occurrence), Cmd+F (find), Cmd+Z/Shift+Z (undo/redo)</p>
    `;
  }

  async onClose(): Promise<void> {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
    this.onChange = null;
    this.onSelectionChange = null;
  }

  setContent(
    content: string,
    onChange: (content: string) => void,
    onSave: (content: string) => Promise<void>,
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
    this.currentContent = content;
    this.onChange = onChange;
    this.onSave = onSave;
    this.onSelectionChange = onSelectionChange || null;

    if (this.editorView) {
      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== content) {
        const selection = this.editorView.state.selection.main;
        this.editorView.dispatch({
          changes: {
            from: 0,
            to: this.editorView.state.doc.length,
            insert: content,
          },
          selection: EditorSelection.cursor(Math.min(selection.from, content.length)),
        });
        this.applyInitialFolds();
      }
    }
  }

  updateContent(content: string): void {
    this.currentContent = content;
    if (this.editorView) {
      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== content) {
        const selection = this.editorView.state.selection.main;
        this.editorView.dispatch({
          changes: {
            from: 0,
            to: this.editorView.state.doc.length,
            insert: content,
          },
          selection: EditorSelection.cursor(Math.min(selection.from, content.length)),
        });
      }
    }
  }

  highlightRange(startChar: number, endChar: number): void {
    if (!this.editorView) return;
    // @ts-ignore
    if (this.app?.workspace) this.app.workspace.revealLeaf(this.leaf);
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

  updateCallbacks(
    onChange: (content: string) => void,
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange || null;
  }

  // Template Parsing (Kept because Autocomplete uses it)
  private parseTemplateContent(content: string): string | null {
    const codeBlockRegex = /```music-abc\s*\n([\s\S]*?)```/;
    const match = content.match(codeBlockRegex);
    return (match && match[1]) ? match[1].trim() : null;
  }

  // Template autosuggestion source
  private async templateCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const line = context.state.doc.lineAt(context.pos);
    const lineText = context.state.doc.sliceString(line.from, context.pos);

    // Check if line starts with "temp" or "TEMP"
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
          // 1. Remove the trigger text "temp ..."
          view.dispatch({
            changes: { from, to, insert: "" }
          });

          // 2. Load and parse the template file
          try {
            const content = await this.app.vault.read(file);
            const templateContent = this.parseTemplateContent(content);

            if (templateContent) {
              // 3. Insert the template content
              const insertPos = from;
              view.dispatch({
                changes: { from: insertPos, insert: templateContent },
                selection: EditorSelection.cursor(insertPos + templateContent.length)
              });

              // Apply default folds to the newly inserted content
              // (Wait 1 tick for DOM update to be safe, though dispatch is sync)
              setTimeout(() => this.applyInitialFolds(), 10);
            }
          } catch (err) {
            console.error("Failed to load template for completion", err);
          }
        }
      })),
      filter: true
    };
  }

  private getTheme(): any {
    const app = (this.app as any);
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    const isDark = document.body.classList.contains('theme-dark');

    if (isDark) {
      const darkTheme = plugin?.settings?.darkTheme || 'oneDark';
      return darkTheme === 'solarizedDark' ? solarizedDark : oneDark;
    } else {
      return solarizedLight;
    }
  }

  refreshTheme(): void {
    if (!this.editorView) return;
    const newTheme = this.getTheme();
    if (newTheme !== this.currentTheme) {
      this.currentTheme = newTheme;
      const content = this.editorView.state.doc.toString();
      const selection = this.editorView.state.selection;
      this.editorView.destroy();
      this.createEditorWithTheme(content, selection);
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
              if (this.updateTimeout) clearTimeout(this.updateTimeout);
              this.updateTimeout = setTimeout(() => {
                if (this.onChange) this.onChange(update.state.doc.toString());
              }, 300);
            }
            if (update.selectionSet && this.onSelectionChange) {
              const selection = update.state.selection.main;
              this.onSelectionChange(selection.from, selection.to);
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

        if (!foundEnd && endLine > doc.lines) {
          foldEnd = doc.length;
        }

        if (foldEnd > line.to) {
          effects.push(foldEffect.of({ from: line.to, to: foldEnd }));
        }
      }
    }

    if (effects.length > 0) {
      this.editorView.dispatch({ effects });
    }
  }
}