/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme, isDark } from '../../../../platform/theme/common/theme.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWebviewViewService, type WebviewView } from '../../webviewView/browser/webviewViewService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import {
	IOpenCodeHostService,
	OpenCodeDefaultUrl,
	OpenCodeHostPhase,
} from '../../../../platform/opencode/common/opencodeHost.js';
import { OpenCodeViewId } from './views/opencodeView.js';

const OpenCodeSelectionCommandId = 'workbench.action.openCode.addSelection';
let current: OpenCodeWebviewContribution | undefined;

class OpenCodeWebviewContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openCodeWebview';
	private view: WebviewView | undefined;

	constructor(
		@IWebviewViewService webviews: IWebviewViewService,
		@IOpenCodeHostService private readonly host: IOpenCodeHostService,
		@ILogService private readonly log: ILogService,
		@IWorkspaceContextService private readonly ws: IWorkspaceContextService,
		@ICodeEditorService private readonly code: ICodeEditorService,
		@IEditorService private readonly editor: IEditorService,
		@IViewsService private readonly views: IViewsService,
		@IMarkerService private readonly markers: IMarkerService,
		@IFileDialogService private readonly files: IFileDialogService,
		@ICommandService private readonly cmd: ICommandService,
		@IThemeService private readonly theme: IThemeService,
		@ILifecycleService lifecycle: ILifecycleService,
	) {
		super();
		current = this;

		this._register(lifecycle.onWillShutdown(event => {
			event.join(this.host.stop(), {
				id: 'join.openCodeHost',
				label: localize('join.openCodeHost', "Stopping OpenCode runtime")
			});
		}));

		this._register(webviews.register(OpenCodeViewId, {
			resolve: async view => this.resolve(view),
		}));
	}

	private async resolve(view: WebviewView): Promise<void> {
		const bootUrl = this.host.state.url ?? OpenCodeDefaultUrl;
		this.view = view;
		view.webview.contentOptions = { allowScripts: true };
		view.webview.setHtml(this.boot(bootUrl));
		const store = new DisposableStore();
		store.add(view.onDispose(() => {
			if (this.view === view) {
				this.view = undefined;
			}
			store.dispose();
		}));
		store.add(view.webview.onMessage(evt => {
			void this.onMessage(view, evt.message);
		}));
		store.add(this.ws.onDidChangeWorkspaceFolders(() => {
			this.postContextChanged(view);
		}));
		store.add(this.theme.onDidColorThemeChange(() => {
			this.postThemeChanged(view);
		}));

		const state = await this.host.start().catch(err => {
			this.log.error('[OpenCodeWebview] Failed to start runtime', err);
			return {
				phase: OpenCodeHostPhase.Error,
				url: bootUrl,
				message: err instanceof Error ? err.message : String(err),
			};
		});

		if (state.phase === OpenCodeHostPhase.Running) {
			view.webview.setHtml(this.page(state.url ?? bootUrl));
			return;
		}

		view.webview.setHtml(this.error(state.message ?? localize('openCode.error.unknown', "OpenCode failed to start.")));
	}

	private boot(url: string): string {
		const title = localize('openCode.title', "OpenCode");
		const body = localize('openCode.boot', "Starting OpenCode runtime...");
		const detail = localize('openCode.boot.detail', "Preparing OpenCode at {0}", url);
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escape(title)}</title>
	<style>
		html, body { margin: 0; height: 100%; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); font-family: var(--vscode-font-family); }
		body { display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; text-align: center; line-height: 1.6; }
		#box { max-width: 420px; opacity: 0.95; }
		#msg { margin-top: 8px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
	</style>
</head>
<body>
	<div id="box">
		<h2>${escape(title)}</h2>
		<div>${escape(body)}</div>
		<div id="msg">${escape(detail)}</div>
	</div>
</body>
</html>`;
	}

	private page(url: string): string {
		const origin = new URL(url).origin;
		const title = localize('openCode.title', "OpenCode");
		const nonce = generateUuid();
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escape(title)}</title>
	<style>
		html, body { margin: 0; height: 100%; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); font-family: var(--vscode-font-family); }
		body { overflow: hidden; padding: 8px; box-sizing: border-box; }
		iframe {
			width: 100%;
			height: 100%;
			border: 0;
			border-radius: 10px;
			background: var(--vscode-sideBar-background);
		}
	</style>
</head>
<body>
	<iframe id="app" src="${escape(url)}" frameborder="0"></iframe>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const app = document.getElementById('app');
		window.addEventListener('message', (evt) => {
			if (evt.source === app.contentWindow && evt.origin === ${JSON.stringify(origin)}) {
				if (evt.data?.source === 'opencode-bridge') {
					vscode.postMessage(evt.data);
				}
				return;
			}
			if (evt.data?.source === 'opencode-host') {
				app.contentWindow?.postMessage(evt.data, ${JSON.stringify(origin)});
				return;
			}
			if (evt.data?.source === 'opencode-host-event') {
				app.contentWindow?.postMessage(evt.data, ${JSON.stringify(origin)});
			}
		});
	</script>
</body>
</html>`;
	}

	private error(msg: string): string {
		const title = localize('openCode.title', "OpenCode");
		const body = localize('openCode.error.body', "OpenCode runtime failed to start.");
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
	<title>${escape(title)}</title>
	<style>
		html, body { margin: 0; height: 100%; background: var(--vscode-sideBar-background); color: var(--vscode-sideBar-foreground); font-family: var(--vscode-font-family); }
		body { display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; text-align: center; line-height: 1.6; }
		#box { max-width: 420px; opacity: 0.95; }
		#msg { margin-top: 8px; color: var(--vscode-descriptionForeground); white-space: pre-wrap; }
	</style>
</head>
<body>
	<div id="box">
		<h2>${escape(title)}</h2>
		<div>${escape(body)}</div>
		<div id="msg">${escape(msg)}</div>
	</div>
</body>
</html>`;
	}

	private async onMessage(view: WebviewView, value: unknown): Promise<void> {
		if (!isReq(value)) {
			return;
		}

		const result = await this.run(value).then(
			data => ({
				source: 'opencode-host' as const,
				id: value.id,
				ok: true,
				result: data,
			}),
			err => ({
				source: 'opencode-host' as const,
				id: value.id,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			}),
		);

		await view.webview.postMessage(result);
	}

	private run(value: Req) {
		if (value.method === 'context.get') {
			return Promise.resolve(this.ctx());
		}

		if (value.method === 'directory.pick') {
			return this.pick(value.params);
		}

		if (value.method === 'editor.open') {
			return this.edit(value.params);
		}

		return this.open(value.params);
	}

	private ctx() {
		const ws = this.ws.getWorkspace();
		const code = this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor();
		const model = code?.getModel();
		const sel = code?.getSelection();
		const path = toPath(model?.uri);
		const result = {
			workspace: {
				folders: ws.folders
					.map(folder => ({
						name: folder.name,
						path: toPath(folder.uri),
					}))
					.filter(hasPath),
			},
			editor: path
				? {
					path,
					selection: sel
						? {
							startLineNumber: sel.startLineNumber,
							startColumn: sel.startColumn,
							endLineNumber: sel.endLineNumber,
							endColumn: sel.endColumn,
						}
						: null,
				}
				: null,
			diagnostics: model?.uri
				? this.markers.read({ resource: model.uri }).map(marker => ({
					severity: toSeverity(marker.severity),
					message: marker.message,
					path: toPath(marker.resource) ?? marker.resource.toString(),
					startLineNumber: marker.startLineNumber,
					startColumn: marker.startColumn,
					endLineNumber: marker.endLineNumber,
					endColumn: marker.endColumn,
				}))
				: [],
			theme: {
				mode: this.themeMode(),
			},
		};
		this.log.info(`[OpenCodeWebview] context.get returned ${result.workspace.folders.length} workspace folder(s)`);
		return result;
	}

	private postContextChanged(view = this.view): void {
		if (!view) {
			return;
		}
		void view.webview.postMessage({
			source: 'opencode-host-event' as const,
			type: 'context.change' as const,
			context: this.ctx(),
		});
	}

	private postThemeChanged(view = this.view): void {
		if (!view) {
			return;
		}
		void view.webview.postMessage({
			source: 'opencode-host-event' as const,
			type: 'theme.change' as const,
			theme: {
				mode: this.themeMode(),
			},
		});
	}

	private themeMode(): 'light' | 'dark' {
		const type = this.theme.getColorTheme().type;
		return type === ColorScheme.HIGH_CONTRAST_LIGHT || !isDark(type) ? 'light' : 'dark';
	}

	private async pick(params?: PickReq['params']) {
		const list = await this.files.showOpenDialog({
			title: params?.title,
			openLabel: localize('openCode.pick.open', "Open"),
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: params?.multiple === true,
			defaultUri: await this.files.defaultFolderPath(),
		});
		if (!list?.length) {
			return null;
		}
		return list.map(item => toPath(item) ?? item.toString());
	}

	private async open(params: PathReq['params']) {
		await this.cmd.executeCommand('revealInExplorer', URI.file(params.path));
		return null;
	}

	private async edit(params: EditorReq['params']) {
		await this.editor.openEditor({
			resource: URI.file(params.path),
			options: params.selection
				? {
					selection: params.selection,
					pinned: true,
				}
				: {
					pinned: true,
				},
		});
		return null;
	}

	async postSelection() {
		const view = await this.views.openView(OpenCodeViewId, true) as WebviewView | null | undefined ?? this.view;
		if (!view) {
			return;
		}
		this.view = view;
		const code = this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor();
		const model = code?.getModel();
		const sel = code?.getSelection();
		const path = toPath(model?.uri);
		if (!path || !sel) {
			return;
		}
		if (sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn) {
			return;
		}
		void view.webview.postMessage({
			source: 'opencode-host-event' as const,
			type: 'selection.add' as const,
			selection: {
				path,
				text: model?.getValueInRange(sel) ?? '',
				startLineNumber: sel.startLineNumber,
				startColumn: sel.startColumn,
				endLineNumber: sel.endLineNumber,
				endColumn: sel.endColumn,
			},
		});
	}
}

function escape(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll('\'', '&#39;');
}

type ContextReq = {
	source: 'opencode-bridge';
	id: string;
	method: 'context.get';
};

type PickReq = {
	source: 'opencode-bridge';
	id: string;
	method: 'directory.pick';
	params?: {
		title?: string;
		multiple?: boolean;
	};
};

type PathReq = {
	source: 'opencode-bridge';
	id: string;
	method: 'path.open';
	params: {
		path: string;
		app?: string;
	};
};

type EditorReq = {
	source: 'opencode-bridge';
	id: string;
	method: 'editor.open';
	params: {
		path: string;
		selection?: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		};
	};
};

type Req = ContextReq | PickReq | PathReq | EditorReq;

function isReq(value: unknown): value is Req {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const data = value as { source?: unknown; id?: unknown; method?: unknown; params?: unknown };
	if (data.source !== 'opencode-bridge' || typeof data.id !== 'string' || typeof data.method !== 'string') {
		return false;
	}
	if (data.method === 'context.get') {
		return true;
	}
	if (data.method === 'directory.pick') {
		return true;
	}
	if (data.method === 'path.open') {
		return typeof (data.params as { path?: unknown } | undefined)?.path === 'string';
	}
	if (data.method === 'editor.open') {
		return typeof (data.params as { path?: unknown } | undefined)?.path === 'string';
	}
	return false;
}

function toPath(uri: URI | undefined) {
	if (!uri) {
		return null;
	}
	if (uri.scheme === 'file') {
		return uri.fsPath;
	}
	return uri.toString();
}

function hasPath(value: { name: string; path: string | null }): value is { name: string; path: string } {
	return typeof value.path === 'string' && value.path.length > 0;
}

function toSeverity(value: MarkerSeverity) {
	if (value === MarkerSeverity.Error) {
		return 'error';
	}
	if (value === MarkerSeverity.Warning) {
		return 'warning';
	}
	if (value === MarkerSeverity.Info) {
		return 'info';
	}
	return 'hint';
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: OpenCodeSelectionCommandId,
	weight: KeybindingWeight.WorkbenchContrib + 100,
	when: ContextKeyExpr.and(EditorContextKeys.editorTextFocus),
	primary: KeyMod.CtrlCmd | KeyCode.KeyL,
	handler: () => {
		void current?.postSelection();
	},
});

registerWorkbenchContribution2(OpenCodeWebviewContribution.ID, OpenCodeWebviewContribution, WorkbenchPhase.AfterRestored);
