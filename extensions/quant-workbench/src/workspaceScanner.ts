/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BacktestFileScanResult, scanBacktests } from './backtestFileScanner';
import { addMetricFact, formatNumberFact, formatPctFact, formatTradeFact, mergeCharts, pickDefined } from './backtestParser';
import { scanDataFiles } from './dataFileScanner';
import { QuantItem } from './models';
import { StrategyScanResult, scanStrategies } from './strategyFileScanner';
import { outputKeyFromString } from './strategyScriptScanner';

export async function scanQuantWorkspace(): Promise<{ name: string; items: QuantItem[] }> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return { name: 'Workspace', items: [] };
	}

	const strategyResults = await scanStrategies(workspaceFolder.uri);
	const dataFiles = await scanDataFiles(workspaceFolder.uri);
	const backtestResults = await scanBacktests(workspaceFolder.uri);

	const strategyOutputMap = buildStrategyOutputMap(strategyResults, backtestResults);
	const strategies = strategyResults.map(result => enrichStrategyStatus(result.item, strategyOutputMap.get(result.item.id)));

	const items: QuantItem[] = [
		{
			kind: 'summary',
			id: 'workspace-summary',
			label: workspaceFolder.name,
			description: vscode.l10n.t('Detected quant workspace'),
			summary: vscode.l10n.t('Detected strategy, data, and backtest assets from workspace files.'),
			detail: vscode.l10n.t('Using folder conventions and script analysis'),
			facts: [
				{ label: vscode.l10n.t('Strategies'), value: String(strategies.length) },
				{ label: vscode.l10n.t('Data files'), value: String(dataFiles.length) },
				{ label: vscode.l10n.t('Backtest outputs'), value: String(backtestResults.length) }
			],
			metadata: {
				folder: workspaceFolder.uri.fsPath
			}
		},
		...strategies,
		...dataFiles,
		...backtestResults.map(result => result.item)
	];

	return {
		name: workspaceFolder.name,
		items
	};
}

function enrichStrategyStatus(strategy: QuantItem, outputs: readonly BacktestFileScanResult[] | undefined): QuantItem {
	if (!outputs || outputs.length === 0) {
		return strategy;
	}

	const newest = outputs
		.map(output => output.item.updatedAt ?? 0)
		.reduce((max, value) => Math.max(max, value), 0);
	const outputNames = outputs.map(output => output.item.label);
	const outputLabel = outputNames.join(', ');
	const existingFacts = strategy.facts ? [...strategy.facts] : [];
	const filteredFacts = existingFacts.filter(fact => {
		const label = fact.label;
		return label !== vscode.l10n.t('Matched outputs')
			&& label !== vscode.l10n.t('Return')
			&& label !== vscode.l10n.t('Sharpe')
			&& label !== vscode.l10n.t('Max drawdown')
			&& label !== vscode.l10n.t('Win rate')
			&& label !== vscode.l10n.t('Trades');
	});
	filteredFacts.push({ label: vscode.l10n.t('Matched outputs'), value: outputLabel });

	const equityPreferred = outputs.find(output => output.parsed?.role === 'equity')
		?? outputs.find(output => output.parsed?.chart?.strategy && output.parsed.chart.strategy.length > 1);
	const drawdownPreferred = outputs.find(output => output.parsed?.role === 'drawdown')
		?? outputs.find(output => output.parsed?.chart?.drawdown && output.parsed.chart.drawdown.length > 1);
	const firstParsed = outputs.find(output => output.parsed)?.parsed;

	const returnPct = pickDefined(
		equityPreferred?.parsed?.returnPct,
		firstParsed?.returnPct,
		strategy.returnPct
	);
	const sharpeRatio = pickDefined(
		equityPreferred?.parsed?.sharpeRatio,
		firstParsed?.sharpeRatio,
		strategy.sharpeRatio
	);
	const maxDrawdownPct = pickDefined(
		drawdownPreferred?.parsed?.maxDrawdownPct,
		equityPreferred?.parsed?.maxDrawdownPct,
		firstParsed?.maxDrawdownPct,
		strategy.maxDrawdownPct
	);
	const winRatePct = pickDefined(
		equityPreferred?.parsed?.winRatePct,
		firstParsed?.winRatePct,
		strategy.winRatePct
	);
	const tradeCount = pickDefined(
		equityPreferred?.parsed?.tradeCount,
		firstParsed?.tradeCount,
		strategy.tradeCount
	);
	const dateStart = pickDefined(
		equityPreferred?.parsed?.dateStart,
		drawdownPreferred?.parsed?.dateStart,
		firstParsed?.dateStart,
		strategy.dateStart
	);
	const dateEnd = pickDefined(
		equityPreferred?.parsed?.dateEnd,
		drawdownPreferred?.parsed?.dateEnd,
		firstParsed?.dateEnd,
		strategy.dateEnd
	);
	const chart = mergeCharts(
		equityPreferred?.parsed?.chart,
		drawdownPreferred?.parsed?.chart,
		strategy.chart
	);

	addMetricFact(filteredFacts, vscode.l10n.t('Return'), formatPctFact(returnPct));
	addMetricFact(filteredFacts, vscode.l10n.t('Sharpe'), formatNumberFact(sharpeRatio));
	addMetricFact(filteredFacts, vscode.l10n.t('Max drawdown'), formatPctFact(maxDrawdownPct));
	addMetricFact(filteredFacts, vscode.l10n.t('Win rate'), formatPctFact(winRatePct));
	addMetricFact(filteredFacts, vscode.l10n.t('Trades'), formatTradeFact(tradeCount));

	return {
		...strategy,
		status: 'backtested',
		updatedAt: Math.max(strategy.updatedAt ?? 0, newest),
		facts: filteredFacts,
		returnPct,
		sharpeRatio,
		maxDrawdownPct,
		winRatePct,
		tradeCount,
		dateStart,
		dateEnd,
		chart,
		metadata: {
			...(strategy.metadata ?? {}),
			matchedOutputs: outputNames.join('|')
		}
	};
}

function buildStrategyOutputMap(
	strategies: readonly StrategyScanResult[],
	backtests: readonly BacktestFileScanResult[]
): Map<string, BacktestFileScanResult[]> {
	const byKey = new Map<string, BacktestFileScanResult>();
	for (const backtest of backtests) {
		byKey.set(backtest.key, backtest);
	}

	const strategyMap = new Map<string, BacktestFileScanResult[]>();
	for (const strategy of strategies) {
		const outputs: BacktestFileScanResult[] = [];
		for (const candidate of strategy.outputCandidates) {
			const key = outputKeyFromString(candidate);
			const matched = byKey.get(key);
			if (matched) {
				outputs.push(matched);
			}
		}

		if (outputs.length === 0) {
			const labelLower = strategy.item.label.toLowerCase();
			const guessed = backtests.filter(backtest => backtest.lowerName.includes(labelLower));
			if (guessed.length > 0) {
				outputs.push(...guessed);
			}
		}

		if (outputs.length > 0) {
			strategyMap.set(strategy.item.id, dedupeById(outputs));
		}
	}

	return strategyMap;
}

function dedupeById(items: readonly BacktestFileScanResult[]): BacktestFileScanResult[] {
	const map = new Map<string, BacktestFileScanResult>();
	for (const item of items) {
		map.set(item.item.id, item);
	}
	return Array.from(map.values());
}
