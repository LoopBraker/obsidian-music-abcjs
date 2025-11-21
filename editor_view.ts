import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, StreamLanguage } from '@codemirror/language';
import { Tag } from '@lezer/highlight';

export const ABC_EDITOR_VIEW_TYPE = 'abc-music-editor';

// Custom ABC comment toggle that handles %% directives correctly
const toggleAbcComment = (view: EditorView): boolean => {
  const { state } = view;
  const changes = [];
  
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from);
    const lineText = line.text;
    
    // Check what type of line this is
    if (lineText.match(/^%%%/)) {
      // Line starts with %%% -> remove one % to make %%
      changes.push({
        from: line.from,
        to: line.from + 3,
        insert: '%%'
      });
    } else if (lineText.match(/^%%/)) {
      // Line starts with %% -> add % to make %%%
      changes.push({
        from: line.from,
        to: line.from,
        insert: '%'
      });
    } else if (lineText.match(/^%/)) {
      // Line starts with single % -> remove it
      changes.push({
        from: line.from,
        to: line.from + 1,
        insert: ''
      });
    } else {
      // Normal line -> add single %
      changes.push({
        from: line.from,
        to: line.from,
        insert: '%'
      });
    }
  }
  
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  
  return true;
};

// Define ABC notation language for CodeMirror
const abcLanguage = StreamLanguage.define({
  name: 'abc',
  startState: () => ({}),
  token: (stream: any) => {
    // Check for comments: % but not %%
    if (stream.sol() && stream.match(/^%(?!%)/)) {
      stream.skipToEnd();
      return 'comment';
    }
    
    // Skip %% directives (not comments)
    if (stream.match(/^%%/)) {
      stream.skipToEnd();
      return 'keyword';
    }
    
    // Default: consume character
    stream.next();
    return null;
  }
});

export class AbcEditorView extends ItemView {
  private editorView: EditorView | null = null;
  private onChange: ((content: string) => void) | null = null;
  private onSelectionChange: ((startChar: number, endChar: number) => void) | null = null;
  private currentContent: string = '';
  private updateTimeout: NodeJS.Timeout | null = null;
  private editorContainer: HTMLElement | null = null;
  private templateContainer: HTMLElement | null = null;
  private templateDropdown: HTMLSelectElement | null = null;

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
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('abc-editor-view');

    const header = container.createDiv({ cls: 'abc-editor-view-header' });
    header.createEl('h4', { text: 'ABC Music Code Editor' });

    // Create template selector container
    this.templateContainer = container.createDiv({ cls: 'abc-template-selector' });
    await this.createTemplateSelector();

    // Create container for CodeMirror
    this.editorContainer = container.createDiv({ cls: 'abc-codemirror-container' });

    // Create CodeMirror editor
    this.editorView = new EditorView({
      state: EditorState.create({
        doc: this.currentContent,
        extensions: [
          abcLanguage,
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
              // Debounce content changes
              if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
              }
              
              this.updateTimeout = setTimeout(() => {
                if (this.onChange) {
                  this.onChange(update.state.doc.toString());
                }
              }, 300);
            }
            
            if (update.selectionSet) {
              // Trigger selection change callback
              if (this.onSelectionChange) {
                const selection = update.state.selection.main;
                this.onSelectionChange(selection.from, selection.to);
              }
            }
          }),
          EditorView.theme({
            "&": {
              fontSize: "14px",
              height: "100%",
            },
            ".cm-scroller": {
              fontFamily: "var(--font-monospace, 'Courier New', monospace)",
              lineHeight: "1.6",
            },
            ".cm-content": {
              padding: "10px 0",
            },
            ".cm-line": {
              padding: "0 10px",
            },
            "&.cm-focused": {
              outline: "none",
            },
          }),
        ],
      }),
      parent: this.editorContainer,
    });

    const helpText = container.createDiv({ cls: 'abc-editor-view-help' });
    helpText.innerHTML = `
      <p><strong>Live editing:</strong> Changes update automatically as you type.</p>
      <p><strong>Shortcuts:</strong> Cmd+D (select word/next occurrence), Cmd+F (find), Cmd+Z/Shift+Z (undo/redo)</p>
      <p>Click or select text to highlight corresponding notes in the sheet music.</p>
    `;
  }

  async onClose(): Promise<void> {
    // Cleanup
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
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
    this.currentContent = content;
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange || null;
    
    if (this.editorView) {
      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== content) {
        // Preserve cursor position if possible
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

  updateContent(content: string): void {
    this.currentContent = content;
    if (this.editorView) {
      const currentDoc = this.editorView.state.doc.toString();
      if (currentDoc !== content) {
        // Preserve cursor position
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
    if (!this.editorView) {
      return;
    }
    
    // 1. Ensure indices are within bounds
    const maxLength = this.editorView.state.doc.length;
    const safeStart = Math.max(0, Math.min(startChar, maxLength));
    const safeEnd = Math.max(0, Math.min(endChar, maxLength));
    
    // 2. CRITICAL FIX: Tell Obsidian to make this sidebar leaf active/visible
    // @ts-ignore: accessing app on ItemView
    if (this.app && this.app.workspace) {
       // @ts-ignore
       this.app.workspace.revealLeaf(this.leaf);
    }

    // 3. CRITICAL FIX: Use setTimeout to decouple from the click event
    setTimeout(() => {
        if (!this.editorView) return;
        
        // Focus the editor
        this.editorView.focus();
        
        // Set selection
        this.editorView.dispatch({
          selection: EditorSelection.single(safeStart, safeEnd),
          scrollIntoView: true,
        });
        
        // Scroll to center the selection
        const effect = EditorView.scrollIntoView(safeStart, {
          y: "center",
          yMargin: 50,
        });
        
        this.editorView.dispatch({
          effects: effect,
        });
    }, 10);
  }

  updateCallbacks(
    onChange: (content: string) => void,
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
    // Update callbacks without touching the content
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange || null;
  }

  private async createTemplateSelector(): Promise<void> {
    if (!this.templateContainer) return;

    this.templateContainer.empty();

    // Get plugin settings
    const app = (this.app as any);
    const plugin = app.plugins?.plugins?.['music-code-blocks'];
    const templatesFolder = plugin?.settings?.templatesFolder;

    if (!templatesFolder) {
      return; // No templates folder configured
    }

    // Find all markdown files in the templates folder
    const files = this.app.vault.getMarkdownFiles();
    const templateFiles = files.filter(file => 
      file.path.startsWith(templatesFolder) && file.path.endsWith('.md')
    );

    if (templateFiles.length === 0) {
      return; // No templates found
    }

    // Create dropdown
    const label = this.templateContainer.createEl('label', { 
      text: 'Load Template: ',
      cls: 'abc-template-label'
    });

    this.templateDropdown = this.templateContainer.createEl('select', {
      cls: 'abc-template-dropdown'
    });

    // Add default option
    this.templateDropdown.createEl('option', {
      text: '-- Select a template --',
      value: ''
    });

    // Add template files
    for (const file of templateFiles) {
      const fileName = file.basename;
      this.templateDropdown.createEl('option', {
        text: fileName,
        value: file.path
      });
    }

    // Handle template selection
    this.templateDropdown.addEventListener('change', async () => {
      const selectedPath = this.templateDropdown?.value;
      if (selectedPath) {
        await this.loadTemplate(selectedPath);
        // Reset dropdown
        if (this.templateDropdown) {
          this.templateDropdown.value = '';
        }
      }
    });
  }

  private async loadTemplate(filePath: string): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        console.error('Template file not found:', filePath);
        return;
      }

      const content = await this.app.vault.read(file);
      
      // Extract content from music-abc code block
      const codeBlockRegex = /```music-abc\s*\n([\s\S]*?)```/;
      const match = content.match(codeBlockRegex);
      
      if (match && match[1]) {
        const templateContent = match[1].trim();
        
        // Update editor content
        if (this.editorView) {
          this.editorView.dispatch({
            changes: {
              from: 0,
              to: this.editorView.state.doc.length,
              insert: templateContent,
            },
            selection: EditorSelection.cursor(0),
          });
          
          // Trigger onChange callback
          if (this.onChange) {
            this.onChange(templateContent);
          }
        }
      } else {
        console.warn('No music-abc code block found in template:', filePath);
      }
    } catch (error) {
      console.error('Error loading template:', error);
    }
  }

  async refreshTemplateSelector(): Promise<void> {
    await this.createTemplateSelector();
  }
}
