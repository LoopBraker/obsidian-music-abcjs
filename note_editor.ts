import { MarkdownPostProcessorContext } from 'obsidian';

/**
 * Handles selecting and dragging notes to modify ABC notation
 */
export class NoteEditor {
  // All ABC pitches from lowest to highest
  private readonly allPitches = [
    'C,,,,', 'D,,,,', 'E,,,,', 'F,,,,', 'G,,,,', 'A,,,,', 'B,,,,',
    'C,,,', 'D,,,', 'E,,,', 'F,,,', 'G,,,', 'A,,,', 'B,,,',
    'C,,', 'D,,', 'E,,', 'F,,', 'G,,', 'A,,', 'B,,',
    'C,', 'D,', 'E,', 'F,', 'G,', 'A,', 'B,',
    'C', 'D', 'E', 'F', 'G', 'A', 'B',
    'c', 'd', 'e', 'f', 'g', 'a', 'b',
    "c'", "d'", "e'", "f'", "g'", "a'", "b'",
    "c''", "d''", "e''", "f''", "g''", "a''", "b''",
    "c'''", "d'''", "e'''", "f'''", "g'''", "a'''", "b'''",
    "c''''", "d''''", "e''''", "f''''", "g''''", "a''''", "b''''"
  ];

  constructor(
    private abcSource: string,
    private readonly ctx?: MarkdownPostProcessorContext,
    private readonly el?: HTMLElement
  ) {}

  /**
   * Update the internal ABC source
   */
  setSource(source: string) {
    this.abcSource = source;
  }

  /**
   * Get the current ABC source
   */
  getSource(): string {
    return this.abcSource;
  }

  /**
   * Move a note up or down by the specified number of steps
   */
  private moveNote(note: string, step: number): string {
    const index = this.allPitches.indexOf(note);
    if (index >= 0 && index - step >= 0 && index - step < this.allPitches.length) {
      return this.allPitches[index - step];
    }
    return note;
  }

  /**
   * Tokenize ABC text into components (notes, decorations, chords)
   */
  private tokenize(str: string): string[] {
    // Split by decorations and quoted strings, preserving them
    const arr = str.split(/(!.+?!|".+?")/);
    const output: string[] = [];
    
    for (let i = 0; i < arr.length; i++) {
      const token = arr[i];
      if (token.length > 0) {
        if (token[0] !== '"' && token[0] !== '!') {
          // Further split to isolate note names
          const arr2 = token.split(/([A-Ga-g][,']*)/);
          output.push(...arr2);
        } else {
          output.push(token);
        }
      }
    }
    return output;
  }

  /**
   * Handle a note drag operation
   * Returns the updated ABC source if changes were made
   */
  async handleNoteDrag(abcElem: any, drag: any): Promise<string | null> {
    // Only process if this is a note drag with valid character positions
    if (!abcElem.pitches || !drag || !drag.step || abcElem.startChar < 0 || abcElem.endChar < 0) {
      return null;
    }

    const originalText = this.abcSource.substring(abcElem.startChar, abcElem.endChar);
    
    // Tokenize the original text
    const tokens = this.tokenize(originalText);
    
    // Move each note in the tokens by the drag step
    for (let i = 0; i < tokens.length; i++) {
      tokens[i] = this.moveNote(tokens[i], drag.step);
    }
    
    const newText = tokens.join('');
    
    // Update the ABC source
    this.abcSource = this.abcSource.substring(0, abcElem.startChar) + 
                     newText + 
                     this.abcSource.substring(abcElem.endChar);
    
    // Save the change to the file if context is available
    await this.updateFileContent();
    
    return this.abcSource;
  }

  /**
   * Update the markdown file content with the modified ABC notation
   */
  private async updateFileContent() {
    if (!this.ctx || !this.el) return;
    
    const sectionInfo = this.ctx.getSectionInfo(this.el);
    if (!sectionInfo) return;

    const { lineStart } = sectionInfo;
    const sourcePath = (this.ctx as any).sourcePath;
    if (!sourcePath) return;

    const app = (window as any).app;
    const file = app.vault.getAbstractFileByPath(sourcePath);
    if (!file) return;

    try {
      // Read the entire file content
      const content = await app.vault.read(file);
      const lines = content.split('\n');
      
      // Find the code block boundaries
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
        // Replace the code block content
        const beforeBlock = lines.slice(0, codeBlockStart + 1);
        const afterBlock = lines.slice(codeBlockEnd);
        
        const newLines = [
          ...beforeBlock,
          this.abcSource,
          ...afterBlock
        ];
        
        const newContent = newLines.join('\n');
        await app.vault.modify(file, newContent);
      }
    } catch (error) {
      console.error('Failed to update file:', error);
    }
  }
}
