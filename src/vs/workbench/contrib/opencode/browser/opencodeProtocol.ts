/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type OpenCodeThemeMode = 'light' | 'dark';
export type OpenCodeDiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface OpenCodeSelectionDto {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface OpenCodePositionDto {
	readonly lineNumber: number;
	readonly column: number;
}

export interface OpenCodeResourceDto {
	readonly path?: string;
	readonly uri?: string;
}

export interface OpenCodeWorkspaceFolderDto {
	readonly name: string;
	readonly path: string;
	readonly uri: string;
}

export interface OpenCodeWorkspaceDto {
	readonly folders: readonly OpenCodeWorkspaceFolderDto[];
}

export interface OpenCodeEditorDto {
	readonly path: string;
	readonly uri: string;
	readonly languageId: string;
	readonly cursor: OpenCodePositionDto | null;
	readonly selection: OpenCodeSelectionDto | null;
	readonly dirty: boolean;
}

export interface OpenCodeDiagnosticDto extends OpenCodeSelectionDto {
	readonly severity: OpenCodeDiagnosticSeverity;
	readonly message: string;
	readonly path: string;
	readonly uri: string;
	readonly source?: string;
	readonly code?: string;
}

export interface OpenCodeDiagnosticCountsDto {
	readonly errors: number;
	readonly warnings: number;
	readonly infos: number;
	readonly hints: number;
}

export interface OpenCodeDiagnosticFileSummaryDto {
	readonly path: string;
	readonly uri: string;
	readonly errors: number;
	readonly warnings: number;
	readonly infos: number;
	readonly hints: number;
}

export interface OpenCodeWorkspaceDiagnosticsDto {
	readonly total: OpenCodeDiagnosticCountsDto;
	readonly files: readonly OpenCodeDiagnosticFileSummaryDto[];
	readonly diagnostics: readonly OpenCodeDiagnosticDto[];
}

export type OpenCodeTaskStatus = 'running' | 'completed' | 'terminated';

export interface OpenCodeTaskSnapshotDto {
	readonly id: string;
	readonly label: string;
	readonly detail?: string;
	readonly type?: string;
	readonly sourceKind?: string;
	readonly workspaceFolder?: string;
	readonly runType: 'singleRun' | 'background';
	readonly status: OpenCodeTaskStatus;
	readonly terminalId?: number;
	readonly exitCode?: number;
	readonly durationMs?: number;
	readonly hasProblemMatcherErrors: boolean;
	readonly problemCount: number;
	readonly problems: readonly OpenCodeDiagnosticDto[];
}

export type OpenCodeTerminalSnapshotSource = 'command' | 'buffer';

export interface OpenCodeTerminalSnapshotDto {
	readonly title: string;
	readonly cwd?: string;
	readonly shellType?: string;
	readonly command?: string;
	readonly output?: string;
	readonly exitCode?: number;
	readonly source: OpenCodeTerminalSnapshotSource;
	readonly hasCommandDetection: boolean;
	readonly lineCount: number;
	readonly truncated: boolean;
}

export interface OpenCodeDocumentSymbolDto {
	readonly name: string;
	readonly detail?: string;
	readonly kind: number;
	readonly kindName: string;
	readonly containerName?: string;
	readonly range: OpenCodeSelectionDto;
	readonly selectionRange: OpenCodeSelectionDto;
}

export interface OpenCodeThemeDto {
	readonly mode: OpenCodeThemeMode;
}

export type OpenCodeAIExtensionType = 'skill' | 'plugin' | 'mcp';
export type OpenCodeAIExtensionSource = 'codex' | 'claude' | 'opencode';
export type OpenCodeAIExtensionInstallState = 'notInstalled' | 'installed' | 'viewOnly' | 'unsupported';
export type OpenCodeAIExtensionInstallScope = 'profile' | 'external';
export type OpenCodeAIExtensionUpdateState = 'unknown' | 'latest' | 'available';
export type OpenCodeAIExtensionSyncStatus = 'notSynced' | 'pending' | 'success' | 'failed';

export interface OpenCodeAIExtensionDto {
	readonly id: string;
	readonly name: string;
	readonly version?: string;
	readonly source: OpenCodeAIExtensionSource;
	readonly sourceLabel: string;
	readonly type: OpenCodeAIExtensionType;
	readonly description: string;
	readonly risk: string;
	readonly installable: boolean;
	readonly installState: OpenCodeAIExtensionInstallState;
	readonly installedByIde: boolean;
	readonly enabled: boolean;
	readonly trusted?: boolean;
	readonly canEnable?: boolean;
	readonly installScope: OpenCodeAIExtensionInstallScope;
	readonly updateState: OpenCodeAIExtensionUpdateState;
	readonly syncStatus: OpenCodeAIExtensionSyncStatus;
	readonly syncError?: string;
	readonly lastSyncedAt?: number;
	readonly needsRuntimeRefresh: boolean;
	readonly detail?: string;
}

export interface OpenCodeAIExtensionsListResult {
	readonly items: readonly OpenCodeAIExtensionDto[];
}

export interface OpenCodeAIExtensionsSyncResult {
	readonly syncedAt: number;
	readonly requiresRuntimeRefresh: boolean;
}

/**
 * Workspace + editor snapshot used by context.change.
 * Theme is notified independently via theme.change.
 */
export interface OpenCodeContextDto {
	readonly workspace: OpenCodeWorkspaceDto;
	readonly editor: OpenCodeEditorDto | null;
}

/**
 * Full init snapshot returned by context.get.
 * Includes theme so the frontend can bootstrap without a separate round-trip.
 */
export interface OpenCodeInitDto extends OpenCodeContextDto {
	readonly theme: OpenCodeThemeDto;
}

export type OpenCodeContextGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'context.get';
};

export type OpenCodeCurrentSessionGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'session.current.get';
};

export type OpenCodeCurrentSessionSetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'session.current.set';
	readonly params: {
		readonly sessionId: string | null;
	};
};

export type OpenCodeCurrentSessionGetResult = {
	readonly sessionId: string | null;
};

export type OpenCodeResourceRevealRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'resource.reveal';
	readonly params: OpenCodeResourceDto & {
		readonly app?: string;
	};
};

export type OpenCodeEditorOpenRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'editor.open';
	readonly params: OpenCodeResourceDto & {
		readonly selection?: OpenCodeSelectionDto;
		readonly preserveFocus?: boolean;
		readonly pinned?: boolean;
		readonly revealIfOpened?: boolean;
	};
};

export type OpenCodeDiagnosticsGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'diagnostics.get';
	readonly params?: OpenCodeResourceDto;
};

export type OpenCodeDiagnosticsGetResult = {
	readonly diagnostics: readonly OpenCodeDiagnosticDto[];
};

export type OpenCodeWorkspaceDiagnosticsGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'diagnostics.workspace.get';
};

export type OpenCodeWorkspaceDiagnosticsGetResult = {
	readonly summary: OpenCodeWorkspaceDiagnosticsDto;
};

export type OpenCodeDocumentSymbolsGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'document.symbols';
	readonly params?: OpenCodeResourceDto;
};

export type OpenCodeDocumentSymbolsGetResult = {
	readonly symbols: readonly OpenCodeDocumentSymbolDto[];
};

export type OpenCodeEditorReadRangeRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'editor.readRange';
	readonly params?: OpenCodeResourceDto & {
		readonly range?: OpenCodeSelectionDto;
	};
};

export type OpenCodeEditorReadRangeResult = {
	readonly path: string;
	readonly uri: string;
	readonly languageId: string;
	readonly range: OpenCodeSelectionDto;
	readonly text: string;
	readonly dirty: boolean;
};

export type OpenCodeLastTaskGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'task.last.get';
};

export type OpenCodeLastTaskGetResult = {
	readonly task: OpenCodeTaskSnapshotDto | null;
};

export type OpenCodeLastTerminalGetRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'terminal.last.get';
};

export type OpenCodeLastTerminalGetResult = {
	readonly terminal: OpenCodeTerminalSnapshotDto | null;
};

export type OpenCodeClipboardWriteTextRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'clipboard.writeText';
	readonly params: {
		readonly text: string;
	};
};

export type OpenCodeAIExtensionsListRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'aiExtensions.installed.list';
};

export type OpenCodeAIExtensionActionRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'aiExtensions.uninstall' | 'aiExtensions.enable' | 'aiExtensions.disable' | 'aiExtensions.trust' | 'aiExtensions.update';
	readonly params: {
		readonly id: string;
	};
};

export type OpenCodeAIExtensionsSyncRequest = {
	readonly source: 'opencode-bridge';
	readonly id: string;
	readonly method: 'aiExtensions.sync';
};

export type OpenCodeBridgeRequest =
	| OpenCodeContextGetRequest
	| OpenCodeCurrentSessionGetRequest
	| OpenCodeCurrentSessionSetRequest
	| OpenCodeResourceRevealRequest
	| OpenCodeEditorOpenRequest
	| OpenCodeDocumentSymbolsGetRequest
	| OpenCodeEditorReadRangeRequest
	| OpenCodeDiagnosticsGetRequest
	| OpenCodeWorkspaceDiagnosticsGetRequest
	| OpenCodeLastTaskGetRequest
	| OpenCodeLastTerminalGetRequest
	| OpenCodeClipboardWriteTextRequest
	| OpenCodeAIExtensionsListRequest
	| OpenCodeAIExtensionActionRequest
	| OpenCodeAIExtensionsSyncRequest;

export type OpenCodeHostResponse = {
	readonly source: 'opencode-host';
	readonly id: string;
	readonly ok: boolean;
	readonly result?: unknown;
	readonly error?: string;
};

export type OpenCodeContextChangedEvent = {
	readonly source: 'opencode-host-event';
	readonly type: 'context.change';
	readonly context: OpenCodeContextDto;
};

export type OpenCodeSelectionAddedEvent = {
	readonly source: 'opencode-host-event';
	readonly type: 'selection.add';
	readonly selection: OpenCodeSelectionDto & {
		readonly path: string;
		readonly text: string;
	};
};

export type OpenCodeThemeChangedEvent = {
	readonly source: 'opencode-host-event';
	readonly type: 'theme.change';
	readonly theme: OpenCodeThemeDto;
};

export type OpenCodeHostEvent =
	| OpenCodeContextChangedEvent
	| OpenCodeSelectionAddedEvent
	| OpenCodeThemeChangedEvent;

export function isOpenCodeBridgeRequest(value: unknown): value is OpenCodeBridgeRequest {
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
	if (data.method === 'session.current.get') {
		return true;
	}
	if (data.method === 'session.current.set') {
		return isCurrentSessionSetParams(data.params);
	}
	if (data.method === 'resource.reveal') {
		return hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	if (data.method === 'editor.open') {
		return hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	if (data.method === 'editor.readRange') {
		return data.params === undefined || isEditorReadRangeParams(data.params);
	}
	if (data.method === 'document.symbols') {
		return data.params === undefined || hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	if (data.method === 'diagnostics.get') {
		return data.params === undefined || hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	if (data.method === 'diagnostics.workspace.get') {
		return data.params === undefined;
	}
	if (data.method === 'task.last.get') {
		return data.params === undefined;
	}
	if (data.method === 'terminal.last.get') {
		return data.params === undefined;
	}
	if (data.method === 'clipboard.writeText') {
		return isClipboardWriteTextParams(data.params);
	}
	if (data.method === 'aiExtensions.installed.list' || data.method === 'aiExtensions.sync') {
		return data.params === undefined;
	}
	if (data.method === 'aiExtensions.uninstall' || data.method === 'aiExtensions.enable' || data.method === 'aiExtensions.disable' || data.method === 'aiExtensions.trust' || data.method === 'aiExtensions.update') {
		return isAIExtensionActionParams(data.params);
	}
	return false;
}

function hasResource(value: OpenCodeResourceDto | undefined): boolean {
	return typeof value?.path === 'string' || typeof value?.uri === 'string';
}

function isCurrentSessionSetParams(value: unknown): value is OpenCodeCurrentSessionSetRequest['params'] {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const params = value as { sessionId?: unknown };
	return params.sessionId === null || typeof params.sessionId === 'string';
}

function isClipboardWriteTextParams(value: unknown): value is OpenCodeClipboardWriteTextRequest['params'] {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const params = value as { text?: unknown };
	return typeof params.text === 'string';
}

function isAIExtensionActionParams(value: unknown): value is OpenCodeAIExtensionActionRequest['params'] {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const params = value as { id?: unknown };
	return typeof params.id === 'string' && params.id.length > 0;
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isOptionalBool(value: unknown): boolean {
	return value === undefined || typeof value === 'boolean';
}

function isValidSelection(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	if (!value || typeof value !== 'object') {
		return false;
	}
	const s = value as Record<string, unknown>;
	return isPositiveInt(s.startLineNumber) && isPositiveInt(s.startColumn)
		&& isPositiveInt(s.endLineNumber) && isPositiveInt(s.endColumn);
}

function isEditorReadRangeParams(value: unknown): boolean {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const params = value as Record<string, unknown>;
	const hasAnyResource = params.path !== undefined || params.uri !== undefined;
	const validResource = !hasAnyResource || hasResource(params as OpenCodeResourceDto);
	return validResource && isValidSelection(params.range);
}

export function validateEditorOpenParams(params: unknown): asserts params is OpenCodeEditorOpenRequest['params'] {
	if (!params || typeof params !== 'object') {
		throw new Error('editor.open: params is not an object');
	}
	const p = params as Record<string, unknown>;
	if (!hasResource(p as OpenCodeResourceDto)) {
		throw new Error('editor.open: missing path or uri');
	}
	if (!isValidSelection(p.selection)) {
		throw new Error('editor.open: selection fields must be positive integers');
	}
	if (!isOptionalBool(p.preserveFocus) || !isOptionalBool(p.pinned) || !isOptionalBool(p.revealIfOpened)) {
		throw new Error('editor.open: preserveFocus/pinned/revealIfOpened must be boolean');
	}
}

export function validateResourceRevealParams(params: unknown): asserts params is OpenCodeResourceRevealRequest['params'] {
	if (!params || typeof params !== 'object') {
		throw new Error('resource.reveal: params is not an object');
	}
	if (!hasResource(params as OpenCodeResourceDto)) {
		throw new Error('resource.reveal: missing path or uri');
	}
}
