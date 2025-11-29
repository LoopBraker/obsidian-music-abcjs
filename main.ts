import { MarkdownPostProcessorContext, Plugin, MarkdownView } from 'obsidian';
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

		// 2. NEW: Handle Focus Changes (Obscure/Unobscure)
		// 1. AUTO-CLOSE: Close editor if note is closed
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				const leaves = this.app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
				if (leaves.length === 0) return;

				const abcLeaf = leaves[0];
				const view = abcLeaf.view as AbcEditorView;

				if (view && view.associatedFilePath) {
					const isFileStillOpen = this.app.workspace.getLeavesOfType('markdown').some(leaf => {
						const mdView = leaf.view as MarkdownView;
						return mdView.file && mdView.file.path === view.associatedFilePath;
					});

					if (!isFileStillOpen) {
						abcLeaf.detach();
					}
				}
			})
		);

		// 2. LOCK/UNLOCK: Handle Focus Changes
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				const leaves = this.app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
				if (leaves.length === 0) return;

				const abcLeaf = leaves[0];
				const view = abcLeaf.view as AbcEditorView;

				if (view && view.associatedFilePath) {
					const isFileStillOpen = this.app.workspace.getLeavesOfType('markdown').some(leaf => {
						const mdView = leaf.view as MarkdownView;
						return mdView.file && mdView.file.path === view.associatedFilePath;
					});

					if (!isFileStillOpen) {
						abcLeaf.detach();
					}
				}
			})
		);

		// 2. LOCK/UNLOCK: Handle Focus Changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				// Find our editor view
				const abcLeaves = this.app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE);
				if (abcLeaves.length === 0) return;

				const abcLeaf = abcLeaves[0];
				const view = abcLeaf.view as AbcEditorView;

				if (!view.associatedFilePath) return;

				// Update strict mode from settings
				view.updateOverlayMode(this.settings.restrictEditorToActiveNote);

				// Case A: User clicked Editor. 
				// The view handles the click logic (click-to-dismiss) if restrictMode is false.
				if (leaf && leaf.view.getViewType() === ABC_EDITOR_VIEW_TYPE) {
					return;
				}

				// Case B: User clicked a Markdown file.
				if (leaf && leaf.view instanceof MarkdownView) {
					const mdView = leaf.view as MarkdownView;
					if (mdView.file && mdView.file.path === view.associatedFilePath) {
						view.setObscured(false); // UNLOCK
					} else {
						view.setObscured(true);  // LOCK (Show Overlay)
					}
					return;
				}

				// Case C: Other (Settings, Graph) -> Lock
				if (leaf) {
					view.setObscured(true);
				}
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
			name: 'ABC: Raise pitch (prefer sharps)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(1, false); // false = prefer sharps
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'abc-transpose-up-flat',
			name: 'ABC: Raise pitch (prefer flats)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(1, true); // true = prefer flats
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'abc-transpose-down',
			name: 'ABC: Lower pitch (prefer flats)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(-1, true); // true = prefer flats
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: 'abc-transpose-down-sharp',
			name: 'ABC: Lower pitch (prefer sharps)',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(AbcEditorView);
				if (view) {
					if (!checking) {
						view.transposeSelection(-1, false); // false = prefer sharps
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

	refreshEditorLocking() {
		// Update the mode for all active editors immediately
		const strict = this.settings.restrictEditorToActiveNote;
		this.app.workspace.getLeavesOfType(ABC_EDITOR_VIEW_TYPE).forEach(leaf => {
			(leaf.view as AbcEditorView).updateOverlayMode(strict);
		});

		// Trigger a layout check to apply current obscuration state
		const activeLeaf = this.app.workspace.getLeaf(false);
		this.app.workspace.trigger('active-leaf-change', activeLeaf);
	}

	async codeProcessor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		ctx.addChild(new PlaybackElement(el, source, ctx));
	}
}