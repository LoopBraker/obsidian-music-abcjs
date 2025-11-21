import { ItemView, WorkspaceLeaf } from 'obsidian';

export const ABC_EDITOR_VIEW_TYPE = 'abc-music-editor';

export class AbcEditorView extends ItemView {
  private textarea: HTMLTextAreaElement;
  private onChange: ((content: string) => void) | null = null;
  private onSelectionChange: ((startChar: number, endChar: number) => void) | null = null;
  private currentContent: string = '';
  private updateTimeout: NodeJS.Timeout | null = null;

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

    this.textarea = container.createEl('textarea', { cls: 'abc-editor-view-textarea' });
    this.textarea.value = this.currentContent;
    this.textarea.setAttribute('spellcheck', 'false');
    this.textarea.setAttribute('placeholder', 'Edit your ABC music notation here...');

    // Real-time input handler with debounce
    this.textarea.addEventListener('input', () => {
      if (this.updateTimeout) {
        clearTimeout(this.updateTimeout);
      }
      
      this.updateTimeout = setTimeout(() => {
        if (this.onChange) {
          this.onChange(this.textarea.value);
        }
      }, 300); // 300ms debounce for smooth typing
    });

    // Selection change handler - using a wrapper to always get current callback
    const handleSelection = () => {
      if (this.onSelectionChange) {
        const start = this.textarea.selectionStart;
        const end = this.textarea.selectionEnd;
        this.onSelectionChange(start, end);
      }
    };
    
    this.textarea.addEventListener('select', handleSelection);
    this.textarea.addEventListener('click', handleSelection);
    this.textarea.addEventListener('keyup', handleSelection); // Also trigger on keyboard navigation

    const helpText = container.createDiv({ cls: 'abc-editor-view-help' });
    helpText.innerHTML = `
      <p><strong>Live editing:</strong> Changes update automatically as you type.</p>
      <p>Click or select text to highlight corresponding notes in the sheet music.</p>
    `;
  }

  async onClose(): Promise<void> {
    // Cleanup
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
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
    if (this.textarea && this.textarea.value !== content) {
      // Only update if content actually changed
      // Preserve cursor position
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      this.textarea.value = content;
      this.textarea.setSelectionRange(start, end);
    }
  }

  updateContent(content: string): void {
    this.currentContent = content;
    if (this.textarea && this.textarea.value !== content) {
      // Preserve cursor position
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      this.textarea.value = content;
      this.textarea.setSelectionRange(start, end);
    }
  }

  highlightRange(startChar: number, endChar: number): void {
    if (!this.textarea) {
      return;
    }
    
    // 1. Ensure indices are within bounds
    const maxLength = this.textarea.value.length;
    const safeStart = Math.max(0, Math.min(startChar, maxLength));
    const safeEnd = Math.max(0, Math.min(endChar, maxLength));
    
    // 2. CRITICAL FIX: Tell Obsidian to make this sidebar leaf active/visible
    // If this is hidden behind another tab, this brings it to front.
    // If it's visible but not focused, this prepares it for focus.
    // @ts-ignore: accessing app on ItemView
    if (this.app && this.app.workspace) {
       // @ts-ignore
       this.app.workspace.revealLeaf(this.leaf);
    }

    // 3. CRITICAL FIX: Use setTimeout to decouple from the click event
    // When you click the SVG, the browser is handling a MouseEvent on the SVG.
    // We need to wait for that event bubble to finish before forcefully 
    // moving focus to the textarea, otherwise the browser might snap focus back.
    setTimeout(() => {
        this.textarea.focus();
        this.textarea.setSelectionRange(safeStart, safeEnd);
        
        // 4. Scroll logic (Calculate pixels)
        const textBeforeSelection = this.textarea.value.substring(0, safeStart);
        const linesBefore = textBeforeSelection.split('\n').length;
        
        // Get the actual line height from computed styles for accuracy
        const computedStyle = window.getComputedStyle(this.textarea);
        const lineHeight = parseInt(computedStyle.lineHeight) || 20;
        
        // Center the selection vertically
        const textAreaHeight = this.textarea.clientHeight;
        const targetScroll = Math.max(0, (linesBefore * lineHeight) - (textAreaHeight / 2));
        
        this.textarea.scrollTo({
            top: targetScroll,
            behavior: 'smooth'
        });
    }, 10); // 10ms is usually enough to let the click event finish
  }

  updateCallbacks(
    onChange: (content: string) => void,
    onSelectionChange?: (startChar: number, endChar: number) => void
  ): void {
    // Update callbacks without touching the content
    this.onChange = onChange;
    this.onSelectionChange = onSelectionChange || null;
  }
}
