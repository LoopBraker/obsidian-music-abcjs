import { ItemView, WorkspaceLeaf } from 'obsidian';

export const ABC_EDITOR_VIEW_TYPE = 'abc-music-editor';

export class AbcEditorView extends ItemView {
  private textarea: HTMLTextAreaElement;
  private onSave: ((content: string) => void) | null = null;
  private currentContent: string = '';

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

    const buttonContainer = container.createDiv({ cls: 'abc-editor-view-buttons' });
    
    const saveButton = buttonContainer.createEl('button', { text: 'Apply Changes', cls: 'mod-cta' });
    saveButton.addEventListener('click', () => {
      if (this.onSave) {
        this.onSave(this.textarea.value);
      }
    });

    const helpText = container.createDiv({ cls: 'abc-editor-view-help' });
    helpText.innerHTML = `
      <p><strong>Tip:</strong> Edit the ABC notation above and click "Apply Changes" to update the sheet music.</p>
      <p>Changes are automatically saved to your markdown file.</p>
    `;
  }

  async onClose(): Promise<void> {
    // Cleanup
    this.onSave = null;
  }

  setContent(content: string, onSave: (content: string) => void): void {
    this.currentContent = content;
    this.onSave = onSave;
    if (this.textarea) {
      this.textarea.value = content;
    }
  }

  updateContent(content: string): void {
    this.currentContent = content;
    if (this.textarea) {
      this.textarea.value = content;
    }
  }
}
