/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { dirname } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IOutlineModelService } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { DocumentSymbol, symbolKindNames } from '../../../../editor/common/languages.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InputFocusedContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ColorScheme, isDark } from '../../../../platform/theme/common/theme.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWebviewViewService, type WebviewView } from '../../webviewView/browser/webviewViewService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ITaskService } from '../../tasks/common/taskService.js';
import { ITaskEvent, TaskEventKind } from '../../tasks/common/tasks.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
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
	OpenCodeDiagnosticFileSummaryDto,
	OpenCodeDocumentSymbolsGetRequest,
	OpenCodeDocumentSymbolsGetResult,
	OpenCodeEditorOpenRequest,
	OpenCodeEditorReadRangeRequest,
	OpenCodeEditorReadRangeResult,
	OpenCodeLastTaskGetResult,
	OpenCodeLastTerminalGetResult,
	OpenCodeResourceRevealRequest,
	OpenCodeResourceDto,
	OpenCodeSelectionDto,
	OpenCodeTaskSnapshotDto,
	OpenCodeTerminalSnapshotDto,
	OpenCodeThemeMode,
	OpenCodeWorkspaceDiagnosticsDto,
	OpenCodeWorkspaceDiagnosticsGetResult,
	OpenCodeWorkspaceFolderDto,
} from './opencodeProtocol.js';
import { OpenCodeViewId } from './views/opencodeView.js';

const OpenCodeSelectionCommandId = 'workbench.action.openCode.addSelection';
const OpenCodeCurrentSessionStorageKey = 'opencode.currentSession';
const OpenCodeWorkspaceDiagnosticsLimit = 12;
const OpenCodeWorkspaceDiagnosticFilesLimit = 8;
const OpenCodeTaskProblemsLimit = 8;
const OpenCodeTerminalBufferLines = 80;
const OpenCodeTerminalOutputChars = 12_000;
type MutableOpenCodeTaskSnapshot = { -readonly [K in keyof OpenCodeTaskSnapshotDto]: OpenCodeTaskSnapshotDto[K] };
let current: OpenCodeWebviewContribution | undefined;

class OpenCodeWebviewContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.openCodeWebview';
	private view: WebviewView | undefined;
	private lastContextSnapshot: string | undefined;
	private sessionScopeRoot: string | undefined;
	private lastTaskSnapshot: OpenCodeTaskSnapshotDto | null = null;
	private readonly activeEditorListeners = this._register(new MutableDisposable<DisposableStore>());
	private readonly contextChangeScheduler = this._register(new RunOnceScheduler(() => this.postContextChanged(), 50));

	constructor(
		@IWebviewViewService webviews: IWebviewViewService,
		@IOpenCodeHostService private readonly host: IOpenCodeHostService,
		@ILogService private readonly log: ILogService,
		@IWorkspaceContextService private readonly ws: IWorkspaceContextService,
		@ICodeEditorService private readonly code: ICodeEditorService,
		@IOutlineModelService private readonly outline: IOutlineModelService,
		@IEditorService private readonly editor: IEditorService,
		@IViewsService private readonly views: IViewsService,
		@IMarkerService private readonly markers: IMarkerService,
		@ICommandService private readonly cmd: ICommandService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IStorageService private readonly storage: IStorageService,
		@IThemeService private readonly theme: IThemeService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@ITaskService private readonly tasks: ITaskService,
		@ITerminalService private readonly terminals: ITerminalService,
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
		this._register(this.tasks.onDidStateChange(event => {
			this.onTaskStateChange(event);
		}));

		this._register(webviews.register(OpenCodeViewId, {
			resolve: async view => this.resolve(view),
		}));
	}

	private async resolve(view: WebviewView): Promise<void> {
		const bootUrl = this.host.state.url ?? OpenCodeDefaultUrl;
		this.sessionScopeRoot = this.serverProjectRoot();
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
		store.add(this.textFiles.files.onDidChangeDirty(() => {
			this.contextChangeScheduler.schedule();
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
			view.webview.setHtml(this.page(state.url ?? bootUrl));
			return;
		}

		view.webview.setHtml(this.error(state.message ?? localize('openCode.error.unknown', "OpenCode failed to start.")));
	}

	private boot(url: string): string {
		const title = localize('openCode.title', "OpenCode");
		// allow-any-unicode-next-line
		const body = localize('openCode.boot', "正在启动 OpenCode...");
		// allow-any-unicode-next-line
		const detail = localize('openCode.boot.detail', "请稍候");
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
		const iframeUrl = this.appUrl(url, this.sessionScopeRoot);
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
	<iframe id="app" src="${escape(iframeUrl)}" frameborder="0"></iframe>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const app = document.getElementById('app');
		const pendingHostMessages = [];
		let appLoaded = false;
		const postToApp = (data) => {
			if (!appLoaded) {
				pendingHostMessages.push(data);
				return;
			}
			app.contentWindow?.postMessage(data, ${JSON.stringify(origin)});
		};
		app.addEventListener('load', () => {
			appLoaded = true;
			for (const data of pendingHostMessages.splice(0)) {
				app.contentWindow?.postMessage(data, ${JSON.stringify(origin)});
			}
		});
		window.addEventListener('message', (evt) => {
			if (evt.source === app.contentWindow && evt.origin === ${JSON.stringify(origin)}) {
				if (evt.data?.source === 'opencode-bridge') {
					vscode.postMessage(evt.data);
				}
				return;
			}
			if (evt.data?.source === 'opencode-host') {
				postToApp(evt.data);
				return;
			}
			if (evt.data?.source === 'opencode-host-event') {
				postToApp(evt.data);
			}
		});
	</script>
	</body>
</html>`;
	}

	private appUrl(url: string, root = this.serverProjectRoot()): string {
		if (!root) {
			return url;
		}
		const endpoint = new URL(url);
		endpoint.pathname = `/${base64UrlEncode(root)}`;
		return endpoint.toString();
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

		if (value.method === 'diagnostics.workspace.get') {
			return Promise.resolve(this.workspaceDiagnostics());
		}

		if (value.method === 'document.symbols') {
			return this.documentSymbols(value.params);
		}

		if (value.method === 'editor.readRange') {
			return Promise.resolve(this.readRange(value.params));
		}

		if (value.method === 'task.last.get') {
			return Promise.resolve(this.lastTask());
		}

		if (value.method === 'terminal.last.get') {
			return this.lastTerminal();
		}

		if (value.method === 'clipboard.writeText') {
			return this.clipboardService.writeText(value.params.text);
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
		const scope = this.sessionScopeRoot ?? this.workspaceSessionScope();
		if (!scope) {
			return OpenCodeCurrentSessionStorageKey;
		}
		return `${OpenCodeCurrentSessionStorageKey}.${base64UrlEncode(scope)}`;
	}

	private workspaceSessionScope(): string | undefined {
		const folders = this.ws.getWorkspace().folders
			.filter(folder => folder.uri.scheme === 'file')
			.map(folder => folder.uri.fsPath);
		if (folders.length > 0) {
			return folders.join('|');
		}

		const configuration = this.ws.getWorkspace().configuration;
		if (configuration?.scheme === 'file') {
			return configuration.fsPath;
		}

		return undefined;
	}

	private ctx(): OpenCodeContextDto {
		const ws = this.ws.getWorkspace();
		const code = this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor();
		const model = code?.getModel();
		const sel = code?.getSelection();
		const position = code?.getPosition();
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
					cursor: position
						? {
							lineNumber: position.lineNumber,
							column: position.column,
						}
						: null,
					selection: sel
						? toSelectionDto(sel.startLineNumber, sel.startColumn, sel.endLineNumber, sel.endColumn)
						: null,
					dirty: this.textFiles.isDirty(model!.uri),
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

	private workspaceDiagnostics(): OpenCodeWorkspaceDiagnosticsGetResult {
		return {
			summary: this.readWorkspaceDiagnosticsSummary(),
		};
	}

	private lastTask(): OpenCodeLastTaskGetResult {
		return {
			task: this.lastTaskSnapshot,
		};
	}

	private async lastTerminal(): Promise<OpenCodeLastTerminalGetResult> {
		return {
			terminal: await this.readLastTerminalSnapshot(),
		};
	}

	private readDiagnostics(resource: URI | undefined): OpenCodeDiagnosticDto[] {
		if (!resource) {
			return [];
		}
		return this.markers.read({ resource }).map(marker => this.toDiagnosticDto(marker));
	}

	private readWorkspaceDiagnosticsSummary(): OpenCodeWorkspaceDiagnosticsDto {
		const markers = this.markers.read({
			severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info | MarkerSeverity.Hint,
		}).filter(marker => this.isWorkspaceDiagnosticResource(marker.resource));
		const total = {
			errors: 0,
			warnings: 0,
			infos: 0,
			hints: 0,
		};
		const files = new Map<string, {
			path: string;
			uri: string;
			errors: number;
			warnings: number;
			infos: number;
			hints: number;
		}>();

		for (const marker of markers) {
			addSeverityCount(total, marker.severity);
			const path = toPath(marker.resource) ?? marker.resource.toString();
			const key = marker.resource.toString();
			let summary = files.get(key);
			if (!summary) {
				summary = {
					path,
					uri: key,
					errors: 0,
					warnings: 0,
					infos: 0,
					hints: 0,
				};
				files.set(key, summary);
			}
			addSeverityCount(summary, marker.severity);
		}

		const diagnostics = markers
			.sort(compareDiagnostics)
			.slice(0, OpenCodeWorkspaceDiagnosticsLimit)
			.map(marker => this.toDiagnosticDto(marker));
		const topFiles: OpenCodeDiagnosticFileSummaryDto[] = Array.from(files.values())
			.sort(compareDiagnosticFiles)
			.slice(0, OpenCodeWorkspaceDiagnosticFilesLimit);

		return {
			total,
			files: topFiles,
			diagnostics,
		};
	}

	private async documentSymbols(params?: OpenCodeDocumentSymbolsGetRequest['params']): Promise<OpenCodeDocumentSymbolsGetResult> {
		const model = params ? this.findOpenModel(this.toResource(params)) : this.activeModel();
		if (!model) {
			return { symbols: [] };
		}
		const outline = await this.outline.getOrCreate(model, CancellationToken.None);
		return {
			symbols: outline.asListOfDocumentSymbols().map(toDocumentSymbolDto),
		};
	}

	private readRange(params?: OpenCodeEditorReadRangeRequest['params']): OpenCodeEditorReadRangeResult {
		const model = params ? this.findOpenModel(this.toResource(params)) : this.activeModel();
		if (!model) {
			throw new Error('editor.readRange: no open editor model found');
		}

		const range = model.validateRange(params?.range ?? model.getFullModelRange());
		const path = toPath(model.uri) ?? model.uri.toString();
		return {
			path,
			uri: model.uri.toString(),
			languageId: model.getLanguageId(),
			range: toSelectionDto(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
			text: model.getValueInRange(range),
			dirty: this.textFiles.isDirty(model.uri),
		};
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
		store.add(codeEditor.onDidChangeModelLanguage(() => {
			this.contextChangeScheduler.schedule();
		}));
		this.activeEditorListeners.value = store;
	}

	private activeResource(): URI | undefined {
		return this.activeModel()?.uri;
	}

	private onTaskStateChange(event: ITaskEvent): void {
		if (event.kind === TaskEventKind.Changed) {
			return;
		}

		const task = event.__task;
		const terminalId = getTaskEventTerminalId(event);
		const snapshot: MutableOpenCodeTaskSnapshot = this.lastTaskSnapshot?.id === event.taskId
			? { ...this.lastTaskSnapshot }
			: {
				id: event.taskId,
				label: task.configurationProperties.name ?? task._label ?? event.taskName ?? 'Task',
				detail: task.configurationProperties.detail,
				type: task.type,
				sourceKind: task._source.kind,
				workspaceFolder: toPath(task.getWorkspaceFolder()?.uri) ?? undefined,
				runType: event.runType,
				status: 'running',
				terminalId,
				hasProblemMatcherErrors: false,
				problemCount: 0,
				problems: [],
			};

		snapshot.label = task.configurationProperties.name ?? task._label ?? event.taskName ?? snapshot.label;
		snapshot.detail = task.configurationProperties.detail;
		snapshot.type = task.type;
		snapshot.sourceKind = task._source.kind;
		snapshot.workspaceFolder = toPath(task.getWorkspaceFolder()?.uri) ?? undefined;
		snapshot.runType = event.runType;
		if (terminalId !== undefined) {
			snapshot.terminalId = terminalId;
		}

		switch (event.kind) {
			case TaskEventKind.Start:
			case TaskEventKind.ProcessStarted:
			case TaskEventKind.AcquiredInput:
			case TaskEventKind.DependsOnStarted:
			case TaskEventKind.Active:
			case TaskEventKind.Inactive:
			case TaskEventKind.ProblemMatcherStarted:
				snapshot.status = 'running';
				break;
			case TaskEventKind.ProcessEnded:
				snapshot.status = 'completed';
				snapshot.exitCode = event.exitCode;
				snapshot.durationMs = event.durationMs;
				break;
			case TaskEventKind.End:
				snapshot.status = 'completed';
				break;
			case TaskEventKind.ProblemMatcherEnded:
				snapshot.status = 'completed';
				snapshot.hasProblemMatcherErrors = event.hasErrors;
				break;
			case TaskEventKind.ProblemMatcherFoundErrors:
				snapshot.status = 'completed';
				snapshot.hasProblemMatcherErrors = true;
				break;
			case TaskEventKind.Terminated:
				snapshot.status = 'terminated';
				break;
		}

		if (snapshot.terminalId !== undefined) {
			const problems = this.readTaskProblems(snapshot.terminalId);
			if (problems.length > 0) {
				snapshot.problems = problems;
				snapshot.problemCount = problems.length;
			} else if (event.kind === TaskEventKind.Start) {
				snapshot.problems = [];
				snapshot.problemCount = 0;
			}
		}

		this.lastTaskSnapshot = snapshot;
	}

	private readTaskProblems(terminalId: number): OpenCodeDiagnosticDto[] {
		const byOwner = this.tasks.getTaskProblems(terminalId);
		if (!byOwner) {
			return [];
		}

		const diagnostics: OpenCodeDiagnosticDto[] = [];
		for (const entry of byOwner.values()) {
			for (let index = 0; index < entry.markers.length; index++) {
				const marker = entry.markers[index];
				const resource = entry.resources[index];
				diagnostics.push({
					severity: toSeverity(marker.severity),
					message: marker.message,
					path: toPath(resource) ?? resource?.toString() ?? '',
					uri: resource?.toString() ?? '',
					source: marker.source ?? undefined,
					code: typeof marker.code === 'string' ? marker.code : marker.code?.value,
					startLineNumber: marker.startLineNumber,
					startColumn: marker.startColumn,
					endLineNumber: marker.endLineNumber,
					endColumn: marker.endColumn,
				});
			}
		}
		return diagnostics
			.filter(diagnostic => diagnostic.uri.length > 0)
			.sort(compareOpenCodeDiagnostics)
			.slice(0, OpenCodeTaskProblemsLimit);
	}

	private async readLastTerminalSnapshot(): Promise<OpenCodeTerminalSnapshotDto | null> {
		const terminal = this.terminals.activeInstance;
		if (!terminal) {
			return null;
		}

		const xterm = terminal.xterm ?? await terminal.xtermReadyPromise;
		if (!xterm) {
			return null;
		}

		const detection = terminal.capabilities.get(TerminalCapability.CommandDetection);
		const latestCommand = detection?.commands.at(-1);
		if (latestCommand) {
			const output = latestCommand.getOutput();
			const trimmed = trimTerminalText(output);
			return {
				title: terminal.title,
				cwd: terminal.cwd,
				shellType: terminal.shellType,
				command: latestCommand.command || undefined,
				output: trimmed.text || undefined,
				exitCode: latestCommand.exitCode,
				source: 'command',
				hasCommandDetection: true,
				lineCount: countTerminalLines(output),
				truncated: trimmed.truncated,
			};
		}

		const lines = Array.from(xterm.getBufferReverseIterator())
			.slice(0, OpenCodeTerminalBufferLines)
			.reverse();
		if (lines.length === 0) {
			return {
				title: terminal.title,
				cwd: terminal.cwd,
				shellType: terminal.shellType,
				source: 'buffer',
				hasCommandDetection: !!detection,
				lineCount: 0,
				truncated: false,
			};
		}

		const output = lines.join('\n');
		const trimmed = trimTerminalText(output);
		return {
			title: terminal.title,
			cwd: terminal.cwd,
			shellType: terminal.shellType,
			output: trimmed.text || undefined,
			source: 'buffer',
			hasCommandDetection: !!detection,
			lineCount: lines.length,
			truncated: trimmed.truncated,
		};
	}

	private isWorkspaceDiagnosticResource(resource: URI): boolean {
		if (this.ws.getWorkspaceFolder(resource)) {
			return true;
		}

		const active = this.activeResource();
		return !!active && resource.toString() === active.toString();
	}

	private serverProjectRoot(): string | undefined {
		const active = this.activeResource();
		const activeFolder = active ? this.ws.getWorkspaceFolder(active) : null;
		if (activeFolder?.uri.scheme === 'file') {
			return activeFolder.uri.fsPath;
		}

		const folder = this.ws.getWorkspace().folders.find(candidate => candidate.uri.scheme === 'file');
		if (folder) {
			return folder.uri.fsPath;
		}

		const workspace = this.ws.getWorkspace();
		if (workspace.configuration?.scheme === 'file') {
			return dirname(workspace.configuration.fsPath);
		}

		const activePath = toPath(active);
		if (activePath) {
			return active?.scheme === 'file' ? dirname(activePath) : undefined;
		}

		return undefined;
	}

	private activeModel() {
		return (this.code.getFocusedCodeEditor() ?? this.code.getActiveCodeEditor())?.getModel();
	}

	private findOpenModel(resource: URI | undefined) {
		if (!resource) {
			return this.activeModel();
		}
		const resourceKey = resource.toString();
		for (const editor of this.code.listCodeEditors()) {
			const model = editor.getModel();
			if (model?.uri.toString() === resourceKey) {
				return model;
			}
		}
		return undefined;
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

	private toDiagnosticDto(marker: {
		severity: MarkerSeverity;
		message: string;
		resource: URI;
		source?: string;
		code?: string | { value: string };
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	}): OpenCodeDiagnosticDto {
		return {
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
		};
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

function addSeverityCount(
	target: {
		errors: number;
		warnings: number;
		infos: number;
		hints: number;
	},
	severity: MarkerSeverity,
): void {
	if (severity === MarkerSeverity.Error) {
		target.errors += 1;
		return;
	}
	if (severity === MarkerSeverity.Warning) {
		target.warnings += 1;
		return;
	}
	if (severity === MarkerSeverity.Info) {
		target.infos += 1;
		return;
	}
	target.hints += 1;
}

function compareDiagnostics(
	a: {
		severity: MarkerSeverity;
		resource: URI;
		startLineNumber: number;
		startColumn: number;
	},
	b: {
		severity: MarkerSeverity;
		resource: URI;
		startLineNumber: number;
		startColumn: number;
	},
): number {
	return compareOpenCodeDiagnostics(
		{
			severity: toSeverity(a.severity),
			uri: a.resource.toString(),
			path: toPath(a.resource) ?? a.resource.toString(),
			message: '',
			startLineNumber: a.startLineNumber,
			startColumn: a.startColumn,
			endLineNumber: a.startLineNumber,
			endColumn: a.startColumn,
		},
		{
			severity: toSeverity(b.severity),
			uri: b.resource.toString(),
			path: toPath(b.resource) ?? b.resource.toString(),
			message: '',
			startLineNumber: b.startLineNumber,
			startColumn: b.startColumn,
			endLineNumber: b.startLineNumber,
			endColumn: b.startColumn,
		},
	);
}

function compareDiagnosticFiles(
	a: OpenCodeDiagnosticFileSummaryDto,
	b: OpenCodeDiagnosticFileSummaryDto,
): number {
	if (a.errors !== b.errors) {
		return b.errors - a.errors;
	}
	if (a.warnings !== b.warnings) {
		return b.warnings - a.warnings;
	}
	if (a.infos !== b.infos) {
		return b.infos - a.infos;
	}
	if (a.hints !== b.hints) {
		return b.hints - a.hints;
	}
	return a.path.localeCompare(b.path);
}

function compareOpenCodeDiagnostics(a: OpenCodeDiagnosticDto, b: OpenCodeDiagnosticDto): number {
	const severityRank = severitySortWeight(a.severity) - severitySortWeight(b.severity);
	if (severityRank !== 0) {
		return severityRank;
	}
	const pathRank = a.path.localeCompare(b.path);
	if (pathRank !== 0) {
		return pathRank;
	}
	if (a.startLineNumber !== b.startLineNumber) {
		return a.startLineNumber - b.startLineNumber;
	}
	return a.startColumn - b.startColumn;
}

function severitySortWeight(severity: OpenCodeDiagnosticDto['severity']): number {
	switch (severity) {
		case 'error':
			return 0;
		case 'warning':
			return 1;
		case 'info':
			return 2;
		default:
			return 3;
	}
}

function trimTerminalText(text: string | undefined): { text: string; truncated: boolean } {
	if (!text) {
		return { text: '', truncated: false };
	}
	if (text.length <= OpenCodeTerminalOutputChars) {
		return { text, truncated: false };
	}
	return {
		text: `${text.slice(0, OpenCodeTerminalOutputChars)}\n[terminal-output truncated]`,
		truncated: true,
	};
}

function countTerminalLines(text: string | undefined): number {
	if (!text) {
		return 0;
	}
	return text.split(/\r?\n/).length;
}

function getTaskEventTerminalId(event: Exclude<ITaskEvent, { kind: TaskEventKind.Changed }>): number | undefined {
	switch (event.kind) {
		case TaskEventKind.Start:
		case TaskEventKind.ProcessStarted:
		case TaskEventKind.ProcessEnded:
		case TaskEventKind.Terminated:
		case TaskEventKind.Inactive:
		case TaskEventKind.AcquiredInput:
		case TaskEventKind.DependsOnStarted:
		case TaskEventKind.Active:
		case TaskEventKind.End:
		case TaskEventKind.ProblemMatcherStarted:
		case TaskEventKind.ProblemMatcherFoundErrors:
			return event.terminalId;
		case TaskEventKind.ProblemMatcherEnded:
			return undefined;
	}
}

function toDocumentSymbolDto(symbol: DocumentSymbol) {
	return {
		name: symbol.name,
		detail: symbol.detail || undefined,
		kind: symbol.kind,
		kindName: symbolKindNames[symbol.kind] ?? String(symbol.kind),
		containerName: symbol.containerName || undefined,
		range: toSelectionDto(symbol.range.startLineNumber, symbol.range.startColumn, symbol.range.endLineNumber, symbol.range.endColumn),
		selectionRange: toSelectionDto(symbol.selectionRange.startLineNumber, symbol.selectionRange.startColumn, symbol.selectionRange.endLineNumber, symbol.selectionRange.endColumn),
	};
}

function isAbsolutePath(path: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\') || path.startsWith('//');
}

function snapshotContext(context: OpenCodeContextDto): string {
	return JSON.stringify(context);
}

function base64UrlEncode(value: string): string {
	const bytes = new TextEncoder().encode(value);
	const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/g, '');
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: OpenCodeSelectionCommandId,
	weight: KeybindingWeight.WorkbenchContrib + 100,
	when: ContextKeyExpr.or(EditorContextKeys.editorTextFocus, InputFocusedContext.toNegated()),
	primary: KeyMod.CtrlCmd | KeyCode.KeyL,
	handler: accessor => {
		if (current) {
			void current.toggleSelection();
			return;
		}

		void accessor.get(IViewsService).openView(OpenCodeViewId, true);
	},
});

registerWorkbenchContribution2(OpenCodeWebviewContribution.ID, OpenCodeWebviewContribution, WorkbenchPhase.AfterRestored);
