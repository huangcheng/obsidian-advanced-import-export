import { App, Modal, Notice, Setting } from "obsidian";
import { BEAR_NAME } from "./brand-names";

export interface BearImportRequest {
	noteId: string;
}

type ImportPhase = "input" | "waiting" | "done";

export class BearImportModal extends Modal {
	private phase: ImportPhase = "input";
	private noteIdInput = "";

	constructor(
		app: App,
		private readonly onSubmit: (request: BearImportRequest) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		new Setting(contentEl).setHeading().setName(`Import from ${BEAR_NAME}`);

		if (this.phase === "input") {
			this.renderInputPhase(contentEl);
		} else if (this.phase === "waiting") {
			this.renderWaitingPhase(contentEl);
		} else {
			this.renderDonePhase(contentEl);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	setWaiting(): void {
		this.phase = "waiting";
		if (this.contentEl) {
			this.onOpen();
		}
	}

	setDone(success: boolean, message: string): void {
		this.phase = "done";
		this._lastResult = { success, message };
		if (this.contentEl) {
			this.onOpen();
		}
	}

	private _lastResult: { success: boolean; message: string } | null = null;

	private renderInputPhase(el: HTMLElement): void {
		el.createEl("p", {
			text: `Enter a ${BEAR_NAME} note identifier (UUID) or a ${BEAR_NAME} URL. The note opens in the source app and its content is sent back to Obsidian.`,
		});

		new Setting(el)
			.setName("Note identifier or URL")
			.setDesc("e.g. 68C7AF31-DA55-4E93-B5E8-B5E2E5A0FCEB or bear://x-callback-url/open-note?id=...")
			.addText((text) =>
				text
					.setPlaceholder("Bear note UUID or URL")
					.setValue(this.noteIdInput)
					.onChange((v) => (this.noteIdInput = v.trim())),
			);

		const buttons = el.createDiv({ cls: "modal-button-container" });
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
		const importBtn = buttons.createEl("button", { text: "Import", cls: "mod-cta" });
		importBtn.addEventListener("click", () => {
			if (!this.noteIdInput) {
				new Notice(`Please enter a ${BEAR_NAME} identifier or URL.`);
				return;
			}
			this.onSubmit({ noteId: this.noteIdInput });
		});
	}

	private renderWaitingPhase(el: HTMLElement): void {
		el.createEl("p", {
			text: `Waiting for ${BEAR_NAME} to respond… switch to the source app if needed and confirm the note open request.`,
		});
		el.createEl("p", { text: `⏳ ${BEAR_NAME} callback pending…`, cls: "aie-bear-status" });

		const buttons = el.createDiv({ cls: "modal-button-container" });
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	private renderDonePhase(el: HTMLElement): void {
		if (this._lastResult) {
			const msg = this._lastResult.success
				? `✓ ${this._lastResult.message}`
				: `✗ ${this._lastResult.message}`;
			el.createEl("p", { text: msg, cls: this._lastResult.success ? "aie-bear-success" : "aie-bear-error" });
		}

		const buttons = el.createDiv({ cls: "modal-button-container" });
		const closeBtn = buttons.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => this.close());
	}
}