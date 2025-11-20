import { Modal, App } from 'obsidian';

export class AbcEditorModal extends Modal {
  private textarea: HTMLTextAreaElement;
  private onSave: (content: string) => void;
  private initialContent: string;

  constructor(app: App, initialContent: string, onSave: (content: string) => void) {
    super(app);
    this.initialContent = initialContent;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    
    contentEl.createEl('h2', { text: 'ABC Music Editor' });
    
    this.textarea = contentEl.createEl('textarea', { cls: 'abc-editor-modal-textarea' });
    this.textarea.value = this.initialContent;
    this.textarea.setAttribute('spellcheck', 'false');
    
    const buttonContainer = contentEl.createDiv({ cls: 'abc-editor-modal-buttons' });
    
    const saveButton = buttonContainer.createEl('button', { text: 'Save & Close', cls: 'mod-cta' });
    saveButton.addEventListener('click', () => {
      this.onSave(this.textarea.value);
      this.close();
    });
    
    const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelButton.addEventListener('click', () => {
      this.close();
    });
    
    // Focus the textarea
    this.textarea.focus();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
