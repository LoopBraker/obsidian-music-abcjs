import { MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { PLAYBACK_CONTROLS_ID } from './cfg';
import { PlaybackElement } from './playback_element';
import { AbcEditorView, ABC_EDITOR_VIEW_TYPE } from './editor_view';
import { globalAbcState } from './global_state';
import { MusicSettingTab, MusicPluginSettings, DEFAULT_SETTINGS } from './settings';

export default class MusicPlugin extends Plugin {
	settings: MusicPluginSettings;

	async onload() {
		await this.loadSettings();

		// Register the ABC editor view
		this.registerView(
			ABC_EDITOR_VIEW_TYPE,
			(leaf) => new AbcEditorView(leaf)
		);

		this.registerMarkdownCodeBlockProcessor('abc', this.codeProcessor);
		this.registerMarkdownCodeBlockProcessor('music-abc', this.codeProcessor);

		// Add settings tab
		this.addSettingTab(new MusicSettingTab(this.app, this));

		// Listen for theme changes in Obsidian
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				this.refreshEditorTheme();
			})
		);

		// Although unused by us, a valid DOM element is needed to create a SynthController
		const unusedPlaybackControls = document.createElement('aside');
		unusedPlaybackControls.id = PLAYBACK_CONTROLS_ID;
		unusedPlaybackControls.style.display = 'none';
		document.body.appendChild(unusedPlaybackControls);

		// Close any leftover ABC editor views from previous session
		// This ensures a clean state when Obsidian loads
		this.app.workspace.onLayoutReady(() => {
			// Reset global state
			globalAbcState.reset();
		});

		// Register commands
		this.addCommand({
			id: 'abc-transpose-up',
			name: 'ABC: Raise pitch (semitone)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(1);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'abc-transpose-down',
			name: 'ABC: Lower pitch (semitone)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(-1);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'abc-transpose-octave-up',
			name: 'ABC: Raise pitch (octave)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(12);
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'abc-transpose-octave-down',
			name: 'ABC: Lower pitch (octave)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(-12);
					}
					return true;
				}
				return false;
			}
		});

		// Register scale degree commands (1-7)
		for (let i = 1; i <= 7; i++) {
			this.addCommand({
				id: `abc-set-degree-${i}`,
				name: `ABC: Set pitch to degree ${i}`,
				checkCallback: (checking: boolean) => {
					const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
					if (view) {
						if (!checking) {
							view.setSelectionToDegree(i);
						}
						return true;
					}
					return false;
				}
			});
		}
	}

    onunload() {
        const controls = document.getElementById(PLAYBACK_CONTROLS_ID);
        if (controls) controls.remove();

        // It is safe to detach here IF editor_view.ts is fixed (see below)
        this.app.workspace.detachLeavesOfType(ABC_EDITOR_VIEW_TYPE);
    }

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	refreshEditorTheme() {
		// Find all open ABC editor views and refresh their themes
		this.app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE).forEach(leaf => {
			const view = leaf.view;
			if (view instanceof AbcEditorView) {
				view.refreshTheme();
			}
		});
	}

	refreshVisualizer() {
		this.app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE).forEach(leaf => {
			const view = leaf.view;
			if (view instanceof AbcEditorView) {
				view.refreshVisualizer();
			}
		});
	}

	async codeProcessor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		ctx.addChild(new PlaybackElement(el, source, ctx));
	}
}
