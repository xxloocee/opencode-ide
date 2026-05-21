/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuantChartSeries, QuantItem, QuantWorkspaceConfig } from './models';

export type QuantPage = 'overview' | 'strategies' | 'data' | 'strategyDetail';

export interface QuantPageRoute {
	readonly page: QuantPage;
	readonly strategyId?: string;
	readonly dataId?: string;
}

export interface QuantSnapshot {
	readonly name: string;
	readonly items: readonly QuantItem[];
	readonly config?: QuantWorkspaceConfig;
}

export interface RunRecord {
	readonly id: string;
	readonly label: string;
	readonly status: string;
	readonly startedAt: string;
	readonly summary: string;
}

export interface DownloadTaskRecord {
	readonly id: string;
	readonly channel: 'auto' | 'real' | 'simulated';
	readonly exchange: string;
	readonly symbol: string;
	readonly market: 'spot' | 'futures' | 'options';
	readonly dtype: string;
	readonly interval: string;
	readonly start: string;
	readonly end: string;
	readonly status: 'running' | 'success' | 'failed';
	readonly startedAt: string;
	readonly finishedAt?: string;
	readonly summary: string;
	readonly command?: string;
	readonly message?: string;
	readonly progress?: number;
}

export interface DownloadSelectOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
	readonly disabled?: boolean;
}

export interface DownloadFormOptions {
	readonly toolAvailable: boolean;
	readonly toolStatusLabel: string;
	readonly commandPreview: string;
	readonly channels: readonly DownloadSelectOption[];
	readonly exchanges: readonly DownloadSelectOption[];
	readonly markets: readonly DownloadSelectOption[];
	readonly dtypes: readonly DownloadSelectOption[];
	readonly intervals: readonly DownloadSelectOption[];
	readonly symbols: readonly DownloadSelectOption[];
	readonly defaults: DownloadFormValue;
}

export interface PanelMessage {
	readonly type: 'openOverview' | 'openStrategies' | 'openData' | 'openStrategy' | 'runStrategy' | 'openConfig' | 'downloadData';
	readonly strategyId?: string;
	readonly payload?: DownloadFormValue;
}

export interface DownloadFormValue {
	readonly channel: 'auto' | 'real' | 'simulated';
	readonly exchange: string;
	readonly symbol: string;
	readonly market: 'spot' | 'futures' | 'options';
	readonly dtype: string;
	readonly interval: string;
	readonly start: string;
	readonly end: string;
}

export interface StrategyViewModel {
	readonly id: string;
	readonly name: string;
	readonly status: 'draft' | 'backtested' | 'running' | 'paper' | 'archived';
	readonly statusLabel: string;
	readonly asset: 'spot' | 'futures' | 'options';
	readonly assetLabel: string;
	readonly runtimeLabel: string;
	readonly symbolLabel: string;
	readonly versionCount: number;
	readonly summary: string;
	readonly command: string;
	readonly entry: string;
	readonly updatedAt: number;
	readonly updatedAtLabel: string;
	readonly boardDateLabel: string;
	readonly returnPct?: number;
	readonly sharpeRatio?: number;
	readonly maxDrawdownPct?: number;
	readonly winRatePct?: number;
	readonly monthlyAlphaPct?: number;
	readonly dateStart?: string;
	readonly dateEnd?: string;
	readonly chart?: QuantChartSeries;
	readonly dataInputs: readonly string[];
	readonly matchedOutputs: readonly string[];
	readonly tags: readonly string[];
	readonly facts: readonly {
		label: string;
		value: string;
	}[];
	readonly preview: string;
}

export interface DataViewModel {
	readonly id: string;
	readonly name: string;
	readonly symbol: string;
	readonly market: 'spot' | 'futures' | 'options';
	readonly marketLabel: string;
	readonly timeframe: string;
	readonly dtypeLabel: string;
	readonly sourceLabel: string;
	readonly storageLabel: string;
	readonly coverageLabel: string;
	readonly rowsLabel: string;
	readonly columnsLabel: string;
	readonly sizeLabel: string;
	readonly updatedAtLabel: string;
	readonly statusLabel: string;
	readonly summary: string;
	readonly preview: string;
	readonly path: string;
}

export interface BacktestViewModel {
	readonly id: string;
	readonly name: string;
	readonly summary: string;
	readonly facts: readonly {
		label: string;
		value: string;
	}[];
	readonly preview: string;
}

export interface StrategyBoardSummary {
	readonly totalStrategies: number;
	readonly backtestedStrategies: number;
	readonly avgSharpeLabel: string;
	readonly bestStrategyLabel: string;
}

export interface StrategyDetailModel {
	readonly symbolLabel: string;
	readonly versionCount: number;
	readonly tradeCountLabel: string;
	readonly dateRangeLabel: string;
	readonly fileLabel: string;
}

export interface DataBoardSummary {
	readonly fileCount: number;
	readonly totalSizeLabel: string;
	readonly symbolCount: number;
	readonly coverageLabel: string;
	readonly realCount: number;
	readonly simulatedCount: number;
	readonly activeDownloadLabel: string;
}

export interface DownloadTaskViewModel {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly status: 'running' | 'success' | 'failed';
	readonly statusLabel: string;
	readonly message: string;
	readonly progress: number;
	readonly command?: string;
}

export interface DataGroupViewModel {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly fileCountLabel: string;
	readonly market: DataViewModel['market'];
	readonly linkedStrategyCount: number;
	readonly items: readonly DataViewModel[];
}
