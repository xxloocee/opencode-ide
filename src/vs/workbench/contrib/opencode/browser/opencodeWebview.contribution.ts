/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
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
	type IOpenCodeHostState,
} from '../../../../platform/opencode/common/opencodeHost.js';
import {
	isOpenCodeBridgeRequest,
	validateEditorOpenParams,
	validateResourceRevealParams,
	OpenCodeBridgeRequest,
	OpenCodeContextDto,
	OpenCodeCurrentSessionGetResult,
	OpenCodeInitDto,
	OpenCodeDiagnosticsGetRequest,
	OpenCodeDiagnosticsGetResult,
	OpenCodeDiagnosticDto,
	OpenCodeEditorOpenRequest,
	OpenCodeResourceRevealRequest,
	OpenCodeResourceDto,
	OpenCodeSelectionDto,
	OpenCodeThemeMode,
	OpenCodeWorkspaceFolderDto,
} from './opencodeProtocol.js';
import { OpenCodeViewId } from './views/opencodeView.js';

const OpenCodeSelectionCommandId = 'workbench.action.openCode.addSelection';
const OpenCodeCurrentSessionStorageKey = 'opencode.currentSession';
let current: OpenCodeWebviewContribution | undefined;

class OpenCodeWebviewContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openCodeWebview';
	private view: WebviewView | undefined;
	private lastContextSnapshot: string | undefined;
	private runtimePort: number | undefined;
	private readonly activeEditorListeners = this._register(new MutableDisposable<DisposableStore>());
	private readonly contextChangeScheduler = this._register(new RunOnceScheduler(() => this.postContextChanged(), 50));

	constructor(
		@IWebviewViewService webviews: IWebviewViewService,
		@IOpenCodeHostService private readonly host: IOpenCodeHostService,
		@ILogService private readonly log: ILogService,
		@IWorkspaceContextService private readonly ws: IWorkspaceContextService,
		@ICodeEditorService private readonly code: ICodeEditorService,
		@IEditorService private readonly editor: IEditorService,
		@IViewsService private readonly views: IViewsService,
		@IMarkerService private readonly markers: IMarkerService,
		@ICommandService private readonly cmd: ICommandService,
		@IStorageService private readonly storage: IStorageService,
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
		this.lastContextSnapshot = undefined;
		view.webview.options = { ...view.webview.options, retainContextWhenHidden: true };
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
			this.contextChangeScheduler.schedule();
		}));
		store.add(this.theme.onDidColorThemeChange(() => {
			this.postThemeChanged(view);
		}));
		store.add(this.editor.onDidActiveEditorChange(() => {
			this.installActiveEditorListeners();
			this.contextChangeScheduler.schedule();
		}));
		this.installActiveEditorListeners();

		const state: IOpenCodeHostState = await this.host.start().catch(err => {
			this.log.error('[OpenCodeWebview] Failed to start runtime', err);
			return {
				phase: OpenCodeHostPhase.Error,
				url: bootUrl,
				message: err instanceof Error ? err.message : String(err),
			};
		});

		if (state.phase === OpenCodeHostPhase.Running) {
			this.runtimePort = state.port;
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
		html, body { margin: 0; height: 100%; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
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
		html, body { margin: 0; height: 100%; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
		body { overflow: hidden; padding: 8px; box-sizing: border-box; }
		iframe {
			width: 100%;
			height: 100%;
			border: 0;
			border-radius: 10px;
			background: var(--vscode-sideBar-background, var(--vscode-editor-background));
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
		html, body { margin: 0; height: 100%; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
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
		if (!isOpenCodeBridgeRequest(value)) {
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

		this.postHostEvent(view, result);
	}

	private run(value: OpenCodeBridgeRequest) {
		if (value.method === 'context.get') {
			const context = this.ctx();
			this.lastContextSnapshot = snapshotContext(context);
			const init: OpenCodeInitDto = { ...context, theme: { mode: this.themeMode() } };
			return Promise.resolve(init);
		}

		if (value.method === 'session.current.get') {
			return Promise.resolve(this.getCurrentSession());
		}

		if (value.method === 'session.current.set') {
			this.setCurrentSession(value.params.sessionId);
			return Promise.resolve(null);
		}

		if (value.method === 'diagnostics.get') {
			return Promise.resolve(this.diagnostics(value.params));
		}

		if (value.method === 'editor.open') {
			validateEditorOpenParams(value.params);
			return this.edit(value.params);
		}

		if (value.method === 'resource.reveal') {
			validateResourceRevealParams(value.params);
			return this.reveal(value.params);
		}

		const unsupported: never = value;
		throw new Error(`Unsupported OpenCode bridge request: ${JSON.stringify(unsupported)}`);
	}

	private getCurrentSession(): OpenCodeCurrentSessionGetResult {
		return {
			sessionId: this.storage.get(this.currentSessionStorageKey(), StorageScope.WORKSPACE) ?? null,
		};
	}

	private setCurrentSession(sessionId: string | null): void {
		const key = this.currentSessionStorageKey();
		if (!sessionId) {
			this.storage.remove(key, StorageScope.WORKSPACE);
			return;
		}
		this.storage.store(key, sessionId, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private currentSessionStorageKey(): string {
		return `${OpenCodeCurrentSessionStorageKey}.${this.runtimePort ?? this.host.state.port ?? 'default'}`;
	}

	private ctx(): OpenCodeContextDto {
		const ws = this.ws.getWorkspace();
		const code = this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor();
		const model = code?.getModel();
		const sel = code?.getSelection();
		const path = toPath(model?.uri);
		const workspaceFolders: OpenCodeWorkspaceFolderDto[] = ws.folders
			.map(folder => toWorkspaceFolderDto(folder.name, folder.uri))
			.filter(hasWorkspaceFolderPath);
		const result: OpenCodeContextDto = {
			workspace: {
				folders: workspaceFolders,
			},
			editor: path
				? {
					path,
					uri: model!.uri.toString(),
					languageId: model!.getLanguageId(),
					selection: sel
						? toSelectionDto(sel.startLineNumber, sel.startColumn, sel.endLineNumber, sel.endColumn)
						: null,
				}
				: null,
		};
		return result;
	}

	private diagnostics(params?: OpenCodeDiagnosticsGetRequest['params']): OpenCodeDiagnosticsGetResult {
		const resource = params ? this.toResource(params) : this.activeResource();
		return {
			diagnostics: this.readDiagnostics(resource),
		};
	}

	private readDiagnostics(resource: URI | undefined): OpenCodeDiagnosticDto[] {
		if (!resource) {
			return [];
		}
		return this.markers.read({ resource }).map(marker => ({
			severity: toSeverity(marker.severity),
			message: marker.message,
			path: toPath(marker.resource) ?? marker.resource.toString(),
			uri: marker.resource.toString(),
			source: marker.source ?? undefined,
			code: typeof marker.code === 'string' ? marker.code : marker.code?.value,
			startLineNumber: marker.startLineNumber,
			startColumn: marker.startColumn,
			endLineNumber: marker.endLineNumber,
			endColumn: marker.endColumn,
		}));
	}

	private postContextChanged(view = this.view): void {
		const context = this.ctx();
		const nextSnapshot = snapshotContext(context);
		if (nextSnapshot === this.lastContextSnapshot) {
			return;
		}
		this.lastContextSnapshot = nextSnapshot;
		if (!this.postHostEvent(view, {
			source: 'opencode-host-event' as const,
			type: 'context.change' as const,
			context,
		})) {
			return;
		}
	}

	private postThemeChanged(view = this.view): void {
		if (!this.postHostEvent(view, {
			source: 'opencode-host-event' as const,
			type: 'theme.change' as const,
			theme: {
				mode: this.themeMode(),
			},
		})) {
			return;
		}
	}

	private themeMode(): OpenCodeThemeMode {
		const type = this.theme.getColorTheme().type;
		return type === ColorScheme.HIGH_CONTRAST_LIGHT || !isDark(type) ? 'light' : 'dark';
	}

	private async reveal(params: OpenCodeResourceRevealRequest['params']) {
		const resource = this.toResource(params);
		if (!resource) {
			return null;
		}
		await this.cmd.executeCommand('revealInExplorer', resource);
		return null;
	}

	private async edit(params: OpenCodeEditorOpenRequest['params']) {
		const resource = this.toResource(params);
		if (!resource) {
			return null;
		}
		await this.editor.openEditor({
			resource,
			options: params.selection
				? {
					selection: params.selection,
					preserveFocus: params.preserveFocus,
					pinned: params.pinned ?? true,
					revealIfOpened: params.revealIfOpened ?? true,
				}
				: {
					preserveFocus: params.preserveFocus,
					pinned: params.pinned ?? true,
					revealIfOpened: params.revealIfOpened ?? true,
				},
		});
		return null;
	}

	private installActiveEditorListeners(): void {
		const codeEditor = this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor();
		if (!codeEditor) {
			this.activeEditorListeners.clear();
			return;
		}

		const store = new DisposableStore();
		store.add(codeEditor.onDidChangeCursorSelection(() => {
			this.contextChangeScheduler.schedule();
		}));
		store.add(codeEditor.onDidChangeModel(() => {
			this.contextChangeScheduler.schedule();
		}));
		this.activeEditorListeners.value = store;
	}

	private activeResource(): URI | undefined {
		return (this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor())?.getModel()?.uri;
	}

	private toResource(resource: OpenCodeResourceDto): URI | undefined {
		if (typeof resource.uri === 'string' && resource.uri.length > 0) {
			return URI.parse(resource.uri);
		}
		if (typeof resource.path !== 'string' || resource.path.length === 0) {
			return undefined;
		}
		if (isAbsolutePath(resource.path)) {
			return URI.file(resource.path);
		}
		const folder = this.ws.getWorkspace().folders[0]?.uri;
		if (!folder) {
			return URI.file(resource.path);
		}
		return URI.joinPath(folder, ...resource.path.replaceAll('\\', '/').split('/').filter(Boolean));
	}

	async toggleSelection() {
		const code = this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor();
		const model = code?.getModel();
		const sel = code?.getSelection();
		const path = toPath(model?.uri);
		const selection = path && sel && !(sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn)
			? {
				path,
				text: model?.getValueInRange(sel) ?? '',
				startLineNumber: sel.startLineNumber,
				startColumn: sel.startColumn,
				endLineNumber: sel.endLineNumber,
				endColumn: sel.endColumn,
			}
			: undefined;

		if (this.views.isViewVisible(OpenCodeViewId)) {
			if (!selection) {
				this.views.closeView(OpenCodeViewId);
				return;
			}
			await this.views.openView(OpenCodeViewId, true);
			const view = this.view;
			if (!view) {
				return;
			}
			this.postHostEvent(view, {
				source: 'opencode-host-event' as const,
				type: 'selection.add' as const,
				selection,
			});
			return;
		}

		await this.views.openView(OpenCodeViewId, !!selection);
		if (!selection) {
			return;
		}

		const view = this.view;
		if (!view) {
			return;
		}

		this.postHostEvent(view, {
			source: 'opencode-host-event' as const,
			type: 'selection.add' as const,
			selection,
		});
	}

	private postHostEvent(view: WebviewView | undefined, payload: unknown): boolean {
		const webview = view?.webview;
		if (!webview) {
			return false;
		}
		void webview.postMessage(payload);
		return true;
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

function toPath(uri: URI | undefined) {
	if (!uri) {
		return null;
	}
	if (uri.scheme === 'file') {
		return uri.fsPath;
	}
	return uri.toString();
}

function toWorkspaceFolderDto(name: string, uri: URI): OpenCodeWorkspaceFolderDto | { name: string; path: null; uri: string } {
	return {
		name,
		path: toPath(uri),
		uri: uri.toString(),
	};
}

function hasWorkspaceFolderPath(value: OpenCodeWorkspaceFolderDto | { name: string; path: null; uri: string }): value is OpenCodeWorkspaceFolderDto {
	return typeof value.path === 'string' && value.path.length > 0;
}

function toSelectionDto(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): OpenCodeSelectionDto {
	return {
		startLineNumber,
		startColumn,
		endLineNumber,
		endColumn,
	};
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

function isAbsolutePath(path: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\') || path.startsWith('//');
}

function snapshotContext(context: OpenCodeContextDto): string {
	return JSON.stringify(context);
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: OpenCodeSelectionCommandId,
	weight: KeybindingWeight.WorkbenchContrib + 100,
	when: ContextKeyExpr.and(EditorContextKeys.editorTextFocus),
	primary: KeyMod.CtrlCmd | KeyCode.KeyL,
	handler: () => {
		void current?.toggleSelection();
	},
});

registerWorkbenchContribution2(OpenCodeWebviewContribution.ID, OpenCodeWebviewContribution, WorkbenchPhase.AfterRestored);
