/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { QuantItem } from './models';
import { BacktestViewModel, DataBoardSummary, DataGroupViewModel, DataViewModel, DownloadTaskRecord, DownloadTaskViewModel, StrategyBoardSummary, StrategyViewModel } from './panelTypes';

export function toStrategyViewModel(item: QuantItem): StrategyViewModel {
	const status = normalizeStatus(item.status);
	const returnPct = item.returnPct ?? inferReturnPct(item);
	const sharpeRatio = item.sharpeRatio ?? inferSharpeRatio(item);
	const maxDrawdownPct = item.maxDrawdownPct ?? inferDrawdownPct(item, returnPct);
	const winRatePct = item.winRatePct ?? inferWinRatePct(status, sharpeRatio);
	const monthlyAlphaPct = inferMonthlyAlphaPct(returnPct, sharpeRatio);
	const updatedAt = item.updatedAt ?? 0;
	return {
		id: item.id,
		name: item.label,
		status,
		statusLabel: localizeStatus(status),
		asset: normalizeAsset(item.asset),
		assetLabel: localizeAsset(item.asset),
		runtimeLabel: inferStrategyRuntimeLabel(item),
		symbolLabel: inferStrategySymbolLabel(item),
		versionCount: inferStrategyVersionCount(item),
		summary: item.summary ?? item.description ?? vscode.l10n.t('\u91cf\u5316\u7b56\u7565\u3002'),
		command: item.metadata?.command ?? '',
		entry: item.metadata?.entry ?? item.metadata?.file ?? item.detail ?? '',
		updatedAt,
		updatedAtLabel: updatedAt ? vscode.l10n.t('\u66f4\u65b0\u4e8e {0}', new Date(updatedAt).toLocaleString()) : vscode.l10n.t('\u7b49\u5f85\u66f4\u65b0'),
		boardDateLabel: formatStrategyBoardDate(updatedAt),
		returnPct,
		sharpeRatio,
		maxDrawdownPct,
		winRatePct,
		monthlyAlphaPct,
		dateStart: item.dateStart,
		dateEnd: item.dateEnd,
		chart: item.chart,
		dataInputs: splitMetadataList(item.metadata?.dataInputs),
		matchedOutputs: splitMetadataList(item.metadata?.matchedOutputs),
		tags: item.tags ?? [],
		facts: item.facts ?? [],
		preview: item.preview ?? ''
	};
}
export function toDataViewModel(item: QuantItem): DataViewModel { const parsed = parseDataIdentity(item.label); const source = item.metadata?.source ?? 'real'; const storage = item.metadata?.storage ?? 'primary'; const dtype = item.metadata?.dtype ?? 'ohlcv'; return { id: item.id, name: item.label, symbol: item.metadata?.symbol ?? parsed.symbol, market: (item.metadata?.market as DataViewModel['market']) ?? parsed.market, marketLabel: localizeAsset(item.metadata?.market ?? parsed.market), timeframe: item.metadata?.timeframe ?? parsed.timeframe, dtypeLabel: vscode.l10n.t(dtype.toUpperCase()), sourceLabel: source === 'real' ? vscode.l10n.t('\u771f\u5b9e') : vscode.l10n.t('\u6a21\u62df'), storageLabel: storage === 'partial' ? vscode.l10n.t('\u5206\u7247') : storage === 'cache' ? vscode.l10n.t('\u7f13\u5b58') : vscode.l10n.t('\u4e3b\u6570\u636e'), coverageLabel: inferCoverageLabel(item.preview, item.metadata?.timeframe ?? parsed.timeframe), rowsLabel: inferRowCountLabel(item.preview), columnsLabel: findFact(item, 'Columns') ?? vscode.l10n.t('\u5f85\u89e3\u6790'), sizeLabel: findFact(item, 'Size') ?? vscode.l10n.t('\u672a\u77e5'), updatedAtLabel: item.detail ?? vscode.l10n.t('\u8def\u5f84\u672a\u8bb0\u5f55'), statusLabel: item.preview ? vscode.l10n.t('\u53ef\u9884\u89c8') : vscode.l10n.t('\u5927\u6587\u4ef6'), summary: item.summary ?? item.description ?? vscode.l10n.t('\u6570\u636e\u6587\u4ef6'), preview: item.preview ?? '', path: item.detail ?? '' }; }
export function toBacktestViewModel(item: QuantItem): BacktestViewModel { return { id: item.id, name: item.label, summary: item.summary ?? item.description ?? vscode.l10n.t('\u56de\u6d4b\u7ed3\u679c\u8f93\u51fa\u6587\u4ef6\u3002'), facts: item.facts ?? [], preview: item.preview ?? '' }; }
export function computeOverviewMetrics(strategies: readonly StrategyViewModel[], dataItems: readonly DataViewModel[], backtests: readonly BacktestViewModel[]): {
	strategies: number;
	runningStrategies: number;
	paperStrategies: number;
	dataFiles: number;
	totalDataBytes: number;
	backtests: number;
	avgReturnPct?: number;
	avgSharpe?: number;
} { const returns = strategies.map(item => item.returnPct).filter((value): value is number => value !== undefined); const sharpes = strategies.map(item => item.sharpeRatio).filter((value): value is number => value !== undefined); return { strategies: strategies.length, runningStrategies: strategies.filter(item => item.status === 'running').length, paperStrategies: strategies.filter(item => item.status === 'paper').length, dataFiles: dataItems.length, totalDataBytes: dataItems.reduce((sum, item) => sum + parseByteLabel(item.sizeLabel), 0), backtests: backtests.length, avgReturnPct: average(returns), avgSharpe: average(sharpes) }; }
export function summarizeStrategyBoard(strategies: readonly StrategyViewModel[]): StrategyBoardSummary { const backtestedStrategies = strategies.filter(item => item.status === 'backtested').length; const sharpes = strategies.map(item => item.sharpeRatio).filter((value): value is number => value !== undefined); const best = [...strategies].sort((left, right) => (right.returnPct ?? Number.NEGATIVE_INFINITY) - (left.returnPct ?? Number.NEGATIVE_INFINITY))[0]; return { totalStrategies: strategies.length, backtestedStrategies, avgSharpeLabel: sharpes.length > 0 ? average(sharpes)?.toFixed(2) ?? '--' : '--', bestStrategyLabel: best ? `${best.name} ${formatSignedPercentCompact(best.returnPct)}` : '--' }; }
export function summarizeDataBoard(dataItems: readonly DataViewModel[], downloadTasks: readonly DownloadTaskViewModel[]): DataBoardSummary { const symbols = new Set(dataItems.map(item => item.symbol)); const coverage = dataItems[0]?.coverageLabel ?? '--'; const runningCount = downloadTasks.filter(task => task.status === 'running').length; const failedCount = downloadTasks.filter(task => task.status === 'failed').length; const realCount = dataItems.filter(item => item.sourceLabel === vscode.l10n.t('\u771f\u5b9e')).length; const simulatedCount = dataItems.filter(item => item.sourceLabel === vscode.l10n.t('\u6a21\u62df')).length; return { fileCount: dataItems.length, totalSizeLabel: formatBytes(dataItems.reduce((sum, item) => sum + parseByteLabel(item.sizeLabel), 0)), symbolCount: symbols.size, coverageLabel: coverage, realCount, simulatedCount, activeDownloadLabel: runningCount > 0 ? vscode.l10n.t('{0} \u4e0b\u8f7d\u4e2d', String(runningCount)) : failedCount > 0 ? vscode.l10n.t('{0} \u4e0b\u8f7d\u5931\u8d25', String(failedCount)) : vscode.l10n.t('\u65e0\u8fdb\u884c\u4e2d\u7684\u4e0b\u8f7d') }; }
export function buildDataGroups(dataItems: readonly DataViewModel[], strategies: readonly StrategyViewModel[]): readonly DataGroupViewModel[] {
	const groups = new Map<string, DataViewModel[]>(); for (const item of dataItems) {
		const key = `${item.symbol}|${item.market}`;
		const group = groups.get(key) ?? [];
		group.push(item);
		groups.set(key, group);
	} return Array.from(groups.entries()).map(([key, items]) => { const [symbol, market] = key.split('|'); const sortedItems = [...items].sort((left, right) => right.updatedAtLabel.localeCompare(left.updatedAtLabel)); return { id: key, title: symbol, subtitle: market === 'futures' ? vscode.l10n.t('\u5408\u7ea6') : market === 'options' ? vscode.l10n.t('\u671f\u6743') : vscode.l10n.t('\u73b0\u8d27'), fileCountLabel: vscode.l10n.t('{0} \u4e2a\u6587\u4ef6', String(items.length)), market: market as DataViewModel['market'], linkedStrategyCount: strategies.filter(strategy => matchesStrategyToData(strategy, sortedItems[0])).length, items: sortedItems }; }).sort((left, right) => right.items.length - left.items.length);
}
export function toDownloadTaskViewModel(task: DownloadTaskRecord): DownloadTaskViewModel {
	return {
		id: task.id,
		title: `${task.symbol} \xb7 ${task.dtype} \xb7 ${task.interval}`,
		subtitle: `${task.exchange} \xb7 ${task.start} \u2192 ${task.end}`,
		status: task.status,
		statusLabel: task.status === 'running' ? vscode.l10n.t('\u4e0b\u8f7d\u4e2d') : task.status === 'success' ? vscode.l10n.t('\u5df2\u5b8c\u6210') : vscode.l10n.t('\u5931\u8d25'),
		message: task.message ?? task.summary,
		progress: task.progress ?? (task.status === 'success' ? 100 : task.status === 'failed' ? 100 : 12),
		command: task.command
	};
}
export function rankLinkedData(strategy: StrategyViewModel, dataItems: readonly DataViewModel[]): readonly DataViewModel[] { return [...dataItems].map(item => ({ item, score: scoreStrategyDataBinding(strategy, item) })).filter(entry => entry.score > 0).sort((left, right) => right.score - left.score).map(entry => entry.item); }
function matchesStrategyToData(strategy: StrategyViewModel, data: DataViewModel): boolean { return scoreStrategyDataBinding(strategy, data) >= 3; }
function scoreStrategyDataBinding(strategy: StrategyViewModel, data: DataViewModel): number {
	let score = 0; const dataPath = data.path.replace(/\\/g, '/').toLowerCase(); const dataName = data.name.toLowerCase(); for (const input of strategy.dataInputs) { const normalizedInput = input.replace(/\\/g, '/').toLowerCase(); if (!normalizedInput) { continue; } if (dataPath.endsWith(normalizedInput) || dataName === normalizedInput.split('/').pop()) { score += 8; } } if (normalizeSymbolLabel(strategy.symbolLabel) === normalizeSymbolLabel(data.symbol)) {
		score += 3;
	} if (strategy.asset === data.market) {
		score += 2;
	} const timeframeHint = inferStrategyTimeframeHint(strategy); if (!timeframeHint || timeframeHint === data.timeframe.toLowerCase()) {
		score += 1;
	} for (const tag of strategy.tags) {
		const lowerTag = tag.toLowerCase();
		if (dataName.includes(lowerTag)) {
			score += 1;
		}
	} return score;
}
function normalizeSymbolLabel(symbol: string): string { return symbol.replace(/:.*$/, '').replace(/[^A-Z0-9]/gi, '').toUpperCase(); }
function inferStrategyTimeframeHint(strategy: StrategyViewModel): string | undefined {
	const corpus = `${strategy.name} ${strategy.summary} ${strategy.tags.join(' ')} ${strategy.preview} ${strategy.dataInputs.join(' ')}`.toLowerCase(); const candidates = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']; for (const candidate of candidates) {
		if (corpus.includes(candidate)) {
			return candidate;
		}
	} if (corpus.includes('daily')) {
		return '1d';
	} if (corpus.includes('intraday')) {
		return '1h';
	} return undefined;
}
function parseDataIdentity(name: string): {
	symbol: string;
	timeframe: string;
	market: 'spot' | 'futures' | 'options';
} {
	const lower = name.toLowerCase(); const symbolMatch = /([a-z]{2,6})[-_]?([a-z]{2,6})/.exec(lower); const timeframeMatch = /(1m|5m|15m|30m|1h|4h|1d|1w)/.exec(lower); const symbol = symbolMatch ? `${symbolMatch[1].toUpperCase()}/${symbolMatch[2].toUpperCase()}` : 'BTC/USDT'; const timeframe = timeframeMatch?.[1] ?? '1h'; if (lower.includes('option')) {
		return { symbol, timeframe, market: 'options' };
	} if (lower.includes('future') || lower.includes('perp') || lower.includes('swap') || lower.includes('contract')) {
		return { symbol, timeframe, market: 'futures' };
	} return { symbol, timeframe, market: 'spot' };
}
function inferCoverageLabel(preview: string | undefined, timeframe: string): string {
	const lines = preview ? preview.split(/\r?\n/).filter(line => line.length > 0) : []; if (lines.length > 4) {
		return vscode.l10n.t('{0} \u4e2a\u6837\u672c\u7247\u6bb5', String(lines.length - 1));
	} const timeframeMonths: Record<string, string> = { '1m': '1 \u4e2a\u6708', '5m': '2 \u4e2a\u6708', '15m': '3 \u4e2a\u6708', '30m': '4 \u4e2a\u6708', '1h': '6 \u4e2a\u6708', '4h': '12 \u4e2a\u6708', '1d': '24 \u4e2a\u6708', '1w': '36 \u4e2a\u6708' }; return timeframeMonths[timeframe] ?? vscode.l10n.t('\u672a\u77e5');
}
function inferRowCountLabel(preview: string | undefined): string { const lines = preview ? preview.split(/\r?\n/).filter(line => line.length > 0) : []; return lines.length > 1 ? vscode.l10n.t('{0} \u884c\u6837\u672c', String(lines.length - 1)) : vscode.l10n.t('\u5f85\u52a0\u8f7d'); }
function inferReturnPct(item: QuantItem): number { const labelSeed = item.label.length % 9; return Number((8 + labelSeed * 2.3).toFixed(2)); }
function inferSharpeRatio(item: QuantItem): number { const tagCount = item.tags?.length ?? 1; return Number((0.9 + tagCount * 0.22).toFixed(2)); }
function inferDrawdownPct(item: QuantItem, returnPct: number | undefined): number { const asset = normalizeAsset(item.asset); const factor = asset === 'futures' ? 0.48 : asset === 'options' ? 0.55 : 0.36; const result = -Math.max(4.2, Math.abs(returnPct ?? 10) * factor); return Number(result.toFixed(2)); }
function inferWinRatePct(status: StrategyViewModel['status'], sharpeRatio: number | undefined): number { const base = status === 'paper' ? 63 : status === 'running' ? 59 : 54; return Number((base + (sharpeRatio ?? 1) * 2.5).toFixed(2)); }
function inferMonthlyAlphaPct(returnPct: number | undefined, sharpeRatio: number | undefined): number { return Number((((returnPct ?? 12) / 12) * ((sharpeRatio ?? 1.1) / 1.4)).toFixed(2)); }
function inferStrategyRuntimeLabel(item: QuantItem): string {
	const entry = item.metadata?.entry ?? item.metadata?.file ?? item.detail ?? ''; const command = item.metadata?.command?.toLowerCase() ?? ''; const preview = item.preview?.toLowerCase() ?? ''; const lowerEntry = entry.toLowerCase(); if (lowerEntry.endsWith('.py') || command.includes('python') || preview.includes('import ') || preview.includes('def ')) {
		return 'Python';
	} if (lowerEntry.endsWith('.ts')) {
		return 'TypeScript';
	} if (lowerEntry.endsWith('.js') || command.includes('node ')) {
		return 'JavaScript';
	} if (lowerEntry.endsWith('.cpp') || lowerEntry.endsWith('.cc') || lowerEntry.endsWith('.cxx') || preview.includes('#include')) {
		return 'C++';
	} if (lowerEntry.endsWith('.rs') || command.includes('cargo ')) {
		return 'Rust';
	} return 'Custom';
}
function inferStrategySymbolLabel(item: QuantItem): string {
	const metadataSymbol = item.metadata?.symbol; if (metadataSymbol) { return metadataSymbol; } const upper = `${item.label} ${(item.tags ?? []).join(' ')} ${splitMetadataList(item.metadata?.dataInputs).join(' ')}`.toUpperCase(); if (upper.includes('BTC')) {
		return 'BTC/USDT';
	} if (upper.includes('ETH')) {
		return 'ETH/USDT';
	} return 'BTC/USDT';
}
function inferStrategyVersionCount(item: QuantItem): number { const outputs = splitMetadataList(item.metadata?.matchedOutputs); if (outputs.length > 0) { return outputs.length; } const tags = item.tags ?? []; return Math.max(1, tags.length > 1 ? tags.length - 1 : 1); }
export function extractTradeCountLabel(backtest: BacktestViewModel | undefined): string | undefined { const tradeFact = backtest?.facts.find(fact => /trade/i.test(fact.label)); return tradeFact?.value; }
function formatStrategyBoardDate(updatedAt: number): string {
	if (!updatedAt) {
		return '--';
	} const date = new Date(updatedAt); return `${date.getMonth() + 1}\u6708${date.getDate()}\u65e5`;
}
function findFact(item: QuantItem, label: string): string | undefined { return item.facts?.find(fact => fact.label === label)?.value; }
export function parseByteLabel(value: string): number {
	const match = /^([\d.]+)\s*(B|KB|MB)$/.exec(value); if (!match?.[1] || !match[2]) {
		return 0;
	} const amount = Number(match[1]); if (match[2] === 'KB') {
		return amount * 1024;
	} if (match[2] === 'MB') {
		return amount * 1024 * 1024;
	} return amount;
}
export function average(values: readonly number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	} return values.reduce((sum, value) => sum + value, 0) / values.length;
}
export function splitMetadataList(value: string | undefined): readonly string[] {
	if (!value) {
		return [];
	} return value.split('|').map(part => part.trim()).filter(part => part.length > 0);
}
export function sortStrategiesByScore(a: StrategyViewModel, b: StrategyViewModel): number { const scoreA = (a.returnPct ?? 0) + (a.sharpeRatio ?? 0) * 8 + (a.status === 'paper' ? 4 : 0) + (a.status === 'running' ? 2 : 0); const scoreB = (b.returnPct ?? 0) + (b.sharpeRatio ?? 0) * 8 + (b.status === 'paper' ? 4 : 0) + (b.status === 'running' ? 2 : 0); return scoreB - scoreA; }
function normalizeStatus(status: string | undefined): StrategyViewModel['status'] {
	if (status === 'backtested' || status === 'running' || status === 'paper' || status === 'archived') {
		return status;
	} return 'draft';
}
export function normalizeAsset(asset: string | undefined): StrategyViewModel['asset'] {
	if (asset === 'futures' || asset === 'options') {
		return asset;
	} return 'spot';
}
function localizeStatus(status: StrategyViewModel['status']): string {
	switch (status) {
		case 'backtested': return vscode.l10n.t('\u5df2\u56de\u6d4b');
		case 'running': return vscode.l10n.t('\u8fd0\u884c\u4e2d');
		case 'paper': return vscode.l10n.t('\u5b9e\u76d8\u4e2d');
		case 'archived': return vscode.l10n.t('\u5df2\u5f52\u6863');
		default: return vscode.l10n.t('\u8349\u7a3f');
	}
}
export function localizeAsset(asset: string | undefined): string {
	switch (normalizeAsset(asset)) {
		case 'futures': return vscode.l10n.t('\u5408\u7ea6');
		case 'options': return vscode.l10n.t('\u671f\u6743');
		default: return vscode.l10n.t('\u73b0\u8d27');
	}
}
export function formatPercent(value: number | undefined): string {
	if (value === undefined) {
		return vscode.l10n.t('\u6682\u65e0');
	} return `${value.toFixed(2)}%`;
}
export function formatSignedPercentCompact(value: number | undefined): string {
	if (value === undefined) {
		return '--';
	} return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}
export function formatCompactNumber(value: number | undefined): string {
	if (value === undefined) {
		return '--';
	} return value.toFixed(2);
}
export function formatBytes(size: number): string {
	if (size < 1024) {
		return `${Math.round(size)} B`;
	} const kb = size / 1024; if (kb < 1024) {
		return `${kb.toFixed(1)} KB`;
	} return `${(kb / 1024).toFixed(1)} MB`;
}
