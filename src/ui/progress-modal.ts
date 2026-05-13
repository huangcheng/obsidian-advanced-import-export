import { App, Modal } from "obsidian";
import { ImportExportSession, SessionEvent } from "../orchestrator/session";

interface RowState {
	label: string;
	status: "pending" | "running" | "success" | "failed";
	detail?: string;
}

/**
 * Renders live progress for an `ImportExportSession`. Displays per-row
 * status, supports cancellation, and surfaces a final summary with a
 * "Retry failed" option when applicable.
 */
export class ProgressModal extends Modal {
	private rows: RowState[] = [];
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;
	private cancelBtn!: HTMLButtonElement;
	private closeBtn!: HTMLButtonElement;
	private retryFailedBtn?: HTMLButtonElement;
	private succeeded = 0;
	private failed = 0;
	private total = 0;

	constructor(
		app: App,
		private readonly session: ImportExportSession,
		private readonly title: string,
		private readonly initialLabels: string[],
		private readonly onRetryFailed?: (failedIndices: number[]) => void,
	) {
		super(app);
		this.rows = initialLabels.map((label) => ({ label, status: "pending" }));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.title });
		this.statusEl = contentEl.createEl("p", { text: "Starting…" });
		this.listEl = contentEl.createEl("ul");
		this.renderRows();

		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		this.cancelBtn = buttons.createEl("button", { text: "Cancel" });
		this.cancelBtn.addEventListener("click", () => this.session.cancel());
		this.closeBtn = buttons.createEl("button", { text: "Close" });
		this.closeBtn.disabled = true;
		this.closeBtn.addEventListener("click", () => this.close());

		this.session.subscribe((event) => this.handleEvent(event));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private handleEvent(event: SessionEvent): void {
		switch (event.type) {
			case "started":
				this.total = event.total;
				this.statusEl.setText(`0 / ${event.total}`);
				return;
			case "note-succeeded":
				this.succeeded++;
				this.markRow(event.index, "success");
				this.updateStatus();
				return;
			case "note-failed":
				this.failed++;
				this.markRow(event.index, "failed", event.error);
				this.updateStatus();
				return;
			case "cancelled":
				this.statusEl.setText(
					`Cancelled (${event.completed} / ${event.total} processed)`,
				);
				this.finalizeButtons();
				return;
			case "done":
				this.statusEl.setText(
					`Done — ${event.succeeded} succeeded, ${event.failed} failed`,
				);
				this.finalizeButtons();
				return;
		}
	}

	private renderRows(): void {
		this.listEl.empty();
		this.rows.forEach((row, idx) => {
			const li = this.listEl.createEl("li");
			li.createEl("span", { text: this.statusGlyph(row.status), cls: `aie-status aie-${row.status}` });
			li.createEl("span", { text: ` ${row.label}` });
			if (row.detail) li.createEl("span", { text: ` — ${row.detail}`, cls: "aie-row-detail" });
			(li as HTMLElement).dataset.index = String(idx);
		});
	}

	private markRow(index: number, status: RowState["status"], detail?: string): void {
		const row = this.rows[index];
		if (!row) return;
		row.status = status;
		row.detail = detail;
		this.renderRows();
	}

	private updateStatus(): void {
		this.statusEl.setText(`${this.succeeded + this.failed} / ${this.total}`);
	}

	private finalizeButtons(): void {
		this.cancelBtn.disabled = true;
		this.closeBtn.disabled = false;
		if (this.failed > 0 && this.onRetryFailed && !this.retryFailedBtn) {
			const buttons = this.cancelBtn.parentElement;
			if (!buttons) return;
			this.retryFailedBtn = buttons.createEl("button", { text: "Retry failed", cls: "mod-cta" });
			this.retryFailedBtn.addEventListener("click", () => {
				const failedIndices = this.rows
					.map((r, i) => (r.status === "failed" ? i : -1))
					.filter((i) => i >= 0);
				this.onRetryFailed?.(failedIndices);
			});
		}
	}

	private statusGlyph(status: RowState["status"]): string {
		switch (status) {
			case "pending": return "•";
			case "running": return "…";
			case "success": return "✓";
			case "failed": return "✗";
		}
	}
}
