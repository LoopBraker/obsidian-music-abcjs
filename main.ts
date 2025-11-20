import { MarkdownPostProcessorContext, Plugin } from 'obsidian';
import { PLAYBACK_CONTROLS_ID } from './cfg';
import { PlaybackElement } from './playback_element';
import { AbcEditorView, ABC_EDITOR_VIEW_TYPE } from './editor_view';

export default class MusicPlugin extends Plugin {
	onload() {
		// Register the ABC editor view
		this.registerView(
			ABC_EDITOR_VIEW_TYPE,
			(leaf) => new AbcEditorView(leaf)
		);

		this.registerMarkdownCodeBlockProcessor('abc', this.codeProcessor);
		this.registerMarkdownCodeBlockProcessor('music-abc', this.codeProcessor);

		// Although unused by us, a valid DOM element is needed to create a SynthController
		const unusedPlaybackControls = document.createElement('aside');
		unusedPlaybackControls.id = PLAYBACK_CONTROLS_ID;
		unusedPlaybackControls.style.display = 'none';
		document.body.appendChild(unusedPlaybackControls);
	}

	onunload() {
		document.getElementById(PLAYBACK_CONTROLS_ID).remove();
		
		// Detach all ABC editor views
		this.app.workspace.detachLeavesOfType(ABC_EDITOR_VIEW_TYPE);
	}

	async codeProcessor(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		ctx.addChild(new PlaybackElement(el, source, ctx));
	}
}
