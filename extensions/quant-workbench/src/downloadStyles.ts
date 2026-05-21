/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const downloadStyles = `
	.modal__dialog--compact { width: min(560px, 100%); border-radius: 12px; }
	.modal__header--compact { padding: 12px 16px; }
	.modal__header--compact h2 { font-size: 1rem; }
	.modal__subtitle { display: block; margin-top: 3px; font-size: 11px; color: #9ca3af; }
	.modal__body--compact { gap: 10px; padding: 14px 16px; }
	.download-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
	.modal__body--compact .field { gap: 4px; font-size: 11px; }
	.modal__body--compact .field input,
	.modal__body--compact .field select { padding: 7px 10px; border-radius: 8px; font-size: 12px; }
	.modal__body--compact .field select { appearance: none; -webkit-appearance: none; background-image: none; padding-right: 30px; }
	.modal__body--compact .field--select::after { right: 11px; top: auto; bottom: 13px; border-left-width: 4px; border-right-width: 4px; border-top-width: 4px; border-top-color: #64748b; }
	.radio-row--compact { min-height: 32px; border-radius: 8px; }
	.radio-row--compact label { flex: 1; padding: 6px 8px; font-size: 12px; }
	.modal__hint--compact { display: grid; gap: 5px; padding: 8px 10px; border-radius: 8px; font-size: 11px; background: #f8fafc; border-color: #d7e0ee; }
	.modal__hint--compact code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 4px 7px; border-radius: 6px; background: #eef4ff; border: 1px solid #dbe7ff; font-family: Consolas, "Courier New", monospace; color: #334155; }
	.modal__footer--compact { padding: 10px 16px 14px; }
	.modal__footer--compact .button { padding: 7px 14px; font-size: 12px; }
	.download-task-row { align-items: stretch; padding: 8px 10px; }
	.download-task-row__main { flex: 1; gap: 4px; }
	.download-task-row__top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	.download-task-row__progress { height: 5px; border-radius: 999px; overflow: hidden; background: #eef2f7; }
	.download-task-row__progress span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), #60a5fa); transition: width 180ms ease; }
	.download-task-row__message { font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.download-task-row__command { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 6px; border-radius: 5px; background: #f1f5f9; color: #475569; font-family: Consolas, "Courier New", monospace; font-size: 10px; }
	.download-task-row__percent { align-self: center; min-width: 40px; text-align: right; font-size: 12px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
	@media (max-width: 760px) {
		.download-form-grid { grid-template-columns: 1fr; }
		.modal { padding: 12px; }
	}
`;
