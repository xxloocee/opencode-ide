/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

declare const TextDecoder: {
	new(label?: string): { decode(data: Uint8Array): string };
};

export async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const stats = await vscode.workspace.fs.stat(uri);
		if (stats.size > 512 * 1024) {
			return undefined;
		}
		const data = await vscode.workspace.fs.readFile(uri);
		return new TextDecoder('utf-8').decode(data);
	} catch {
		return undefined;
	}
}

export function buildCodePreview(text: string): string {
	return splitLines(text).slice(0, 12).join('\n');
}

export function buildCsvPreview(text: string): string {
	return splitLines(text).slice(0, 8).join('\n');
}

export function buildJsonPreview(text: string): string {
	try {
		const parsed = JSON.parse(text);
		return JSON.stringify(parsed, null, 2).split('\n').slice(0, 18).join('\n');
	} catch {
		return splitLines(text).slice(0, 8).join('\n');
	}
}

export function splitLines(value: string): string[] {
	return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(line => line.length > 0);
}

export function formatBytes(size: number): string {
	if (size < 1024) {
		return `${size} B`;
	}

	const kb = size / 1024;
	if (kb < 1024) {
		return `${kb.toFixed(1)} KB`;
	}

	return `${(kb / 1024).toFixed(1)} MB`;
}

export function basename(uri: vscode.Uri): string {
	const segments = uri.path.split('/');
	return segments[segments.length - 1] || uri.path;
}
