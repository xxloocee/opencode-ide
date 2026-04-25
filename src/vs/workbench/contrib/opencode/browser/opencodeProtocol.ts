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
	readonly selection: OpenCodeSelectionDto | null;
}

export interface OpenCodeDiagnosticDto extends OpenCodeSelectionDto {
	readonly severity: OpenCodeDiagnosticSeverity;
	readonly message: string;
	readonly path: string;
	readonly uri: string;
	readonly source?: string;
	readonly code?: string;
}

export interface OpenCodeThemeDto {
	readonly mode: OpenCodeThemeMode;
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

export type OpenCodeBridgeRequest =
	| OpenCodeContextGetRequest
	| OpenCodeResourceRevealRequest
	| OpenCodeEditorOpenRequest
	| OpenCodeDiagnosticsGetRequest;

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
	if (data.method === 'resource.reveal') {
		return hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	if (data.method === 'editor.open') {
		return hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	if (data.method === 'diagnostics.get') {
		return data.params === undefined || hasResource((data.params as OpenCodeResourceDto | undefined));
	}
	return false;
}

function hasResource(value: OpenCodeResourceDto | undefined): boolean {
	return typeof value?.path === 'string' || typeof value?.uri === 'string';
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
