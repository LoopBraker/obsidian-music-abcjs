/**
 * Global state manager to coordinate multiple ABC music blocks
 * Ensures only one editor and one dragging mode can be active at a time
 */

import { PlaybackElement } from './playback_element';

interface EditorPreserveInfo {
  path: string;
  lineStart: number;
  source: string;
}

class GlobalAbcState {
  private static instance: GlobalAbcState;
  
  // Currently active instances
  private activeEditorBlock: PlaybackElement | null = null;
  private activeDraggingBlock: PlaybackElement | null = null;
  
  // Editor preservation across file writes
  private editorPreserve: EditorPreserveInfo | null = null;
  
  private constructor() {}
  
  static getInstance(): GlobalAbcState {
    if (!GlobalAbcState.instance) {
      GlobalAbcState.instance = new GlobalAbcState();
    }
    return GlobalAbcState.instance;
  }
  
  /**
   * Register a block as having the editor open
   * Closes editor on any other block
   */
  setActiveEditor(block: PlaybackElement | null): void {
    if (this.activeEditorBlock && this.activeEditorBlock !== block) {
      // Close editor on the previous block
      this.activeEditorBlock.closeEditorSilently();
    }
    this.activeEditorBlock = block;
  }
  
  /**
   * Get the currently active editor block
   */
  getActiveEditor(): PlaybackElement | null {
    return this.activeEditorBlock;
  }
  
  /**
   * Check if a specific block is the active editor
   */
  isActiveEditor(block: PlaybackElement): boolean {
    return this.activeEditorBlock === block;
  }
  
  /**
   * Register a block as having dragging enabled
   * Disables dragging on any other block
   */
  setActiveDragging(block: PlaybackElement | null): void {
    if (this.activeDraggingBlock && this.activeDraggingBlock !== block) {
      // Disable dragging on the previous block
      this.activeDraggingBlock.disableDraggingSilently();
    }
    this.activeDraggingBlock = block;
  }
  
  /**
   * Get the currently active dragging block
   */
  getActiveDragging(): PlaybackElement | null {
    return this.activeDraggingBlock;
  }
  
  /**
   * Clear reference to a block (called on unload)
   */
  clearBlock(block: PlaybackElement): void {
    if (this.activeEditorBlock === block) {
      this.activeEditorBlock = null;
    }
    if (this.activeDraggingBlock === block) {
      this.activeDraggingBlock = null;
    }
  }
  
  /**
   * Reset all state (useful for plugin reload)
   */
  reset(): void {
    this.activeEditorBlock = null;
    this.activeDraggingBlock = null;
    this.editorPreserve = null;
  }
  
  /**
   * Set preservation info for editor across file write
   */
  setPreserveEditor(info: EditorPreserveInfo | null): void {
    this.editorPreserve = info;
  }
  
  /**
   * Get preservation info
   */
  getPreserveEditor(): EditorPreserveInfo | null {
    return this.editorPreserve;
  }
  
  /**
   * Clear preservation info
   */
  clearPreserveEditor(): void {
    this.editorPreserve = null;
  }
}

export const globalAbcState = GlobalAbcState.getInstance();
