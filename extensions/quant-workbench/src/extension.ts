/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exec, execFile } from 'child_process';
import { delimiter, join } from 'path';
import * as vscode from 'vscode';
import { QuantWorkbenchPanel, type QuantPageRoute } from './quantWorkbenchPanel';
import { QuantItem } from './models';
import { scanQuantWorkspace } from './workspaceScanner';
import { DownloadFormOptions } from './panelTypes';

type NavKind = 'overview' | 'strategy' | 'data' | 'recentRun' | 'action' | 'empty';

interface NavItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly tooltip?: string;
	readonly kind: NavKind;
	readonly icon: string;
	readonly command?: string;
	readonly args?: readonly unknown[];
}

interface RunRecord {
	readonly id: string;
	readonly label: string;
	readonly status: string;
	readonly startedAt: string;
	readonly summary: string;
}

interface DownloadRequest {
	readonly channel: 'auto' | 'real' | 'simulated';
	readonly exchange: string;
	readonly symbol: string;
	readonly market: 'spot' | 'futures' | 'options';
	readonly dtype: string;
	readonly interval: string;
	readonly start: string;
	readonly end: string;
}

type DownloadTaskStatus = 'running' | 'success' | 'failed';

interface DownloadTaskRecord extends DownloadRequest {
	readonly id: string;
	status: DownloadTaskStatus;
	readonly startedAt: string;
	finishedAt?: string;
	summary: string;
	command?: string;
	message?: string;
	progress?: number;
}

const defaultDownloadRequest: DownloadRequest = {
	channel: 'auto',
	exchange: 'binance',
	symbol: 'BTC/USDT',
	market: 'spot',
	dtype: 'ohlcv',
	interval: '1h',
	start: '2026-04-19',
	end: '2026-05-19'
};

const downloadExchanges = ['binance', 'okx', 'bybit'];
const downloadDtypes = ['ohlcv', 'trades', 'funding_rate', 'open_interest', 'book_l1', 'book_l2', 'liquidations'];
const downloadIntervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const downloadSymbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT'];

class QuantNavProvider implements vscode.TreeDataProvider<NavItem> {
	private readonly emitter = new vscode.EventEmitter<NavItem | undefined | void>();
	readonly onDidChangeTreeData = this.emitter.event;
	private items: NavItem[] = [];

	getTreeItem(element: NavItem): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(element.label);
		treeItem.description = element.description;
		treeItem.tooltip = element.tooltip ?? element.description;
		treeItem.contextValue = element.kind;
		treeItem.iconPath = new vscode.ThemeIcon(element.icon);
		if (element.command) {
			treeItem.command = {
				command: element.command,
				title: element.label,
				arguments: [...(element.args ?? [])]
			};
		}
		return treeItem;
	}

	getChildren(): NavItem[] {
		return this.items;
	}

	setItems(items: NavItem[]): void {
		this.items = items;
		this.emitter.fire(undefined);
	}
}

let overviewProvider: QuantNavProvider;
let strategyProvider: QuantNavProvider;
let dataProvider: QuantNavProvider;
let recentRunsProvider: QuantNavProvider;
let outputChannel: vscode.OutputChannel;
let extensionContextRef: vscode.ExtensionContext;
const runHistory: RunRecord[] = [];
const downloadTasks: DownloadTaskRecord[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	extensionContextRef = context;
	outputChannel = vscode.window.createOutputChannel(vscode.l10n.t('\u91cf\u5316\u56de\u6d4b'));
	overviewProvider = new QuantNavProvider();
	strategyProvider = new QuantNavProvider();
	dataProvider = new QuantNavProvider();
	recentRunsProvider = new QuantNavProvider();

	context.subscriptions.push(
		outputChannel,
		vscode.window.createTreeView('quant-workbench.overview', { treeDataProvider: overviewProvider, showCollapseAll: false }),
		vscode.window.createTreeView('quant-workbench.strategies', { treeDataProvider: strategyProvider, showCollapseAll: false }),
		vscode.window.createTreeView('quant-workbench.data', { treeDataProvider: dataProvider, showCollapseAll: false }),
		vscode.window.createTreeView('quant-workbench.recentRuns', { treeDataProvider: recentRunsProvider, showCollapseAll: false }),
		vscode.commands.registerCommand('quant-workbench.openOverview', () => openPage(context, { page: 'overview' })),
		vscode.commands.registerCommand('quant-workbench.openStrategies', () => openPage(context, { page: 'strategies' })),
		vscode.commands.registerCommand('quant-workbench.openDataCenter', () => openPage(context, { page: 'data' })),
		vscode.commands.registerCommand('quant-workbench.openStrategyDetail', (strategyOrId?: QuantItem | string) => openStrategyDetail(context, strategyOrId)),
		vscode.commands.registerCommand('quant-workbench.openConfig', openConfig),
		vscode.commands.registerCommand('quant-workbench.refresh', refreshViews),
		vscode.commands.registerCommand('quant-workbench.runBacktest', runBacktest),
		vscode.commands.registerCommand('quant-workbench.downloadData', (request?: DownloadRequest) => downloadData(request))
	);

	await refreshViews();

	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refreshViews));
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => {
		if (document.fileName.endsWith('quant.config.json') || document.fileName.endsWith('.py') || document.fileName.endsWith('.csv') || document.fileName.endsWith('.json')) {
			void refreshViews();
		}
	}));
}

async function openPage(context: vscode.ExtensionContext, route: QuantPageRoute, preserveFocus = false): Promise<void> {
	const snapshot = await scanQuantWorkspace();
	const downloadOptions = await buildDownloadOptions(snapshot.items);
	QuantWorkbenchPanel.show(context, route, snapshot, runHistory, downloadTasks, downloadOptions, preserveFocus);
}

async function openStrategyDetail(context: vscode.ExtensionContext, strategyOrId?: QuantItem | string): Promise<void> {
	const strategyId = typeof strategyOrId === 'string' ? strategyOrId : strategyOrId?.id;
	await openPage(context, { page: 'strategyDetail', strategyId });
}

async function refreshViews(): Promise<void> {
	const snapshot = await scanQuantWorkspace();
	const strategies = snapshot.items.filter(item => item.kind === 'strategy');
	const dataItems = snapshot.items.filter(item => item.kind === 'data');
	const backtestOutputs = snapshot.items.filter(item => item.kind === 'backtest');
	const summary = snapshot.items.find(item => item.kind === 'summary');

	overviewProvider.setItems([
		{
			id: 'overview',
			label: snapshot.name,
			description: summary?.description,
			tooltip: summary?.detail,
			kind: 'overview',
			icon: 'dashboard',
			command: 'quant-workbench.openOverview'
		},
		{
			id: 'open-strategies',
			label: vscode.l10n.t('\u7b56\u7565\u4e2d\u5fc3'),
			description: vscode.l10n.t('{0} \u4e2a\u7b56\u7565', strategies.length),
			kind: 'action',
			icon: 'symbol-function',
			command: 'quant-workbench.openStrategies'
		},
		{
			id: 'open-data',
			label: vscode.l10n.t('\u6570\u636e\u4e2d\u5fc3'),
			description: vscode.l10n.t('{0} \u4e2a\u6570\u636e\u96c6', dataItems.length),
			kind: 'action',
			icon: 'database',
			command: 'quant-workbench.openDataCenter'
		}]);

	strategyProvider.setItems(strategies.length > 0 ? strategies.map(strategy => ({
		id: strategy.id,
		label: strategy.label,
		description: [strategy.status, strategy.asset].filter(Boolean).join(' \xb7 ') || strategy.description,
		tooltip: strategy.detail,
		kind: 'strategy' as const,
		icon: 'symbol-function',
		command: 'quant-workbench.openStrategyDetail',
		args: [strategy.id]
	})) : [emptyItem('no-strategy', vscode.l10n.t('\u672a\u53d1\u73b0\u7b56\u7565'), vscode.l10n.t('\u8bf7\u6dfb\u52a0 quant.config.json \u6216 *_backtest.py'))]);

	dataProvider.setItems(dataItems.length > 0 ? dataItems.map(dataItem => ({
		id: dataItem.id,
		label: dataItem.label,
		description: dataItem.description,
		tooltip: dataItem.detail,
		kind: 'data' as const,
		icon: 'database',
		command: 'quant-workbench.openDataCenter'
	})) : [emptyItem('no-data', vscode.l10n.t('\u672a\u53d1\u73b0\u6570\u636e'), vscode.l10n.t('\u8bf7\u5c06 CSV \u653e\u5230 data \u76ee\u5f55'))]);

	recentRunsProvider.setItems(buildRecentRunItems(backtestOutputs));
}

async function runBacktest(strategyOrId?: QuantItem | string): Promise<void> {
	const snapshot = await scanQuantWorkspace();
	const strategies = snapshot.items.filter(item => item.kind === 'strategy');
	const strategyId = typeof strategyOrId === 'string' ? strategyOrId : strategyOrId?.id;
	const target = strategies.find(item => item.id === strategyId) ?? strategies[0];
	if (!target) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u672a\u627e\u5230\u53ef\u8fd0\u884c\u7684\u7b56\u7565\u3002'));
		return;
	}

	const command = target.metadata?.command;
	if (!command) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u7b56\u7565 {0} \u6ca1\u6709\u914d\u7f6e\u8fd0\u884c\u547d\u4ee4\u3002', target.label));
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u91cf\u5316\u9879\u76ee\u5de5\u4f5c\u533a\u3002'));
		return;
	}

	const startedAt = new Date();
	outputChannel.show(true);
	outputChannel.appendLine(`[${startedAt.toLocaleString()}] ${vscode.l10n.t('\u5f00\u59cb\u8fd0\u884c\u7b56\u7565\uff1a{0}', target.label)}`);
	outputChannel.appendLine(`$ ${command}`);

	const child = exec(command, { cwd: workspaceFolder.uri.fsPath, windowsHide: true });
	child.stdout?.on('data', chunk => outputChannel.append(String(chunk)));
	child.stderr?.on('data', chunk => outputChannel.append(String(chunk)));
	child.on('error', error => {
		outputChannel.appendLine(vscode.l10n.t('\u8fd0\u884c\u5931\u8d25\uff1a{0}', error.message));
		runHistory.unshift({
			id: `${Date.now()}`,
			label: target.label,
			status: vscode.l10n.t('\u5931\u8d25'),
			startedAt: startedAt.toLocaleString(),
			summary: error.message
		});
		void refreshViews();
	});
	child.on('exit', code => {
		const status = code === 0 ? vscode.l10n.t('\u6210\u529f') : vscode.l10n.t('\u5931\u8d25');
		outputChannel.appendLine('');
		outputChannel.appendLine(`[${new Date().toLocaleString()}] ${vscode.l10n.t('\u56de\u6d4b\u7ed3\u675f\uff1a{0}\uff0c\u9000\u51fa\u7801 {1}', status, String(code ?? 'unknown'))}`);
		runHistory.unshift({
			id: `${Date.now()}`,
			label: target.label,
			status,
			startedAt: startedAt.toLocaleString(),
			summary: vscode.l10n.t('\u9000\u51fa\u7801 {0}', String(code ?? 'unknown'))
		});
		if (runHistory.length > 20) {
			runHistory.length = 20;
		}
		void refreshViews();
	});
}

async function openConfig(): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u91cf\u5316\u9879\u76ee\u5de5\u4f5c\u533a\u3002'));
		return;
	}

	const configUri = vscode.Uri.joinPath(workspaceFolder.uri, 'quant.config.json');
	try {
		await vscode.workspace.fs.stat(configUri);
	} catch {
		const template = [
			'{',
			`\t"name": "${workspaceFolder.name}",`,
			'\t"dataDir": "data",',
			'\t"strategies": [],',
			'\t"outputs": {',
			'\t\t"equity": "equity_data.json",',
			'\t\t"drawdown": "drawdown_data.json"',
			'\t}',
			'}',
			''
		].join('\n');
		await vscode.workspace.fs.writeFile(configUri, Buffer.from(template, 'utf8'));
	}

	const document = await vscode.workspace.openTextDocument(configUri);
	await vscode.window.showTextDocument(document);
}

async function buildDownloadOptions(items: readonly QuantItem[]): Promise<DownloadFormOptions> {
	const toolAvailable = await hasDownloadTool();
	const dataItems = items.filter(item => item.kind === 'data');
	const symbols = uniqueStrings([
		...dataItems.map(item => item.metadata?.symbol).filter((value): value is string => Boolean(value && value.toUpperCase() !== 'UNKNOWN')),
		...downloadSymbols
	]);
	const intervals = uniqueStrings([
		...dataItems.map(item => item.metadata?.timeframe).filter((value): value is string => Boolean(value)),
		...downloadIntervals
	]);
	const dtypes = uniqueStrings([
		...dataItems.map(item => item.metadata?.dtype).filter((value): value is string => Boolean(value)),
		...downloadDtypes
	]);
	const exchanges = uniqueStrings([
		...dataItems.map(item => item.metadata?.exchange).filter((value): value is string => Boolean(value)),
		...downloadExchanges
	]).filter(value => value && value !== 'noexchange');
	const latestTask = downloadTasks.find(task => task.status === 'running') ?? downloadTasks[0];
	const defaults: DownloadRequest = latestTask
		? {
			channel: latestTask.channel,
			exchange: latestTask.exchange === 'noexchange' ? defaultDownloadRequest.exchange : latestTask.exchange,
			symbol: latestTask.symbol,
			market: latestTask.market,
			dtype: latestTask.dtype,
			interval: latestTask.interval,
			start: latestTask.start,
			end: latestTask.end
		}
		: {
			...defaultDownloadRequest,
			symbol: symbols[0] ?? defaultDownloadRequest.symbol,
			interval: intervals.includes(defaultDownloadRequest.interval) ? defaultDownloadRequest.interval : intervals[0] ?? defaultDownloadRequest.interval,
			dtype: dtypes.includes(defaultDownloadRequest.dtype) ? defaultDownloadRequest.dtype : dtypes[0] ?? defaultDownloadRequest.dtype,
			exchange: exchanges.includes(defaultDownloadRequest.exchange) ? defaultDownloadRequest.exchange : exchanges[0] ?? defaultDownloadRequest.exchange
		};

	return {
		toolAvailable,
		toolStatusLabel: toolAvailable ? vscode.l10n.t('Python \u4e0b\u8f7d\u5de5\u5177\u5df2\u63a5\u5165') : vscode.l10n.t('\u672a\u627e\u5230 .opencode/pythonlib/guigu_data'),
		commandPreview: buildDownloadCommand(normalizeDownloadRequest(defaults) ?? defaults).join(' '),
		defaults,
		channels: [
			{ value: 'auto', label: vscode.l10n.t('\u81ea\u52a8'), description: vscode.l10n.t('\u4f18\u5148\u771f\u5b9e\u6570\u636e\uff0c\u5fc5\u8981\u65f6\u56de\u9000') },
			{ value: 'real', label: vscode.l10n.t('\u771f\u5b9e\u6570\u636e'), description: vscode.l10n.t('\u8c03\u7528\u4ea4\u6613\u6240\u4e0b\u8f7d') },
			{ value: 'simulated', label: vscode.l10n.t('\u6a21\u62df\u6570\u636e'), description: vscode.l10n.t('\u4f7f\u7528 noexchange \u751f\u6210') }
		],
		exchanges: exchanges.map(value => ({ value, label: value })),
		markets: [
			{ value: 'spot', label: vscode.l10n.t('\u73b0\u8d27') },
			{ value: 'futures', label: vscode.l10n.t('\u5408\u7ea6') },
			{ value: 'options', label: vscode.l10n.t('\u671f\u6743') }
		],
		dtypes: dtypes.map(value => ({ value, label: value })),
		intervals: intervals.map(value => ({ value, label: value })),
		symbols: symbols.map(value => ({ value, label: value }))
	};
}

async function hasDownloadTool(): Promise<boolean> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return false;
	}
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(getDownloadToolPath(workspaceFolder)));
		return true;
	} catch {
		return false;
	}
}

function getDownloadToolPath(workspaceFolder: vscode.WorkspaceFolder): string {
	return join(workspaceFolder.uri.fsPath, '.opencode', 'pythonlib', 'guigu_data', 'cli.py');
}

function buildDownloadCommand(request: DownloadRequest): string[] {
	const exchange = request.channel === 'simulated' ? 'noexchange' : request.exchange;
	return [
		'-m',
		'guigu_data',
		'crypto',
		'get',
		request.symbol,
		request.start,
		request.end,
		'--interval',
		request.interval,
		'--exchange',
		exchange,
		'--dtype',
		request.dtype
	];
}

function uniqueStrings(values: readonly string[]): string[] {
	return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

function updateDownloadProgress(task: DownloadTaskRecord, text: string): void {
	const lines = text
		.replace(/\u001b\[[0-9;]*m/g, '')
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(Boolean);
	if (lines.length === 0) {
		return;
	}

	const latestLine = lines[lines.length - 1];
	task.message = latestLine.length > 240 ? `${latestLine.slice(0, 237)}...` : latestLine;
	for (const line of lines) {
		const percentMatch = /(\d{1,3})(?:\.\d+)?\s*%/.exec(line) ?? /\bprogress\b\D{0,16}(\d{1,3})(?:\.\d+)?/i.exec(line);
		if (percentMatch?.[1]) {
			const parsed = Number(percentMatch[1]);
			if (Number.isFinite(parsed)) {
				task.progress = Math.max(task.progress ?? 0, Math.min(95, parsed));
				return;
			}
		}
	}

	task.progress = Math.min(95, Math.max(task.progress ?? 8, 8) + 4);
}

async function downloadData(request?: DownloadRequest): Promise<void> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u8bf7\u5148\u6253\u5f00\u4e00\u4e2a\u91cf\u5316\u9879\u76ee\u5de5\u4f5c\u533a\u3002'));
		return;
	}
	if (!request) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u4e0b\u8f7d\u53c2\u6570\u7f3a\u5931\u3002'));
		return;
	}

	const pythonModule = getDownloadToolPath(workspaceFolder);
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(pythonModule));
	} catch {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u5f53\u524d\u9879\u76ee\u672a\u627e\u5230 guigu_data Python \u4e0b\u8f7d\u5de5\u5177\u3002'));
		return;
	}

	const normalized = normalizeDownloadRequest(request);
	if (!normalized) {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u4e0b\u8f7d\u53c2\u6570\u65e0\u6548\uff0c\u8bf7\u68c0\u67e5\u6807\u7684\u548c\u65e5\u671f\u3002'));
		return;
	}

	if (normalized.channel === 'real' && normalized.exchange !== 'binance') {
		await vscode.window.showWarningMessage(vscode.l10n.t('\u5f53\u524d\u771f\u5b9e\u4e0b\u8f7d\u901a\u9053\u53ea\u63a5\u5165\u4e86 binance\u3002\u8bf7\u9009\u62e9\u81ea\u52a8\u6216\u6a21\u62df\u6570\u636e\u3002'));
		return;
	}

	const args = buildDownloadCommand(normalized);
	const task: DownloadTaskRecord = {
		...normalized,
		id: `${Date.now()}`,
		status: 'running',
		startedAt: new Date().toLocaleString(),
		summary: vscode.l10n.t('\u7b49\u5f85\u4e0b\u8f7d\u5b8c\u6210'),
		message: vscode.l10n.t('\u542f\u52a8 Python \u4e0b\u8f7d\u547d\u4ee4'),
		progress: 8,
		command: `python ${args.join(' ')}`
	};
	downloadTasks.unshift(task);
	if (downloadTasks.length > 20) {
		downloadTasks.length = 20;
	}
	await refreshViews();

	outputChannel.show(true);
	outputChannel.appendLine(`[${new Date().toLocaleString()}] ${vscode.l10n.t('\u5f00\u59cb\u4e0b\u8f7d\u5e02\u573a\u6570\u636e')}`);
	outputChannel.appendLine(`$ ${task.command}`);

	const env = {
		...process.env,
		NO_COLOR: '1',
		PYTHONUNBUFFERED: '1',
		PYTHONUTF8: '1',
		PYTHONIOENCODING: 'utf-8',
		PYTHONPATH: [join(workspaceFolder.uri.fsPath, '.opencode', 'pythonlib'), process.env.PYTHONPATH].filter(Boolean).join(delimiter)
	};

	await new Promise<void>((resolve) => {
		const child = execFile('python', args, {
			cwd: workspaceFolder.uri.fsPath,
			env,
			windowsHide: true,
			timeout: 600000,
			maxBuffer: 50 * 1024 * 1024
		});

		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');

		const handleOutput = (chunk: string | Buffer): void => {
			const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			outputChannel.append(text);
			updateDownloadProgress(task, text);
			void refreshViews();
			if (extensionContextRef) {
				void openPage(extensionContextRef, { page: 'data' }, true);
			}
		};
		child.stdout?.on('data', handleOutput);
		child.stderr?.on('data', handleOutput);
		child.on('error', async error => {
			task.status = 'failed';
			task.finishedAt = new Date().toLocaleString();
			task.summary = error.message;
			task.message = error.message;
			task.progress = 100;
			outputChannel.appendLine(vscode.l10n.t('\u4e0b\u8f7d\u5931\u8d25: {0}', error.message));
			await vscode.window.showErrorMessage(vscode.l10n.t('\u6570\u636e\u4e0b\u8f7d\u5931\u8d25: {0}', error.message));
			await refreshViews();
			resolve();
		});
		child.on('exit', async code => {
			const success = code === 0;
			task.status = success ? 'success' : 'failed';
			task.finishedAt = new Date().toLocaleString();
			task.summary = success
				? vscode.l10n.t('\u4e0b\u8f7d\u5b8c\u6210: {0} {1} {2}', normalized.symbol, normalized.dtype, normalized.interval)
				: vscode.l10n.t('\u9000\u51fa\u7801 {0}', String(code ?? 'unknown'));
			task.message = task.summary;
			task.progress = 100;
			outputChannel.appendLine('');
			outputChannel.appendLine(`[${new Date().toLocaleString()}] ${success ? vscode.l10n.t('\u4e0b\u8f7d\u5b8c\u6210') : vscode.l10n.t('\u4e0b\u8f7d\u5931\u8d25')} (${String(code ?? 'unknown')})`);
			if (success) {
				await vscode.window.showInformationMessage(vscode.l10n.t('\u6570\u636e\u4e0b\u8f7d\u5b8c\u6210\u3002'));
			} else {
				await vscode.window.showWarningMessage(vscode.l10n.t('\u6570\u636e\u4e0b\u8f7d\u5931\u8d25\uff0c\u8be6\u89c1\u8f93\u51fa\u9762\u677f\u3002'));
			}
			await refreshViews();
			if (extensionContextRef) {
				await openPage(extensionContextRef, { page: 'data' }, true);
			}
			resolve();
		});
	});
}

function normalizeDownloadRequest(request: DownloadRequest): DownloadRequest | undefined {
	const symbol = request.symbol.trim();
	if (!symbol || !request.start || !request.end || request.start > request.end) {
		return undefined;
	}

	if (request.market === 'spot') {
		return {
			...request,
			symbol: symbol.split(':')[0]
		};
	}

	if (request.market === 'futures') {
		if (symbol.includes(':')) {
			return { ...request, symbol };
		}
		return { ...request, symbol: `${symbol}:USDT` };
	}

	return { ...request, symbol };
}

function buildRecentRunItems(backtestOutputs: QuantItem[]): NavItem[] {
	const items: NavItem[] = runHistory.map(record => ({
		id: record.id,
		label: record.label,
		description: `${record.status} \xb7 ${record.startedAt}`,
		tooltip: record.summary,
		kind: 'recentRun',
		icon: record.status === vscode.l10n.t('\u6210\u529f') ? 'pass' : 'warning',
		command: 'quant-workbench.openOverview'
	}));

	if (backtestOutputs.length > 0) {
		items.push({
			id: 'latest-output',
			label: vscode.l10n.t('\u6700\u65b0\u56de\u6d4b\u7ed3\u679c'),
			description: vscode.l10n.t('{0} \u4e2a\u8f93\u51fa\u6587\u4ef6', backtestOutputs.length),
			tooltip: vscode.l10n.t('\u7ed3\u679c\u6587\u4ef6\u4f1a\u5728\u7b56\u7565\u8be6\u60c5\u9875\u4e2d\u5c55\u793a\u3002'),
			kind: 'recentRun',
			icon: 'graph-line',
			command: 'quant-workbench.openOverview'
		});
	}

	return items.length > 0 ? items : [emptyItem('no-runs', vscode.l10n.t('\u6682\u65e0\u8fd0\u884c\u8bb0\u5f55'), vscode.l10n.t('\u8fd0\u884c\u7b56\u7565\u540e\u4f1a\u5728\u8fd9\u91cc\u663e\u793a\u6700\u8fd1\u56de\u6d4b'))];
}

function emptyItem(id: string, label: string, description: string): NavItem {
	return {
		id,
		label,
		description,
		kind: 'empty',
		icon: 'circle-slash'
	};
}

export function deactivate(): void {
}
