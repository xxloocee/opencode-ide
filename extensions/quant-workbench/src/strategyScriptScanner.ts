/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { basename, splitLines } from './scannerUtils';

export function analyzePythonScript(text: string | undefined): { lineCount: number; imports: string[] } {
	if (!text) {
		return { lineCount: 0, imports: [] };
	}

	const lines = splitLines(text);
	const imports: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('import ')) {
			imports.push(trimmed.replace(/^import\s+/, '').split(/\s+as\s+/)[0]);
		} else if (trimmed.startsWith('from ')) {
			const match = /^from\s+([^\s]+)\s+import\s+/.exec(trimmed);
			if (match?.[1]) {
				imports.push(match[1]);
			}
		}
	}

	return {
		lineCount: lines.length,
		imports: imports.slice(0, 4)
	};
}

export function extractOutputCandidates(text: string | undefined): string[] {
	if (!text) {
		return [];
	}
	const found = new Set<string>();
	const openWriteRegex = /open\(\s*['"]([^'"]+\.json)['"]\s*,\s*['"](?:w|w\+|a|a\+)['"]/g;
	const withOpenWriteRegex = /with\s+open\(\s*['"]([^'"]+\.json)['"]\s*,\s*['"](?:w|w\+|a|a\+)['"]\s*\)/g;
	const dumpTargetRegex = /json\.dump\([^)]*\)/g;

	let match: RegExpExecArray | null;
	while ((match = openWriteRegex.exec(text))) {
		if (match[1]) {
			found.add(normalizeScriptPath(match[1]));
		}
	}
	while ((match = withOpenWriteRegex.exec(text))) {
		if (match[1]) {
			found.add(normalizeScriptPath(match[1]));
		}
	}
	if (found.size === 0 && dumpTargetRegex.test(text)) {
		found.add('equity_data.json');
	}

	return Array.from(found);
}

export function extractDataInputs(text: string | undefined): string[] {
	if (!text) {
		return [];
	}
	const found = new Set<string>();
	const readCsvRegex = /read_csv\(\s*['"]([^'"]+)['"]/g;
	const readParquetRegex = /read_parquet\(\s*['"]([^'"]+)['"]/g;
	const openReadRegex = /open\(\s*['"]([^'"]+\.(?:csv|parquet|json))['"]\s*,\s*['"]r['"]/g;

	let match: RegExpExecArray | null;
	while ((match = readCsvRegex.exec(text))) {
		if (match[1]) {
			found.add(normalizeScriptPath(match[1]));
		}
	}
	while ((match = readParquetRegex.exec(text))) {
		if (match[1]) {
			found.add(normalizeScriptPath(match[1]));
		}
	}
	while ((match = openReadRegex.exec(text))) {
		if (match[1]) {
			found.add(normalizeScriptPath(match[1]));
		}
	}

	return Array.from(found);
}

export function inferAsset(text: string | undefined): string {
	if (!text) {
		return 'spot';
	}

	const lower = text.toLowerCase();
	if (lower.includes('option')) {
		return 'options';
	}
	if (lower.includes('future') || lower.includes('perp') || lower.includes('contract')) {
		return 'futures';
	}
	return 'spot';
}

export function inferTags(label: string, text: string | undefined): string[] {
	const tags = new Set<string>();
	tags.add(label.toLowerCase());

	if (text) {
		const lower = text.toLowerCase();
		for (const token of ['momentum', 'mean-reversion', 'breakout', 'btc', 'eth', 'daily', 'intraday']) {
			if (lower.includes(token)) {
				tags.add(token);
			}
		}
	}

	return Array.from(tags).slice(0, 6);
}

export function outputKeyFromPath(uri: vscode.Uri): string {
	return outputKeyFromString(basename(uri));
}

export function outputKeyFromString(value: string): string {
	return normalizeScriptPath(value).split('/').pop()?.toLowerCase() ?? value.toLowerCase();
}

function normalizeScriptPath(value: string): string {
	return value.replace(/\\/g, '/').trim();
}
