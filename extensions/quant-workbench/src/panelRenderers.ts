/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { BacktestViewModel, DataGroupViewModel, DataViewModel, DownloadFormOptions, DownloadSelectOption, DownloadTaskViewModel, RunRecord, StrategyDetailModel, StrategyViewModel } from './panelTypes';
import { escapeHtml } from './panelUtils';
import { extractTradeCountLabel, formatCompactNumber, formatPercent, formatSignedPercentCompact } from './panelViewModels';

export function renderCompactDownloadTaskSection(tasks: readonly DownloadTaskViewModel[]): string {
	return `<section class="download-task-card">
		<div class="download-task-card__title">${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u4efb\u52a1'))}</div>
		<div class="download-task-card__list">
			${tasks.map(renderCompactDownloadTaskRow).join('')}
		</div>
	</section>`;
}

function renderCompactDownloadTaskRow(task: DownloadTaskViewModel): string {
	const progress = Math.max(0, Math.min(100, Math.round(task.progress)));
	return `<div class="download-task-row download-task-row--${escapeHtml(task.status)}">
		<div class="download-task-row__main">
			<div class="download-task-row__top">
				<strong>${escapeHtml(task.title)}</strong>
				<span class="download-task-row__status download-task-row__status--${escapeHtml(task.status)}">${escapeHtml(task.statusLabel)}</span>
			</div>
			<span>${escapeHtml(task.subtitle)}</span>
			<div class="download-task-row__progress" aria-label="${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u8fdb\u5ea6'))}">
				<span style="width:${progress}%"></span>
			</div>
			<div class="download-task-row__message">${escapeHtml(task.message)}</div>
			${task.command ? '<code class="download-task-row__command">' + escapeHtml(task.command) + '</code>' : ''}
		</div>
		<div class="download-task-row__percent">${escapeHtml(String(progress))}%</div>
	</div>`;
}

function selectOptions(options: readonly DownloadSelectOption[], selected: string): string {
	return options.map(option => `<option value="${escapeHtml(option.value)}"${option.value === selected ? ' selected' : ''}${option.disabled ? ' disabled' : ''}>${escapeHtml(option.label)}</option>`).join('');
}

export function renderCompactDownloadModal(options: DownloadFormOptions): string {
	const defaults = options.defaults;
	const disabled = options.toolAvailable ? '' : ' disabled';
	return `<div class="modal" id="download-modal" data-tool-available="${options.toolAvailable ? 'true' : 'false'}">
		<div class="modal__dialog modal__dialog--compact">
			<div class="modal__header modal__header--sheet modal__header--compact">
				<div>
					<h2>${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u5e02\u573a\u6570\u636e'))}</h2>
					<span class="modal__subtitle">${escapeHtml(options.toolStatusLabel)}</span>
				</div>
				<button class="text-button modal__close" data-close-modal="download-modal" aria-label="${escapeHtml(vscode.l10n.t('\u5173\u95ed'))}">\xd7</button>
			</div>
			<div class="modal__body modal__body--sheet modal__body--compact">
				<div class="download-form-grid">
					<label class="field field--select">
						<span>${escapeHtml(vscode.l10n.t('\u6765\u6e90'))}</span>
						<select id="download-channel"${disabled}>${selectOptions(options.channels, defaults.channel)}</select>
					</label>
					<label class="field field--select">
						<span>${escapeHtml(vscode.l10n.t('\u4ea4\u6613\u6240'))}</span>
						<select id="download-exchange"${disabled}>${selectOptions(options.exchanges, defaults.exchange)}</select>
					</label>
					<label class="field field--select">
						<span>${escapeHtml(vscode.l10n.t('\u6807\u7684'))}</span>
						<select id="download-symbol"${disabled}>${selectOptions(options.symbols, defaults.symbol)}</select>
					</label>
					<div class="field">
						<span>${escapeHtml(vscode.l10n.t('\u5e02\u573a'))}</span>
						<div class="radio-row radio-row--compact">
							${options.markets.map(option => `<label><input type="radio" name="market-kind" value="${escapeHtml(option.value)}"${option.value === defaults.market ? ' checked' : ''}${disabled} /><span>${escapeHtml(option.label)}</span></label>`).join('')}
						</div>
					</div>
					<label class="field field--select">
						<span>${escapeHtml(vscode.l10n.t('\u7c7b\u578b'))}</span>
						<select id="download-dtype"${disabled}>${selectOptions(options.dtypes, defaults.dtype)}</select>
					</label>
					<label class="field field--select">
						<span>${escapeHtml(vscode.l10n.t('\u5468\u671f'))}</span>
						<select id="download-interval"${disabled}>${selectOptions(options.intervals, defaults.interval)}</select>
					</label>
					<label class="field">
						<span>${escapeHtml(vscode.l10n.t('\u5f00\u59cb'))}</span>
						<input id="download-start" type="date" value="${escapeHtml(defaults.start)}"${disabled} />
					</label>
					<label class="field">
						<span>${escapeHtml(vscode.l10n.t('\u7ed3\u675f'))}</span>
						<input id="download-end" type="date" value="${escapeHtml(defaults.end)}"${disabled} />
					</label>
				</div>
				<div class="modal__hint modal__hint--compact">
					<span>${escapeHtml(vscode.l10n.t('\u547d\u4ee4\u9884\u89c8'))}</span>
					<code>${escapeHtml(`python ${options.commandPreview}`)}</code>
				</div>
			</div>
			<div class="modal__footer modal__footer--compact">
				<button class="button" data-close-modal="download-modal">${escapeHtml(vscode.l10n.t('\u53d6\u6d88'))}</button>
				<button class="button button--primary button--disabled" type="button" id="download-submit" data-submit-download="true"${disabled}>${escapeHtml(vscode.l10n.t('\u5f00\u59cb\u4e0b\u8f7d'))}</button>
			</div>
		</div>
	</div>`;
}

export function renderStrategyBacktestDetail(strategy: StrategyViewModel, backtests: readonly BacktestViewModel[], linkedData: readonly DataViewModel[], strategyRuns: readonly RunRecord[]): string {
	const detail = buildStrategyDetailModel(strategy, backtests, linkedData);
	const entryShort = strategy.entry ? strategy.entry.split(/[/\\]/).pop() || strategy.entry : '';
	const performanceSeries = strategy.chart?.strategy && strategy.chart.strategy.length > 1 ? strategy.chart.strategy : buildPerformanceSeries(strategy.returnPct, strategy.sharpeRatio);
	const drawdownSeries = strategy.chart?.drawdown && strategy.chart.drawdown.length > 1 ? strategy.chart.drawdown : buildDrawdownSeries(strategy.maxDrawdownPct);
	return `
		<div class="bd">
			<div class="bd__header">
				<div class="bd__nav">
					<button class="text-button" data-action="openStrategies">\u2190 ${escapeHtml(vscode.l10n.t('\u7b56\u7565\u770b\u677f'))}</button>
				</div>
				<div class="bd__title-row">
					<div class="bd__title-main">
						<h1 class="bd__name">${escapeHtml(strategy.name)}</h1>
						<div class="bd__badges">${statusBadge(strategy.statusLabel, strategy.status)} ${pill(detail.symbolLabel)} <span class="bd__runtime">${escapeHtml(strategy.runtimeLabel)}</span></div>
					</div>
					<button class="button button--primary bd__run" data-action="runStrategy" data-strategy-id="${escapeHtml(strategy.id)}">\u25b6 ${escapeHtml(vscode.l10n.t('\u8fd0\u884c\u56de\u6d4b'))}</button>
			</div>
			<div class="bd__kpi-bar">
				<div class="bd__kpi ${strategy.returnPct !== undefined && strategy.returnPct >= 0 ? 'positive' : strategy.returnPct !== undefined && strategy.returnPct < 0 ? 'negative' : ''}">
					<span class="bd__kpi-value">${escapeHtml(formatSignedPercentCompact(strategy.returnPct))}</span>
					<span class="bd__kpi-label">${escapeHtml(vscode.l10n.t('\u603b\u6536\u76ca\u7387'))}</span>
				</div>
				<div class="bd__kpi">
					<span class="bd__kpi-value">${escapeHtml(formatCompactNumber(strategy.sharpeRatio))}</span>
					<span class="bd__kpi-label">${escapeHtml(vscode.l10n.t('\u590f\u666e\u6bd4\u7387'))}</span>
				</div>
				<div class="bd__kpi ${strategy.maxDrawdownPct !== undefined && strategy.maxDrawdownPct < 0 ? 'negative' : ''}">
					<span class="bd__kpi-value">${escapeHtml(formatSignedPercentCompact(strategy.maxDrawdownPct))}</span>
					<span class="bd__kpi-label">${escapeHtml(vscode.l10n.t('\u6700\u5927\u56de\u64a4'))}</span>
				</div>
				<div class="bd__kpi">
					<span class="bd__kpi-value">${escapeHtml(detail.tradeCountLabel)}</span>
					<span class="bd__kpi-label">${escapeHtml(vscode.l10n.t('\u603b\u4ea4\u6613\u6570'))}</span>
				</div>
				<div class="bd__kpi">
					<span class="bd__kpi-value">${escapeHtml(formatPercent(strategy.winRatePct))}</span>
					<span class="bd__kpi-label">${escapeHtml(vscode.l10n.t('\u80dc\u7387'))}</span>
				</div>
			</div>
		</div>
		<div class="bd__body">
			<div class="bd__charts">
				<div class="bd__chart-card">
					<div class="bd__chart-header">${escapeHtml(vscode.l10n.t('\u6743\u76ca\u66f2\u7ebf'))}</div>
					<div class="bd__chart-body">${lineChartSvg(performanceSeries, '#7c8cf8', '#e8ebff')}</div>
				</div>
				<div class="bd__chart-card">
					<div class="bd__chart-header">${escapeHtml(vscode.l10n.t('\u56de\u64a4\u66f2\u7ebf'))}</div>
					<div class="bd__chart-body">${areaChartSvg(drawdownSeries, '#ff6b6b', '#ffe5e5')}</div>
				</div>
			</div>
			<div class="bd__sidebar">
				<div class="bd__card">
					<div class="bd__card-title">${escapeHtml(vscode.l10n.t('\u57fa\u672c\u4fe1\u606f'))}</div>
					<dl class="bd__dl">
						<dt>${escapeHtml(vscode.l10n.t('\u65e5\u671f\u8303\u56f4'))}</dt><dd>${escapeHtml(detail.dateRangeLabel)}</dd>
						<dt>${escapeHtml(vscode.l10n.t('\u5165\u53e3\u6587\u4ef6'))}</dt><dd class="bd__mono">${escapeHtml(entryShort || vscode.l10n.t('\u672a\u914d\u7f6e'))}</dd>
						<dt>${escapeHtml(vscode.l10n.t('\u8fd0\u884c\u547d\u4ee4'))}</dt><dd class="bd__mono">${escapeHtml(strategy.command || vscode.l10n.t('\u672a\u914d\u7f6e'))}</dd>
						<dt>${escapeHtml(vscode.l10n.t('\u7ed3\u679c\u6587\u4ef6'))}</dt><dd class="bd__mono">${escapeHtml(detail.fileLabel)}</dd>
						<dt>${escapeHtml(vscode.l10n.t('\u7248\u672c'))}</dt><dd>${escapeHtml(vscode.l10n.t('v{0}', String(detail.versionCount)))}</dd>
					</dl>
				</div>
				<div class="bd__card">
					<div class="bd__card-title">${escapeHtml(vscode.l10n.t('\u5173\u8054\u6570\u636e'))}</div>
					${linkedData.length > 0 ? '<div class="bd__chips">' + linkedData.map(linkedDataChip).join('') + '</div>' : '<span class="bd__empty">' + escapeHtml(vscode.l10n.t('\u672a\u5339\u914d\u5230\u5173\u8054\u6570\u636e')) + '</span>'}
				</div>
				<div class="bd__card">
					<div class="bd__card-title">${escapeHtml(vscode.l10n.t('\u56de\u6d4b\u5386\u53f2'))}</div>
					${strategyRuns.length > 0 ? '<div class="bd__history">' + strategyRuns.slice(0, 5).map(run => '<div class="bd__history-item"><div class="bd__history-top"><span class="bd__history-status bd__history-status--' + escapeHtml(run.status) + '"></span><strong>' + escapeHtml(run.startedAt) + '</strong></div><p>' + escapeHtml(run.summary) + '</p></div>').join('') + '</div>' : '<span class="bd__empty">' + escapeHtml(vscode.l10n.t('\u6682\u65e0\u8fd0\u884c\u8bb0\u5f55')) + '</span>'}
				</div>
			</div>
		</div>
	`;
}
function buildStrategyDetailModel(strategy: StrategyViewModel, backtests: readonly BacktestViewModel[], linkedData: readonly DataViewModel[]): StrategyDetailModel { const primaryBacktest = backtests.find(backtest => strategy.matchedOutputs.includes(backtest.name)) ?? backtests[0]; const primaryData = linkedData[0]; return { symbolLabel: primaryData?.symbol ?? strategy.symbolLabel, versionCount: strategy.versionCount, tradeCountLabel: strategy.facts.find(fact => /Trades|tradeCount/i.test(fact.label))?.value ?? extractTradeCountLabel(primaryBacktest) ?? '0', dateRangeLabel: strategy.dateStart && strategy.dateEnd ? `${strategy.dateStart} \u2192 ${strategy.dateEnd}` : primaryData ? `${primaryData.coverageLabel} / ${primaryData.timeframe}` : strategy.updatedAtLabel, fileLabel: primaryBacktest?.name ?? strategy.matchedOutputs[0] ?? (strategy.entry || vscode.l10n.t('\u672a\u914d\u7f6e')) }; }
export function strategyBoardRow(strategy: StrategyViewModel): string {
	const statusColor = strategy.status === 'running' ? '#7c3aed' : strategy.status === 'paper' ? '#047857' : strategy.status === 'backtested' ? '#e879f9' : strategy.status === 'archived' ? '#c2410c' : '#9ca3af';
	const id = escapeHtml(strategy.id);
	const tagsHtml = strategy.tags.length > 0 ? strategy.tags.map(t => '<span class="strategy-detail__tag">' + escapeHtml(t) + '</span>').join('') : '<span class="strategy-detail__empty">' + escapeHtml(vscode.l10n.t('\u6682\u65e0\u6807\u7b7e')) + '</span>';
	return `<div class="strategy-row-wrap"> 
		<div class="strategy-row" data-role="strategy-card" data-action="openStrategy" data-strategy-id="${id}" data-name="${escapeHtml(strategy.name)}" data-tags="${escapeHtml(strategy.tags.join(' '))}" data-status="${escapeHtml(strategy.status)}" data-asset="${escapeHtml(strategy.asset)}" data-updated-at="${escapeHtml(String(strategy.updatedAt))}" data-return-pct="${escapeHtml(strategy.returnPct === undefined ? '-Infinity' : String(strategy.returnPct))}" data-sharpe-ratio="${escapeHtml(strategy.sharpeRatio === undefined ? '-Infinity' : String(strategy.sharpeRatio))}"> 
			<div class="strategy-row__status" style="background:${statusColor}"></div> 
			<div class="strategy-row__icon" data-toggle-strategy="${id}" title="${escapeHtml(vscode.l10n.t('\u5c55\u5f00\u8be6\u60c5'))}">\u25b8</div> 
			<div class="strategy-row__info"> 
				<div class="strategy-row__name">${escapeHtml(strategy.name)} ${statusBadge(strategy.statusLabel, strategy.status)}</div> 
				<div class="strategy-row__sub">${pill(strategy.symbolLabel)} <span class="strategy-row__runtime">${escapeHtml(strategy.runtimeLabel)}</span> <span class="strategy-row__versions">${escapeHtml(vscode.l10n.t('v{0}', String(strategy.versionCount)))}</span></div> 
			</div> 
			<div class="strategy-row__metrics"> 
				<div class="strategy-row__metric"> 
					<span class="strategy-row__metric-label">${escapeHtml(vscode.l10n.t('\u6536\u76ca\u7387'))}</span> 
					<span class="strategy-row__metric-value ${strategy.returnPct !== undefined && strategy.returnPct >= 0 ? 'positive' : strategy.returnPct !== undefined && strategy.returnPct < 0 ? 'negative' : ''}">${escapeHtml(formatSignedPercentCompact(strategy.returnPct))}</span> 
				</div> 
				<div class="strategy-row__metric"> 
					<span class="strategy-row__metric-label">${escapeHtml(vscode.l10n.t('\u590f\u666e'))}</span> 
					<span class="strategy-row__metric-value">${escapeHtml(formatCompactNumber(strategy.sharpeRatio))}</span> 
				</div> 
				<div class="strategy-row__metric"> 
					<span class="strategy-row__metric-label">${escapeHtml(vscode.l10n.t('\u65e5\u671f'))}</span> 
					<span class="strategy-row__metric-value">${escapeHtml(strategy.boardDateLabel)}</span> 
				</div> 
			</div> 
			<button class="strategy-row__run" data-action="runStrategy" data-strategy-id="${id}" title="${escapeHtml(vscode.l10n.t('\u8fd0\u884c\u56de\u6d4b'))}">\u25b6</button> 
		</div> 
		<div class="strategy-detail" id="detail-${id}"> 
			<div class="strategy-detail__inner"> 
				<div class="strategy-detail__section"> 
					<div class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u7b56\u7565\u8bf4\u660e'))}</div> 
					<div class="strategy-detail__text">${escapeHtml(strategy.summary)}</div> 
				</div> 
				<div class="strategy-detail__grid"> 
					<div class="strategy-detail__item"> 
						<span class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u5165\u53e3\u6587\u4ef6'))}</span> 
						<span class="strategy-detail__value">${escapeHtml(strategy.entry || vscode.l10n.t('\u672a\u914d\u7f6e'))}</span> 
					</div> 
					<div class="strategy-detail__item"> 
						<span class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u8fd0\u884c\u547d\u4ee4'))}</span> 
						<span class="strategy-detail__value strategy-detail__value--mono">${escapeHtml(strategy.command || vscode.l10n.t('\u672a\u914d\u7f6e'))}</span> 
					</div> 
					<div class="strategy-detail__item"> 
						<span class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u6700\u5927\u56de\u64a4'))}</span> 
						<span class="strategy-detail__value">${escapeHtml(formatSignedPercentCompact(strategy.maxDrawdownPct))}</span> 
					</div> 
					<div class="strategy-detail__item"> 
						<span class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u80dc\u7387'))}</span> 
						<span class="strategy-detail__value">${escapeHtml(formatPercent(strategy.winRatePct))}</span> 
					</div> 
					<div class="strategy-detail__item"> 
						<span class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u6708 Alpha'))}</span> 
						<span class="strategy-detail__value">${escapeHtml(formatSignedPercentCompact(strategy.monthlyAlphaPct))}</span> 
					</div> 
					<div class="strategy-detail__item"> 
						<span class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u66f4\u65b0\u65f6\u95f4'))}</span> 
						<span class="strategy-detail__value">${escapeHtml(strategy.updatedAtLabel)}</span> 
					</div> 
				</div> 
				<div class="strategy-detail__section"> 
					<div class="strategy-detail__label">${escapeHtml(vscode.l10n.t('\u6807\u7b7e'))}</div> 
					<div class="strategy-detail__tags">${tagsHtml}</div> 
				</div> 
				<div class="strategy-detail__actions"> 
					<button class="button button--primary" data-action="openStrategy" data-strategy-id="${id}">${escapeHtml(vscode.l10n.t('\u67e5\u770b\u56de\u6d4b\u8be6\u60c5'))}</button> 
					<button class="button" data-action="runStrategy" data-strategy-id="${id}">${escapeHtml(vscode.l10n.t('\u8fd0\u884c\u56de\u6d4b'))}</button> 
				</div> 
			</div> 
		</div> 
	</div>`;
}
export function renderDataGroupCard(group: DataGroupViewModel): string {
	return `<div class="data-group-wrap">
		<div class="data-group-row" data-toggle-group="${escapeHtml(group.id)}" aria-expanded="false">
			<span class="data-group-row__icon">\u25b8</span>
			<div class="data-group-row__info">
				<strong>${escapeHtml(group.title)}</strong>
				<span>${escapeHtml(group.subtitle)} \xb7 ${escapeHtml(group.fileCountLabel)}</span>
			</div>
			<span class="data-group-row__linkage">${escapeHtml(vscode.l10n.t('\u5173\u8054 {0} \u4e2a\u7b56\u7565', String(group.linkedStrategyCount)))}</span>
		</div>
		<div class="data-group-body" id="group-${escapeHtml(group.id)}">
			${group.items.map(renderDataFileRow).join('')}
		</div>
	</div>`;
}
function renderDataFileRow(item: DataViewModel): string {
	const sourceTone = item.sourceLabel === vscode.l10n.t('\u771f\u5b9e') ? 'data-chip--real' : 'data-chip--sim';
	return `<div class="data-row" data-role="data-row" data-market="${escapeHtml(item.market)}" data-timeframe="${escapeHtml(item.timeframe)}">
		<span class="data-row__dot" style="background:${item.sourceLabel === vscode.l10n.t('\u771f\u5b9e') ? '#16a34a' : '#d97706'}"></span>
		<div class="data-row__name">${escapeHtml(item.name)}</div>
		<div class="data-row__chips">
			<span class="data-chip">${escapeHtml(item.timeframe.toUpperCase())}</span>
			<span class="data-chip">${escapeHtml(item.dtypeLabel)}</span>
			<span class="data-chip ${escapeHtml(sourceTone)}">${escapeHtml(item.sourceLabel)}</span>
			${item.storageLabel !== vscode.l10n.t('\u4e3b\u6570\u636e') ? '<span class="data-chip">' + escapeHtml(item.storageLabel) + '</span>' : ''}
		</div>
		<div class="data-row__range">${escapeHtml(item.coverageLabel)}</div>
	</div>`;
}
export function renderDownloadTaskSection(tasks: readonly DownloadTaskViewModel[]): string { return `<section class="download-task-card"> 		<div class="download-task-card__title">${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u4efb\u52a1'))}</div> 		<div class="download-task-card__list"> 			${tasks.map(renderDownloadTaskRow).join('')} 		</div> 	</section>`; }
function renderDownloadTaskRow(task: DownloadTaskViewModel): string { return `<div class="download-task-row"> 		<div class="download-task-row__main"> 			<strong>${escapeHtml(task.title)}</strong> 			<span>${escapeHtml(task.subtitle)}</span> 		</div> 		<div class="download-task-row__status download-task-row__status--${escapeHtml(task.status)}">${escapeHtml(task.statusLabel)}</div> 	</div>`; }
function linkedDataChip(item: DataViewModel): string { return `<span class="detail-linked-data__chip">${escapeHtml(`${item.symbol} \xb7 ${item.timeframe} \xb7 ${item.coverageLabel}`)}</span>`; }
export function renderDownloadModal(): string { return ` 		<div class="modal" id="download-modal"> 			<div class="modal__dialog"> 				<div class="modal__header modal__header--sheet"> 					<h2>${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u5e02\u573a\u6570\u636e'))}</h2> 					<button class="text-button modal__close" data-close-modal="download-modal" aria-label="${escapeHtml(vscode.l10n.t('\u5173\u95ed'))}">\xd7</button> 				</div> 				<div class="modal__body modal__body--sheet"> 					<div class="modal__row modal__row--channels"> 						<label class="field field--select"> 							<span>${escapeHtml(vscode.l10n.t('\u4e0b\u8f7d\u6e20\u9053'))}</span> 							<select id="download-channel"> 								<option value="auto">${escapeHtml(vscode.l10n.t('\u81ea\u52a8\uff08\u63a8\u8350\uff09'))}</option> 								<option value="real">${escapeHtml(vscode.l10n.t('\u771f\u5b9e\u6570\u636e'))}</option> 								<option value="simulated">${escapeHtml(vscode.l10n.t('\u6a21\u62df\u6570\u636e'))}</option> 							</select> 						</label> 						<label class="field field--select"> 							<span>${escapeHtml(vscode.l10n.t('\u4ea4\u6613\u6240'))}</span> 							<select id="download-exchange"> 								<option>binance</option> 								<option>okx</option> 								<option>bybit</option> 								<option>noexchange</option> 							</select> 						</label> 					</div> 					<div class="modal__row"> 						<label class="field modal__row-main"> 							<span>${escapeHtml(vscode.l10n.t('\u6807\u7684'))}</span> 							<input id="download-symbol" value="BTC/USDT" /> 						</label> 						<div class="field modal__row-side"> 							<span>${escapeHtml(vscode.l10n.t('\u5e02\u573a'))}</span> 							<div class="radio-row"> 								<label><input type="radio" name="market-kind" value="spot" checked /><span>${escapeHtml(vscode.l10n.t('\u73b0\u8d27'))}</span></label> 								<label><input type="radio" name="market-kind" value="futures" /><span>${escapeHtml(vscode.l10n.t('\u5408\u7ea6'))}</span></label> 								<label><input type="radio" name="market-kind" value="options" /><span>${escapeHtml(vscode.l10n.t('\u671f\u6743'))}</span></label> 							</div> 						</div> 					</div> 					<label class="field field--select"> 						<span>${escapeHtml(vscode.l10n.t('\u7c7b\u578b'))}</span> 						<select id="download-dtype"> 							<option>ohlcv</option> 							<option>trades</option> 							<option>funding_rate</option> 							<option>open_interest</option> 							<option>book_l1</option> 							<option>book_l2</option> 							<option>liquidations</option> 						</select> 					</label> 					<label class="field field--select"> 						<span>${escapeHtml(vscode.l10n.t('\u65f6\u95f4\u7c92\u5ea6'))}</span> 						<select id="download-interval"> 							<option>1h</option> 							<option>4h</option> 							<option>1d</option> 							<option>30m</option> 							<option>15m</option> 							<option>5m</option> 							<option>1m</option> 						</select> 					</label> 					<div class="modal__row modal__row--dates"> 						<label class="field"> 							<span>${escapeHtml(vscode.l10n.t('\u5f00\u59cb\u65e5\u671f'))}</span> 							<input id="download-start" type="date" value="2026-04-19" /> 						</label> 						<label class="field"> 							<span>${escapeHtml(vscode.l10n.t('\u7ed3\u675f\u65e5\u671f'))}</span> 							<input id="download-end" type="date" value="2026-05-19" /> 						</label> 					</div> 					<div class="modal__hint">${escapeHtml(vscode.l10n.t('\u5c06\u4f7f\u7528\u9879\u76ee\u5185\u7684 Python \u6570\u636e\u5de5\u5177\u6267\u884c\u4e0b\u8f7d\u547d\u4ee4\u3002'))}</div> 				</div> 				<div class="modal__footer"> 					<button class="button" data-close-modal="download-modal">${escapeHtml(vscode.l10n.t('\u53d6\u6d88'))}</button> 					<button class="button button--primary button--disabled" type="button" id="download-submit" data-submit-download="true">${escapeHtml(vscode.l10n.t('\u5f00\u59cb\u4e0b\u8f7d'))}</button> 				</div> 			</div> 		</div> 	`; }
export function statusBadge(label: string, tone: string): string { return `<span class="status-badge" data-tone="${escapeHtml(tone)}">${escapeHtml(label)}</span>`; }
export function pill(label: string): string { return `<span class="pill">${escapeHtml(label)}</span>`; }
export function filterChip(group: string, value: string, label: string, active = false): string { return `<button class="chip${active ? ' is-active' : ''}" data-filter-group="${escapeHtml(group)}" data-filter-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`; }
export function emptyInline(text: string): string { return `<div class="empty-inline">${escapeHtml(text)}</div>`; }
function lineChartSvg(values: readonly number[], stroke: string, fill: string): string { const width = 960; const height = 280; const padding = 18; const max = Math.max(...values, 1); const min = Math.min(...values, 0); const span = Math.max(max - min, 1); const points = values.map((value, index) => { const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1); const y = height - padding - ((value - min) / span) * (height - padding * 2); return `${x},${y}`; }).join(' '); const area = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`; return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#ffffff"></rect><path d="M ${area}" fill="${fill}" opacity="0.75"></path><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`; }
function areaChartSvg(values: readonly number[], stroke: string, fill: string): string { const width = 960; const height = 180; const padding = 18; const max = 0; const min = Math.min(...values, -1); const span = Math.max(max - min, 1); const points = values.map((value, index) => { const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1); const y = height - padding - ((value - min) / span) * (height - padding * 2); return `${x},${y}`; }).join(' '); const area = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`; return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect x="0" y="0" width="${width}" height="${height}" rx="18" fill="#ffffff"></rect><path d="M ${area}" fill="${fill}" opacity="0.65"></path><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`; }
function buildPerformanceSeries(returnPct: number | undefined, sharpeRatio: number | undefined): readonly number[] { const base = (returnPct ?? 12) / 100; const momentum = (sharpeRatio ?? 1.2) / 12; return [1, 1 + base * 0.08, 1 + base * 0.12 + momentum * 0.2, 1 + base * 0.18 + momentum * 0.34, 1 + base * 0.21 + momentum * 0.25, 1 + base * 0.28 + momentum * 0.4, 1 + base * 0.34 + momentum * 0.46, 1 + base * 0.39 + momentum * 0.41, 1 + base * 0.46 + momentum * 0.55, 1 + base * 0.53 + momentum * 0.6, 1 + base * 0.6 + momentum * 0.72, 1 + base * 0.68 + momentum * 0.78]; }
function buildDrawdownSeries(maxDrawdownPct: number | undefined): readonly number[] { const drawdown = Math.abs((maxDrawdownPct ?? -9) / 100); return [0, -drawdown * 0.18, -drawdown * 0.42, -drawdown * 0.25, -drawdown * 0.6, -drawdown * 0.48, -drawdown * 0.82, -drawdown * 0.7, -drawdown * 0.52, -drawdown * 0.4, -drawdown * 0.22, -drawdown * 0.12]; }
