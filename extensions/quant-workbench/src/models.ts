/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface QuantWorkspaceConfig {
	name?: string;
	dataDir?: string;
	strategies?: QuantStrategyConfig[];
	outputs?: QuantOutputConfig;
}

export interface QuantStrategyConfig {
	id: string;
	name: string;
	entry?: string;
	command?: string;
	status?: 'draft' | 'backtested' | 'running' | 'paper' | 'archived';
	asset?: 'spot' | 'futures' | 'options';
	returnPct?: number;
	sharpeRatio?: number;
	tags?: string[];
}

export interface QuantOutputConfig {
	equity?: string;
	drawdown?: string;
}

export type QuantItemKind = 'strategy' | 'data' | 'backtest' | 'summary';

export interface QuantFact {
	readonly label: string;
	readonly value: string;
}

export interface QuantChartSeries {
	readonly dates?: ReadonlyArray<string>;
	readonly strategy?: ReadonlyArray<number>;
	readonly benchmark?: ReadonlyArray<number>;
	readonly drawdown?: ReadonlyArray<number>;
}

export interface QuantItem {
	readonly kind: QuantItemKind;
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly detail?: string;
	readonly summary?: string;
	readonly uri?: vscode.Uri;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly facts?: ReadonlyArray<QuantFact>;
	readonly preview?: string;
	readonly status?: string;
	readonly asset?: string;
	readonly updatedAt?: number;
	readonly returnPct?: number;
	readonly sharpeRatio?: number;
	readonly maxDrawdownPct?: number;
	readonly winRatePct?: number;
	readonly tradeCount?: number;
	readonly dateStart?: string;
	readonly dateEnd?: string;
	readonly tags?: ReadonlyArray<string>;
	readonly parsedTimeframe?: string;
	readonly parsedSource?: 'real' | 'simulated';
	readonly chart?: QuantChartSeries;
}
