import { App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import MusicPlugin from './main';

class FolderSuggest {
  private inputEl: HTMLInputElement;
  private suggestEl: HTMLElement | null = null;
  private app: App;
  private onSelect: (value: string) => void;

  constructor(app: App, inputEl: HTMLInputElement, onSelect: (value: string) => void) {
    this.app = app;
    this.inputEl = inputEl;
    this.onSelect = onSelect;

    // Setup input listeners
    this.inputEl.addEventListener('input', () => this.updateSuggestions());
    this.inputEl.addEventListener('focus', () => this.updateSuggestions());
    this.inputEl.addEventListener('blur', () => {
      // Delay to allow click on suggestion
      setTimeout(() => this.closeSuggestions(), 200);
    });
  }

  private getAllFolders(): string[] {
    const folders: string[] = [];
    const rootFolder = this.app.vault.getRoot();

    const collectFolders = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          folders.push(child.path);
          collectFolders(child);
        }
      }
    };

    collectFolders(rootFolder);
    return folders;
  }

  private updateSuggestions(): void {
    const inputValue = this.inputEl.value.toLowerCase();
    const allFolders = this.getAllFolders();

    // Filter folders based on input
    const matchingFolders = allFolders.filter(folder =>
      folder.toLowerCase().includes(inputValue)
    ).slice(0, 10); // Limit to 10 suggestions

    if (matchingFolders.length === 0 || (matchingFolders.length === 1 && matchingFolders[0] === this.inputEl.value)) {
      this.closeSuggestions();
      return;
    }

    // Create or update suggestions container
    if (!this.suggestEl) {
      this.suggestEl = createDiv({ cls: 'abc-folder-suggestions' });
      this.inputEl.parentElement?.appendChild(this.suggestEl);
    } else {
      this.suggestEl.empty();
    }

    // Add suggestions
    for (const folder of matchingFolders) {
      const suggestionEl = this.suggestEl.createDiv({
        cls: 'abc-folder-suggestion-item',
        text: folder
      });

      suggestionEl.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent input blur
        this.selectFolder(folder);
      });

      suggestionEl.addEventListener('mouseenter', () => {
        // Highlight on hover
        this.suggestEl?.querySelectorAll('.abc-folder-suggestion-item').forEach(el => {
          el.removeClass('is-selected');
        });
        suggestionEl.addClass('is-selected');
      });
    }

    // Position suggestions below input
    const rect = this.inputEl.getBoundingClientRect();
    this.suggestEl.style.position = 'absolute';
    this.suggestEl.style.top = `${this.inputEl.offsetTop + this.inputEl.offsetHeight}px`;
    this.suggestEl.style.left = `${this.inputEl.offsetLeft}px`;
    this.suggestEl.style.width = `${this.inputEl.offsetWidth}px`;
  }

  private selectFolder(folder: string): void {
    this.inputEl.value = folder;
    this.onSelect(folder);
    this.closeSuggestions();
  }

  private closeSuggestions(): void {
    if (this.suggestEl) {
      this.suggestEl.remove();
      this.suggestEl = null;
    }
  }

  destroy(): void {
    this.closeSuggestions();
  }
}

export interface MusicPluginSettings {
  soundFont: 'abcjs' | 'FluidR3_GM' | 'MusyngKite';
  templatesFolder: string;
  darkTheme: 'oneDark' | 'solarizedDark';
  lightTheme: 'solarizedLight';
  showBarVisualizer: boolean;
  // NEW: Setting to control locking behavior
  restrictEditorToActiveNote: boolean;
}

export const DEFAULT_SETTINGS: MusicPluginSettings = {
  soundFont: 'MusyngKite',
  templatesFolder: '',
  darkTheme: 'oneDark',
  lightTheme: 'solarizedLight',
  showBarVisualizer: true,
  // Default to true (protection on)
  restrictEditorToActiveNote: true
};

export const SOUND_FONT_DESCRIPTIONS = {
  'abcjs': 'Bright, crisp',
  'FluidR3_GM': 'Loud, deeper',
  'MusyngKite': 'Muted, more mids'
};

export const THEME_DESCRIPTIONS = {
  'oneDark': 'One Dark (default dark theme)',
  'solarizedDark': 'Solarized Dark',
  'solarizedLight': 'Solarized Light (light theme)'
};

export class MusicSettingTab extends PluginSettingTab {
  plugin: MusicPlugin;
  private folderSuggest: FolderSuggest | null = null;

  constructor(app: App, plugin: MusicPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('Sound Font')
      .setDesc('Choose the sound font for audio playback')
      .addDropdown(dropdown => dropdown
        .addOption('abcjs', `ABCJS (${SOUND_FONT_DESCRIPTIONS.abcjs})`)
        .addOption('FluidR3_GM', `FluidR3 GM (${SOUND_FONT_DESCRIPTIONS.FluidR3_GM})`)
        .addOption('MusyngKite', `MusyngKite (${SOUND_FONT_DESCRIPTIONS.MusyngKite})`)
        .setValue(this.plugin.settings.soundFont)
        .onChange(async (value: 'abcjs' | 'FluidR3_GM' | 'MusyngKite') => {
          this.plugin.settings.soundFont = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Dark Theme')
      .setDesc('Editor theme when Obsidian is in dark mode')
      .addDropdown(dropdown => dropdown
        .addOption('oneDark', THEME_DESCRIPTIONS.oneDark)
        .addOption('solarizedDark', THEME_DESCRIPTIONS.solarizedDark)
        .setValue(this.plugin.settings.darkTheme)
        .onChange(async (value: 'oneDark' | 'solarizedDark') => {
          this.plugin.settings.darkTheme = value;
          await this.plugin.saveSettings();
          this.plugin.refreshEditorTheme();
        }));

    new Setting(containerEl)
      .setName('Light Theme')
      .setDesc('Editor theme when Obsidian is in light mode')
      .addDropdown(dropdown => dropdown
        .addOption('solarizedLight', THEME_DESCRIPTIONS.solarizedLight)
        .setValue(this.plugin.settings.lightTheme)
        .onChange(async (value: 'solarizedLight') => {
          this.plugin.settings.lightTheme = value;
          await this.plugin.saveSettings();
          this.plugin.refreshEditorTheme();
        }));

    new Setting(containerEl)
      .setName('Show Bar Visualizer')
      .setDesc('Show a visual representation of the current bar above the editor')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showBarVisualizer)
        .onChange(async (value) => {
          this.plugin.settings.showBarVisualizer = value;
          await this.plugin.saveSettings();
          this.plugin.refreshVisualizer();
        }));

    // --- NEW SETTING ---
    new Setting(containerEl)
      .setName('Restrict Editor to Active Note')
      .setDesc('If enabled, the editor will be obscured with a warning when you navigate away from the linked note.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.restrictEditorToActiveNote)
        .onChange(async (value) => {
          this.plugin.settings.restrictEditorToActiveNote = value;
          await this.plugin.saveSettings();
          // Force a refresh of the lock state immediately
          this.plugin.refreshEditorLocking();
        }));
    // -------------------

    new Setting(containerEl)
      .setName('Templates Folder')
      .setDesc('Folder containing ABC music templates (markdown files with music-abc code blocks)')
      .addText(text => {
        text
          .setPlaceholder('e.g., Templates/ABC')
          .setValue(this.plugin.settings.templatesFolder)
          .onChange(async (value) => {
            this.plugin.settings.templatesFolder = value;
            await this.plugin.saveSettings();
          });

        this.folderSuggest = new FolderSuggest(
          this.app,
          text.inputEl,
          async (value) => {
            this.plugin.settings.templatesFolder = value;
            await this.plugin.saveSettings();
          }
        );
      });
  }

  hide(): void {
    if (this.folderSuggest) {
      this.folderSuggest.destroy();
      this.folderSuggest = null;
    }
  }
}