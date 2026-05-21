/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BacktestViewModel, DataViewModel, DownloadFormOptions, DownloadTaskRecord, DownloadTaskViewModel, QuantPageRoute, QuantSnapshot, RunRecord, StrategyViewModel } from './panelTypes';
import { escapeHtml, serializeForScript, titleForRoute } from './panelUtils';
import { emptyInline, filterChip, renderCompactDownloadModal, renderCompactDownloadTaskSection, renderDataGroupCard, renderStrategyBacktestDetail, strategyBoardRow } from './panelRenderers';
import { buildDataGroups, computeOverviewMetrics, formatBytes, formatCompactNumber, formatPercent, formatSignedPercentCompact, rankLinkedData, sortStrategiesByScore, summarizeDataBoard, summarizeStrategyBoard, toBacktestViewModel, toDataViewModel, toDownloadTaskViewModel, toStrategyViewModel } from './panelViewModels';
import { renderWebviewScript } from './webviewScript';
import { downloadStyles } from './downloadStyles';
import { webviewStyles } from './webviewStyles';
export function renderQuantWorkbenchPage(route: QuantPageRoute, snapshot: QuantSnapshot, runHistory: readonly RunRecord[], downloadTasks: readonly DownloadTaskRecord[], downloadOptions: DownloadFormOptions): string {
	const strategies = snapshot.items.filter(item => item.kind === 'strategy').map(toStrategyViewModel);
	const dataItems = snapshot.items.filter(item => item.kind === 'data').map(toDataViewModel);
	const backtests = snapshot.items.filter(item => item.kind === 'backtest').map(toBacktestViewModel);
	const taskViewModels = downloadTasks.map(toDownloadTaskViewModel);
	let body: string;
	switch (route.page) {
		case 'overview':
			body = renderOverview(snapshot, runHistory, strategies, dataItems, backtests);
			break;
		case 'strategies':
			body = renderStrategies(strategies);
			break;
		case 'data':
			body = renderData(dataItems, strategies, taskViewModels, downloadOptions);
			break;
		case 'strategyDetail':
			body = renderStrategyDetail(route, runHistory, strategies, backtests, dataItems);
			break;
	}
	return wrapPage(titleForRoute(route, snapshot), body, strategies, dataItems, downloadOptions);
}
function renderOverview(snapshot: QuantSnapshot, runHistory: readonly RunRecord[], strategies: readonly StrategyViewModel[], dataItems: readonly DataViewModel[], backtests: readonly BacktestViewModel[]): string {
	const metrics = computeOverviewMetrics(strategies, dataItems, backtests);
	const topStrategies = [...strategies].sort(sortStrategiesByScore).slice(0, 5);
	const realCount = dataItems.filter(d => d.sourceLabel === vscode.l10n.t('\u771f\u5b9e')).length;
	const simCount = dataItems.filter(d => d.sourceLabel === vscode.l10n.t('\u6a21\u62df')).length;
	return `
			<div class="ov">
				<div class="ov__header">
					<div class="ov__title-row">
						<h1 class="ov__name">${escapeHtml(snapshot.name)}</h1>
						<div class="ov__actions">
							<button class="button button--primary" data-action="openStrategies">${escapeHtml(vscode.l10n.t('\u7b56\u7565\u770b\u677f'))}</button>
							<button class="button" data-action="openData">${escapeHtml(vscode.l10n.t('\u6570\u636e\u7ba1\u7406'))}</button>
						</div>
					</div>
					<div class="ov__kpi-bar">
						<div class="ov__kpi">
							<span class="ov__kpi-value">${escapeHtml(String(metrics.strategies))}</span>
							<span class="ov__kpi-label">${escapeHtml(vscode.l10n.t('\u7b56\u7565'))}</span>
						</div>
						<div class="ov__kpi">
							<span class="ov__kpi-value">${escapeHtml(String(metrics.dataFiles))}</span>
							<span class="ov__kpi-label">${escapeHtml(vscode.l10n.t('\u6570\u636e\u96c6'))}</span>
						</div>
						<div class="ov__kpi">
							<span class="ov__kpi-value">${escapeHtml(formatBytes(metrics.totalDataBytes))}</span>
							<span class="ov__kpi-label">${escapeHtml(vscode.l10n.t('\u603b\u5927\u5c0f'))}</span>
						</div>
						<div class="ov__kpi ${metrics.avgReturnPct !== undefined && metrics.avgReturnPct >= 0 ? 'positive' : metrics.avgReturnPct !== undefined && metrics.avgReturnPct < 0 ? 'negative' : ''}">
							<span class="ov__kpi-value">${escapeHtml(formatPercent(metrics.avgReturnPct))}</span>
							<span class="ov__kpi-label">${escapeHtml(vscode.l10n.t('\u5e73\u5747\u6536\u76ca'))}</span>
						</div>
						<div class="ov__kpi">
							<span class="ov__kpi-value">${metrics.avgSharpe !== undefined ? escapeHtml(metrics.avgSharpe.toFixed(2)) : '--'}</span>
							<span class="ov__kpi-label">${escapeHtml(vscode.l10n.t('\u5e73\u5747\u590f\u666e'))}</span>
						</div>
					</div>
				</div>
				<div class="ov__body">
					<div class="ov__main">
						<div class="ov__card">
							<div class="ov__card-head">
								<span class="ov__card-title">${escapeHtml(vscode.l10n.t('\u7b56\u7565\u6982\u89c8'))}</span>
								<button class="text-button" data-action="openStrategies">${escapeHtml(vscode.l10n.t('\u67e5\u770b\u5168\u90e8 \u2192'))}</button>
							</div>
							${topStrategies.length > 0 ? '<div class="ov__strategy-list">' + topStrategies.map(s => renderOverviewStrategyRow(s)).join('') + '</div>' : '<div class="ov__empty">' + escapeHtml(vscode.l10n.t('\u672a\u53d1\u73b0\u7b56\u7565\u3002\u5c06 *_backtest.py \u653e\u5230\u5de5\u4f5c\u533a\u6839\u76ee\u5f55\u5373\u53ef\u81ea\u52a8\u8bc6\u522b\u3002')) + '</div>'}
						</div>
						<div class="ov__card">
							<div class="ov__card-head">
								<span class="ov__card-title">${escapeHtml(vscode.l10n.t('\u6570\u636e\u8d44\u4ea7'))}</span>
								<button class="text-button" data-action="openData">${escapeHtml(vscode.l10n.t('\u7ba1\u7406 \u2192'))}</button>
							</div>
							${dataItems.length > 0 ? '<div class="ov__data-summary"><div class="ov__data-row"><span class="ov__data-icon" style="background:#16a34a"></span><span>' + escapeHtml(vscode.l10n.t('\u771f\u5b9e\u6570\u636e')) + '</span><strong>' + escapeHtml(String(realCount)) + '</strong></div><div class="ov__data-row"><span class="ov__data-icon" style="background:#d97706"></span><span>' + escapeHtml(vscode.l10n.t('\u6a21\u62df\u6570\u636e')) + '</span><strong>' + escapeHtml(String(simCount)) + '</strong></div><div class="ov__data-row"><span class="ov__data-icon" style="background:#6b7280"></span><span>' + escapeHtml(vscode.l10n.t('\u603b\u8ba1\u5927\u5c0f')) + '</span><strong>' + escapeHtml(formatBytes(metrics.totalDataBytes)) + '</strong></div></div>' : '<div class="ov__empty">' + escapeHtml(vscode.l10n.t('\u6682\u65e0\u6570\u636e\u6587\u4ef6\u3002')) + '</div>'}
						</div>
					</div>
					<div class="ov__side">
						<div class="ov__card">
							<div class="ov__card-head">
								<span class="ov__card-title">${escapeHtml(vscode.l10n.t('\u6700\u8fd1\u6d3b\u52a8'))}</span>
							</div>
							${runHistory.length > 0 ? '<div class="ov__activity">' + runHistory.slice(0, 5).map(run => '<div class="ov__activity-item"><div class="ov__activity-dot ov__activity-dot--' + escapeHtml(run.status) + '"></div><div class="ov__activity-info"><strong>' + escapeHtml(run.label) + '</strong><span>' + escapeHtml(run.startedAt) + '</span><p>' + escapeHtml(run.summary) + '</p></div></div>').join('') + '</div>' : '<div class="ov__empty">' + escapeHtml(vscode.l10n.t('\u8fd0\u884c\u56de\u6d4b\u540e\u4f1a\u5728\u8fd9\u91cc\u663e\u793a\u8bb0\u5f55\u3002')) + '</div>'}
						</div>
						<div class="ov__card ov__quick-nav">
							<div class="ov__card-head">
								<span class="ov__card-title">${escapeHtml(vscode.l10n.t('\u5feb\u6377\u64cd\u4f5c'))}</span>
							</div>
							<div class="ov__nav-grid">
								<button class="ov__nav-btn" data-action="openStrategies"><span class="ov__nav-icon">\ud83d\udcca</span><span>${escapeHtml(vscode.l10n.t('\u7b56\u7565\u770b\u677f'))}</span></button>
								<button class="ov__nav-btn" data-action="openData"><span class="ov__nav-icon">\ud83d\udce6</span><span>${escapeHtml(vscode.l10n.t('\u6570\u636e\u7ba1\u7406'))}</span></button>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;
}
function renderOverviewStrategyRow(strategy: StrategyViewModel): string {
	const statusColor = strategy.status === 'running' ? '#7c3aed' : strategy.status === 'paper' ? '#047857' : strategy.status === 'backtested' ? '#e879f9' : strategy.status === 'archived' ? '#c2410c' : '#9ca3af';
	return `<div class="ov__strategy-row" data-action="openStrategy" data-strategy-id="${escapeHtml(strategy.id)}">
			<div class="ov__strategy-dot" style="background:${statusColor}"></div>
			<div class="ov__strategy-info">
				<strong>${escapeHtml(strategy.name)}</strong>
				<span>${escapeHtml(strategy.symbolLabel)} \xb7 ${escapeHtml(strategy.runtimeLabel)}</span>
			</div>
			<div class="ov__strategy-metrics">
				<span class="${strategy.returnPct !== undefined && strategy.returnPct >= 0 ? 'positive' : strategy.returnPct !== undefined && strategy.returnPct < 0 ? 'negative' : ''}">${escapeHtml(formatSignedPercentCompact(strategy.returnPct))}</span>
				<span>${escapeHtml(formatCompactNumber(strategy.sharpeRatio))}</span>
			</div>
		</div>`;
}
function renderStrategies(strategies: readonly StrategyViewModel[]): string {
	const summary = summarizeStrategyBoard(strategies);
	return ` 
			<section class="page-header page-header--compact"> 
				<div> 
					<h1>${escapeHtml(vscode.l10n.t('\u7b56\u7565\u770b\u677f'))}</h1> 
				</div> 
				<div class="page-header__actions"> 
					<button class="button" type="button">${escapeHtml(vscode.l10n.t('\u7b56\u7565\u5bf9\u6bd4'))}</button> 
				</div> 
			</section> 
			<section class="strategy-toolbar"> 
				<div class="strategy-toolbar__metrics"> 
					<span class="strategy-toolbar__metric"><strong>${escapeHtml(String(summary.totalStrategies))}</strong> ${escapeHtml(vscode.l10n.t('\u7b56\u7565'))}</span> 
					<span class="strategy-toolbar__sep"></span> 
					<span class="strategy-toolbar__metric"><strong>${escapeHtml(String(summary.backtestedStrategies))}</strong> ${escapeHtml(vscode.l10n.t('\u5df2\u56de\u6d4b'))}</span> 
					<span class="strategy-toolbar__sep"></span> 
					<span class="strategy-toolbar__metric"><strong>${escapeHtml(summary.avgSharpeLabel)}</strong> ${escapeHtml(vscode.l10n.t('\u590f\u666e'))}</span> 
					<span class="strategy-toolbar__sep"></span> 
					<span class="strategy-toolbar__metric strategy-toolbar__metric--accent"><strong>${escapeHtml(summary.bestStrategyLabel)}</strong></span> 
				</div> 
				<div class="strategy-toolbar__filters"> 
					<div class="strategy-toolbar__filter-group"> 
						${filterChip('strategy-status', 'all', vscode.l10n.t('\u5168\u90e8'), true)} 
						${filterChip('strategy-status', 'draft', vscode.l10n.t('\u8349\u7a3f'))} 
						${filterChip('strategy-status', 'backtested', vscode.l10n.t('\u5df2\u56de\u6d4b'))} 
						${filterChip('strategy-status', 'running', vscode.l10n.t('\u8fd0\u884c\u4e2d'))} 
						${filterChip('strategy-status', 'paper', vscode.l10n.t('\u5b9e\u76d8\u4e2d'))} 
						${filterChip('strategy-status', 'archived', vscode.l10n.t('\u5df2\u5f52\u6863'))} 
					</div> 
					<span class="strategy-toolbar__divider"></span> 
					<div class="strategy-toolbar__filter-group"> 
						${filterChip('strategy-asset', 'all', vscode.l10n.t('\u5168\u90e8'), true)} 
						${filterChip('strategy-asset', 'spot', vscode.l10n.t('\u73b0\u8d27'))} 
						${filterChip('strategy-asset', 'futures', vscode.l10n.t('\u5408\u7ea6'))} 
						${filterChip('strategy-asset', 'options', vscode.l10n.t('\u671f\u6743'))} 
					</div> 
					<span class="strategy-toolbar__divider"></span> 
					<div class="strategy-toolbar__filter-group"> 
						${filterChip('strategy-sort', 'updated', vscode.l10n.t('\u6700\u8fd1\u66f4\u65b0'), true)} 
						${filterChip('strategy-sort', 'return', vscode.l10n.t('\u6536\u76ca\u7387'))} 
						${filterChip('strategy-sort', 'sharpe', vscode.l10n.t('\u590f\u666e\u6bd4\u7387'))} 
					</div> 
				</div> 
			</section> 
			<section class="strategy-list" id="strategy-board"> 
				${strategies.length > 0 ? strategies.map(strategyBoardRow).join('') : emptyInline(vscode.l10n.t('\u672a\u53d1\u73b0\u7b56\u7565\u3002\u5c06 *_backtest.py \u6587\u4ef6\u653e\u5230\u5de5\u4f5c\u533a\u6839\u76ee\u5f55\uff0c\u6269\u5c55\u4f1a\u81ea\u52a8\u8bc6\u522b\u3002'))} 
			</section> 
		`;
}
function renderData(dataItems: readonly DataViewModel[], strategies: readonly StrategyViewModel[], downloadTasks: readonly DownloadTaskViewModel[], downloadOptions: DownloadFormOptions): string {
	const summary = summarizeDataBoard(dataItems, downloadTasks);
	const groups = buildDataGroups(dataItems, strategies);
	return `
		<section class="page-header page-header--compact">
			<div>
				<h1>${escapeHtml(vscode.l10n.t('\u6570\u636e\u7ba1\u7406'))}</h1>
			</div>
			<div class="page-header__actions">
				<button class="button button--primary" data-open-modal="download-modal">${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u6570\u636e'))}</button>
			</div>
		</section>
		<section class="data-toolbar">
			<div class="data-toolbar__metrics">
				<span class="data-toolbar__metric"><strong>${escapeHtml(String(summary.fileCount))}</strong> ${escapeHtml(vscode.l10n.t('\u6587\u4ef6'))}</span>
				<span class="strategy-toolbar__sep"></span>
				<span class="data-toolbar__metric"><strong>${escapeHtml(summary.totalSizeLabel)}</strong> ${escapeHtml(vscode.l10n.t('\u603b\u5927\u5c0f'))}</span>
				<span class="strategy-toolbar__sep"></span>
				<span class="data-toolbar__metric"><strong>${escapeHtml(String(summary.symbolCount))}</strong> ${escapeHtml(vscode.l10n.t('\u6807\u7684'))}</span>
				<span class="strategy-toolbar__sep"></span>
				<span class="data-toolbar__metric data-toolbar__metric--real"><strong>${escapeHtml(String(summary.realCount))}</strong> ${escapeHtml(vscode.l10n.t('\u771f\u5b9e'))}</span>
				<span class="data-toolbar__metric data-toolbar__metric--sim"><strong>${escapeHtml(String(summary.simulatedCount))}</strong> ${escapeHtml(vscode.l10n.t('\u6a21\u62df'))}</span>
				${summary.activeDownloadLabel !== vscode.l10n.t('\u65e0\u8fdb\u884c\u4e2d\u7684\u4e0b\u8f7d') ? '<span class="strategy-toolbar__sep"></span><span class="data-toolbar__metric data-toolbar__metric--active"><strong>' + escapeHtml(summary.activeDownloadLabel) + '</strong></span>' : ''}
			</div>
			<div class="strategy-toolbar__filters">
				<div class="strategy-toolbar__filter-group">
					${filterChip('data-market', 'all', vscode.l10n.t('\u5168\u90e8'), true)}
					${filterChip('data-market', 'spot', vscode.l10n.t('\u73b0\u8d27'))}
					${filterChip('data-market', 'futures', vscode.l10n.t('\u5408\u7ea6'))}
					${filterChip('data-market', 'options', vscode.l10n.t('\u671f\u6743'))}
				</div>
				<span class="strategy-toolbar__divider"></span>
				<div class="strategy-toolbar__filter-group">
					${filterChip('data-timeframe', 'all', vscode.l10n.t('\u5168\u90e8'), true)}
					${filterChip('data-timeframe', '1d', '1d')}
					${filterChip('data-timeframe', '4h', '4h')}
					${filterChip('data-timeframe', '1h', '1h')}
					${filterChip('data-timeframe', '30m', '30m')}
					${filterChip('data-timeframe', '15m', '15m')}
					${filterChip('data-timeframe', '5m', '5m')}
					${filterChip('data-timeframe', '1m', '1m')}
				</div>
			</div>
		</section>
		<section class="data-list" id="data-group-list">
			${downloadTasks.length > 0 ? renderCompactDownloadTaskSection(downloadTasks) : ''}
			${groups.length > 0 ? groups.map(renderDataGroupCard).join('') : emptyInline(vscode.l10n.t('\u6682\u65e0\u6570\u636e\u6587\u4ef6\u3002'))}
		</section>
		${renderCompactDownloadModal(downloadOptions)}
	`;
}
function renderStrategyDetail(route: QuantPageRoute, runHistory: readonly RunRecord[], strategies: readonly StrategyViewModel[], backtests: readonly BacktestViewModel[], dataItems: readonly DataViewModel[]): string {
	const strategy = strategies.find(item => item.id === route.strategyId) ?? strategies[0];
	if (!strategy) {
		return ` 				<section class="page-header"> 					<div> 						<div class="eyebrow">Strategy Detail</div> 						<h1>${escapeHtml(vscode.l10n.t('\u7b56\u7565\u8be6\u60c5'))}</h1> 						<p>${escapeHtml(vscode.l10n.t('\u8bf7\u5148\u5728\u7b56\u7565\u770b\u677f\u4e2d\u9009\u62e9\u4e00\u4e2a\u7b56\u7565\u3002'))}</p> 					</div> 					<div class="page-header__actions"> 						<button class="button button--primary" data-action="openStrategies">${escapeHtml(vscode.l10n.t('\u524d\u5f80\u7b56\u7565\u770b\u677f'))}</button> 					</div> 				</section> 			`;
	}
	const linkedData = rankLinkedData(strategy, dataItems).slice(0, 3);
	const strategyRuns = runHistory.filter(run => run.label === strategy.name);
	return renderStrategyBacktestDetail(strategy, backtests, linkedData, strategyRuns);
}
function wrapPage(title: string, body: string, strategies: readonly StrategyViewModel[], dataItems: readonly DataViewModel[], downloadOptions: DownloadFormOptions): string {
	const nonce = String(Date.now());
	const strategyPayload = serializeForScript(strategies);
	const dataPayload = serializeForScript(dataItems);
	const downloadOptionsPayload = serializeForScript(downloadOptions);
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(title)}</title>
	<style>${webviewStyles}${downloadStyles}</style>
</head>
<body>
	${body}
	<script nonce="${nonce}">${renderWebviewScript(strategyPayload, dataPayload, downloadOptionsPayload)}</script>
</body>
</html>`;
}
