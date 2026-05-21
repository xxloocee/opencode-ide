/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QuantItem } from './models';
import { basename, buildCodePreview, formatBytes, readText } from './scannerUtils';
import { analyzePythonScript, extractDataInputs, extractOutputCandidates, inferAsset, inferTags } from './strategyScriptScanner';

const backtestPattern = '**/*_backtest.py';
const ignorePattern = '**/node_modules/**';

export interface StrategyScanResult {
	readonly item: QuantItem;
	readonly outputCandidates: readonly string[];
	readonly dataInputs: readonly string[];
}

export async function scanStrategies(folder: vscode.Uri): Promise<StrategyScanResult[]> {
	const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, backtestPattern), ignorePattern);
	const results: StrategyScanResult[] = [];
	for (const uri of files) {
		const name = basename(uri);
		const label = name.replace(/_backtest\.py$/, '');
		const text = await readText(uri);
		const stats = await vscode.workspace.fs.stat(uri);
		const analysis = analyzePythonScript(text);
		const outputCandidates = extractOutputCandidates(text);
		const dataInputs = extractDataInputs(text);
		const command = `python ${name}`;
		const tags = inferTags(label, text);
		const dataInputLabel = dataInputs.length > 0 ? dataInputs.slice(0, 2).join(', ') : vscode.l10n.t('None detected');
		const outputsLabel = outputCandidates.length > 0 ? outputCandidates.slice(0, 3).join(', ') : vscode.l10n.t('None detected');

		results.push({
			item: {
				kind: 'strategy',
				id: uri.toString(),
				label,
				description: vscode.l10n.t('Discovered strategy script'),
				summary: vscode.l10n.t('Python strategy entrypoint discovered from the workspace and ready to run in the current project context.'),
				detail: uri.fsPath,
				uri,
				facts: [
					{ label: vscode.l10n.t('Command'), value: command },
					{ label: vscode.l10n.t('Source'), value: vscode.l10n.t('Auto-discovered') },
					{ label: vscode.l10n.t('Lines'), value: String(analysis.lineCount) },
					{ label: vscode.l10n.t('Imports'), value: analysis.imports.length > 0 ? analysis.imports.join(', ') : vscode.l10n.t('None detected') },
					{ label: vscode.l10n.t('Data inputs'), value: dataInputLabel },
					{ label: vscode.l10n.t('Output files'), value: outputsLabel },
					{ label: vscode.l10n.t('Size'), value: formatBytes(stats.size) }
				],
				metadata: {
					command,
					file: uri.fsPath,
					entry: uri.fsPath,
					dataInputs: dataInputs.join('|'),
					outputCandidates: outputCandidates.join('|')
				},
				preview: text ? buildCodePreview(text) : undefined,
				status: 'draft',
				asset: inferAsset(text),
				updatedAt: stats.mtime,
				tags
			},
			outputCandidates,
			dataInputs
		});
	}
	return results;
}
