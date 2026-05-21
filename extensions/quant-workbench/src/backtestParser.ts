/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QuantFact, QuantItem } from './models';

export interface ParsedBacktestResult {
	readonly role: 'equity' | 'drawdown' | 'generic';
	readonly returnPct?: number;
	readonly sharpeRatio?: number;
	readonly maxDrawdownPct?: number;
	readonly winRatePct?: number;
	readonly tradeCount?: number;
	readonly dateStart?: string;
	readonly dateEnd?: string;
	readonly chart?: QuantItem['chart'];
}

export function extractJsonFacts(text: string | undefined, parsedMetrics?: ParsedBacktestResult): QuantFact[] {
	if (!text) {
		return [{ label: vscode.l10n.t('Format'), value: vscode.l10n.t('Unavailable') }];
	}

	try {
		const parsedJson = JSON.parse(text) as Record<string, unknown>;
		if (!parsedJson || Array.isArray(parsedJson)) {
			return [{ label: vscode.l10n.t('Format'), value: vscode.l10n.t('JSON array') }];
		}

		const facts: QuantFact[] = [{ label: vscode.l10n.t('Format'), value: vscode.l10n.t('JSON object') }];
		const keys = Object.keys(parsedJson).slice(0, 6);
		if (keys.length > 0) {
			facts.push({ label: vscode.l10n.t('Keys'), value: keys.join(', ') });
		}

		for (const key of ['sharpe', 'sharpeRatio', 'maxDrawdown', 'totalReturn', 'annualReturn', 'winRate']) {
			const value = parsedJson[key];
			if (typeof value === 'number' || typeof value === 'string') {
				facts.push({ label: key, value: String(value) });
			}
		}

		if (parsedMetrics) {
			if (parsedMetrics.returnPct !== undefined) {
				facts.push({ label: vscode.l10n.t('returnPct'), value: `${parsedMetrics.returnPct.toFixed(2)}%` });
			}
			if (parsedMetrics.sharpeRatio !== undefined) {
				facts.push({ label: vscode.l10n.t('sharpeRatio'), value: parsedMetrics.sharpeRatio.toFixed(3) });
			}
			if (parsedMetrics.maxDrawdownPct !== undefined) {
				facts.push({ label: vscode.l10n.t('maxDrawdownPct'), value: `${parsedMetrics.maxDrawdownPct.toFixed(2)}%` });
			}
			if (parsedMetrics.winRatePct !== undefined) {
				facts.push({ label: vscode.l10n.t('winRatePct'), value: `${parsedMetrics.winRatePct.toFixed(2)}%` });
			}
			if (parsedMetrics.tradeCount !== undefined) {
				facts.push({ label: vscode.l10n.t('tradeCount'), value: String(Math.round(parsedMetrics.tradeCount)) });
			}
		}

		return facts;
	} catch {
		return [{ label: vscode.l10n.t('Format'), value: vscode.l10n.t('Text file') }];
	}
}

export function parseBacktestResult(text: string | undefined, filename: string): ParsedBacktestResult | undefined {
	if (!text) {
		return undefined;
	}

	let root: unknown;
	try {
		root = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(root)) {
		return undefined;
	}

	const numeric = extractNumericMetrics(root);
	const equitySeries = findBestEquitySeries(root);
	const drawdownSeries = findBestDrawdownSeries(root);
	const chart = buildBacktestChart(equitySeries, drawdownSeries);
	const derivedReturnPct = deriveReturnPct(equitySeries?.strategy);
	const derivedMaxDrawdownPct = deriveMaxDrawdownPct(drawdownSeries?.drawdown, equitySeries?.strategy);
	const role = inferResultRole(filename, chart);

	const dateStart = chart?.dates?.[0];
	const dateEnd = chart?.dates && chart.dates.length > 0 ? chart.dates[chart.dates.length - 1] : undefined;

	return {
		role,
		returnPct: pickDefined(toPercentFromRatio(numeric.returnRatio), derivedReturnPct),
		sharpeRatio: pickDefined(numeric.sharpeRatio),
		maxDrawdownPct: pickDefined(toPercentFromRatioSigned(numeric.maxDrawdownRatio), derivedMaxDrawdownPct),
		winRatePct: pickDefined(toPercentFromRatio(numeric.winRateRatio)),
		tradeCount: pickDefined(numeric.tradeCount),
		dateStart,
		dateEnd,
		chart
	};
}

function inferResultRole(filename: string, chart: QuantItem['chart'] | undefined): 'equity' | 'drawdown' | 'generic' {
	const lower = filename.toLowerCase();
	if (lower.includes('drawdown')) {
		return 'drawdown';
	}
	if (lower.includes('equity') || chart?.strategy || chart?.benchmark) {
		return 'equity';
	}
	if (chart?.drawdown) {
		return 'drawdown';
	}
	return 'generic';
}

function buildBacktestChart(
	equitySeries: { dates?: string[]; strategy?: number[]; benchmark?: number[] } | undefined,
	drawdownSeries: { dates?: string[]; drawdown?: number[] } | undefined
): QuantItem['chart'] | undefined {
	const dates = equitySeries?.dates ?? drawdownSeries?.dates;
	const strategy = equitySeries?.strategy;
	const benchmark = equitySeries?.benchmark;
	const drawdown = drawdownSeries?.drawdown;
	if (!dates && !strategy && !benchmark && !drawdown) {
		return undefined;
	}
	return {
		dates,
		strategy,
		benchmark,
		drawdown
	};
}

function findBestEquitySeries(root: unknown): { dates?: string[]; strategy?: number[]; benchmark?: number[] } | undefined {
	const candidates = collectObjectCandidates(root, 4);
	let best: { dates?: string[]; strategy?: number[]; benchmark?: number[] } | undefined;
	let bestLen = 0;

	for (const candidate of candidates) {
		const strategy = getDirectNumberArray(candidate, ['strategy_equity', 'strategyEquity', 'equity', 'equity_curve', 'portfolio_value', 'strategy']);
		if (!strategy || strategy.length < 2) {
			continue;
		}
		const dates = getDirectStringArray(candidate, ['dates', 'date', 'timestamps', 'time']);
		const benchmark = getDirectNumberArray(candidate, ['benchmark_equity', 'benchmarkEquity', 'benchmark', 'benchmark_curve']);
		if (strategy.length > bestLen) {
			bestLen = strategy.length;
			best = { dates, strategy, benchmark };
		}
	}

	return best;
}

function findBestDrawdownSeries(root: unknown): { dates?: string[]; drawdown?: number[] } | undefined {
	const candidates = collectObjectCandidates(root, 4);
	let best: { dates?: string[]; drawdown?: number[] } | undefined;
	let bestLen = 0;

	for (const candidate of candidates) {
		const drawdown = getDirectNumberArray(candidate, ['drawdown', 'strategy_drawdown', 'drawdown_curve', 'dd']);
		if (!drawdown || drawdown.length < 2) {
			continue;
		}
		const dates = getDirectStringArray(candidate, ['dates', 'date', 'timestamps', 'time']);
		if (drawdown.length > bestLen) {
			bestLen = drawdown.length;
			best = { dates, drawdown };
		}
	}

	return best;
}

function extractNumericMetrics(root: unknown): {
	returnRatio?: number;
	sharpeRatio?: number;
	maxDrawdownRatio?: number;
	winRateRatio?: number;
	tradeCount?: number;
} {
	return {
		returnRatio: findNumericByKeys(root, ['total_strategy_return', 'strategy_return', 'totalReturn', 'returnPct', 'annual_strategy_return']),
		sharpeRatio: findNumericByKeys(root, ['strategy_sharpe', 'sharpeRatio', 'sharpe']),
		maxDrawdownRatio: findNumericByKeys(root, ['max_strategy_drawdown', 'maxDrawdown', 'max_drawdown', 'max_dd']),
		winRateRatio: findNumericByKeys(root, ['win_rate', 'winRate', 'win_rate_pct', 'winRatePct']),
		tradeCount: findNumericByKeys(root, ['trades', 'trade_count', 'tradeCount', 'total_trades'])
	};
}

function findNumericByKeys(node: unknown, keys: readonly string[]): number | undefined {
	const keySet = new Set(keys.map(normalizeMetricKey));
	const value = findValueByNormalizedKeys(node, keySet, 6);
	return toFiniteNumber(value);
}

function findValueByNormalizedKeys(node: unknown, keys: ReadonlySet<string>, depth: number): unknown {
	if (depth < 0 || node === null || node === undefined) {
		return undefined;
	}
	if (Array.isArray(node)) {
		for (const value of node) {
			const matched = findValueByNormalizedKeys(value, keys, depth - 1);
			if (matched !== undefined) {
				return matched;
			}
		}
		return undefined;
	}
	if (!isRecord(node)) {
		return undefined;
	}

	for (const [key, value] of Object.entries(node)) {
		if (keys.has(normalizeMetricKey(key))) {
			return value;
		}
	}
	for (const value of Object.values(node)) {
		const matched = findValueByNormalizedKeys(value, keys, depth - 1);
		if (matched !== undefined) {
			return matched;
		}
	}
	return undefined;
}

function collectObjectCandidates(node: unknown, depth: number, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
	if (depth < 0 || node === null || node === undefined) {
		return out;
	}
	if (Array.isArray(node)) {
		for (const value of node) {
			collectObjectCandidates(value, depth - 1, out);
		}
		return out;
	}
	if (!isRecord(node)) {
		return out;
	}

	out.push(node);
	for (const value of Object.values(node)) {
		collectObjectCandidates(value, depth - 1, out);
	}
	return out;
}

function getDirectNumberArray(node: Record<string, unknown>, keys: readonly string[]): number[] | undefined {
	for (const key of keys) {
		const value = getDirectValue(node, key);
		const numbers = toNumberArray(value);
		if (numbers && numbers.length > 0) {
			return numbers;
		}
	}
	return undefined;
}

function getDirectStringArray(node: Record<string, unknown>, keys: readonly string[]): string[] | undefined {
	for (const key of keys) {
		const value = getDirectValue(node, key);
		const strings = toStringArray(value);
		if (strings && strings.length > 0) {
			return strings;
		}
	}
	return undefined;
}

function getDirectValue(node: Record<string, unknown>, key: string): unknown {
	const target = normalizeMetricKey(key);
	for (const [entryKey, value] of Object.entries(node)) {
		if (normalizeMetricKey(entryKey) === target) {
			return value;
		}
	}
	return undefined;
}

function toNumberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const numbers: number[] = [];
	for (const item of value) {
		const n = toFiniteNumber(item);
		if (n !== undefined) {
			numbers.push(n);
		}
	}
	return numbers.length > 0 ? numbers : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const strings = value
		.map(item => (typeof item === 'string' ? item : (item instanceof Date ? item.toISOString() : String(item))))
		.filter(item => item.length > 0)
		.map(item => item.slice(0, 10));
	return strings.length > 0 ? strings : undefined;
}

function deriveReturnPct(strategy: readonly number[] | undefined): number | undefined {
	if (!strategy || strategy.length < 2) {
		return undefined;
	}
	const first = strategy[0];
	const last = strategy[strategy.length - 1];
	if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
		return undefined;
	}
	return Number((((last / first) - 1) * 100).toFixed(2));
}

function deriveMaxDrawdownPct(drawdown: readonly number[] | undefined, strategy: readonly number[] | undefined): number | undefined {
	if (drawdown && drawdown.length > 0) {
		const minDrawdown = Math.min(...drawdown);
		return Number((toPercentFromRatioSigned(minDrawdown) ?? minDrawdown).toFixed(2));
	}
	if (!strategy || strategy.length < 2) {
		return undefined;
	}

	let peak = strategy[0];
	let worst = 0;
	for (const value of strategy) {
		if (value > peak) {
			peak = value;
		}
		if (peak !== 0) {
			const dd = (value - peak) / peak;
			if (dd < worst) {
				worst = dd;
			}
		}
	}
	return Number((worst * 100).toFixed(2));
}

function normalizeMetricKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function toPercentFromRatio(value: number | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const abs = Math.abs(value);
	const pct = abs <= 2 ? value * 100 : value;
	return Number(pct.toFixed(2));
}

function toPercentFromRatioSigned(value: number | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const abs = Math.abs(value);
	const pct = abs <= 2 ? value * 100 : value;
	return Number(pct.toFixed(2));
}

export function mergeCharts(
	equityChart: QuantItem['chart'] | undefined,
	drawdownChart: QuantItem['chart'] | undefined,
	fallback: QuantItem['chart'] | undefined
): QuantItem['chart'] | undefined {
	const dates = equityChart?.dates ?? drawdownChart?.dates ?? fallback?.dates;
	const strategy = equityChart?.strategy ?? fallback?.strategy;
	const benchmark = equityChart?.benchmark ?? fallback?.benchmark;
	const drawdown = drawdownChart?.drawdown ?? equityChart?.drawdown ?? fallback?.drawdown;
	if (!dates && !strategy && !benchmark && !drawdown) {
		return undefined;
	}
	return { dates, strategy, benchmark, drawdown };
}

export function pickDefined<T>(...values: ReadonlyArray<T | undefined>): T | undefined {
	for (const value of values) {
		if (value !== undefined) {
			return value;
		}
	}
	return undefined;
}

export function addMetricFact(facts: QuantFact[], label: string, value: string | undefined): void {
	if (!value) {
		return;
	}
	facts.push({ label, value });
}

export function formatPctFact(value: number | undefined): string | undefined {
	return value === undefined ? undefined : `${value.toFixed(2)}%`;
}

export function formatNumberFact(value: number | undefined): string | undefined {
	return value === undefined ? undefined : value.toFixed(3);
}

export function formatTradeFact(value: number | undefined): string | undefined {
	return value === undefined ? undefined : String(Math.round(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
