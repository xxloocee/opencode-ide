/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { extractJsonFacts, parseBacktestResult, ParsedBacktestResult } from './backtestParser';
import { QuantItem } from './models';
import { basename, buildJsonPreview, formatBytes, readText } from './scannerUtils';
import { outputKeyFromPath } from './strategyScriptScanner';

const jsonPattern = '**/*.json';
const ignorePattern = '**/node_modules/**';

export interface BacktestFileScanResult {
	readonly item: QuantItem;
	readonly key: string;
	readonly lowerName: string;
	readonly parsed?: ParsedBacktestResult;
}

export async function scanBacktests(folder: vscode.Uri): Promise<BacktestFileScanResult[]> {
	const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, jsonPattern), ignorePattern);
	const results: BacktestFileScanResult[] = [];
	for (const uri of files) {
		const lowerPath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/').toLowerCase();
		if (lowerPath.startsWith('.opencode/') || lowerPath.startsWith('openspec/') || lowerPath.includes('/.opencode/')) {
			continue;
		}

		const text = await readText(uri);
		if (!isBacktestResultFile(uri, text)) {
			continue;
		}

		const stats = await vscode.workspace.fs.stat(uri);
		const preview = text ? buildJsonPreview(text) : undefined;
		const key = outputKeyFromPath(uri);
		const parsed = parseBacktestResult(text, basename(uri));
		results.push({
			key,
			lowerName: basename(uri).toLowerCase(),
			parsed,
			item: {
				kind: 'backtest',
				id: uri.toString(),
				label: basename(uri),
				description: vscode.l10n.t('Result output'),
				summary: vscode.l10n.t('Backtest result file ready for inspection.'),
				detail: uri.fsPath,
				uri,
				facts: [
					{ label: vscode.l10n.t('Size'), value: formatBytes(stats.size) },
					{ label: vscode.l10n.t('Path'), value: uri.fsPath },
					...extractJsonFacts(text, parsed)
				],
				preview,
				updatedAt: stats.mtime,
				returnPct: parsed?.returnPct,
				sharpeRatio: parsed?.sharpeRatio,
				maxDrawdownPct: parsed?.maxDrawdownPct,
				winRatePct: parsed?.winRatePct,
				tradeCount: parsed?.tradeCount,
				dateStart: parsed?.dateStart,
				dateEnd: parsed?.dateEnd,
				chart: parsed?.chart,
				metadata: {
					resultKey: key,
					resultRole: parsed?.role ?? 'generic'
				}
			}
		});
	}
	return results;
}

function isBacktestResultFile(uri: vscode.Uri, text: string | undefined): boolean {
	const name = basename(uri).toLowerCase();
	const nameMatched = /equity|drawdown|result|backtest/.test(name);
	const content = (text ?? '').toLowerCase();
	if (content.length === 0) {
		return nameMatched;
	}

	const contentMatched = content.includes('equity') || content.includes('equity_curve')
		|| content.includes('portfolio_value') || content.includes('drawdown')
		|| content.includes('max_drawdown') || content.includes('strategy_equity')
		|| content.includes('benchmark_equity');
	return contentMatched || nameMatched;
}
