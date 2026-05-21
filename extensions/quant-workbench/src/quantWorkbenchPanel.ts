/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { DownloadFormOptions, DownloadTaskRecord, PanelMessage, QuantPageRoute, QuantSnapshot, RunRecord } from './panelTypes';
import { routeKey, titleForRoute } from './panelUtils';
import { renderQuantWorkbenchPage } from './panelPages';

export type { QuantPageRoute } from './panelTypes';

export class QuantWorkbenchPanel {
	private static readonly viewType = 'quant-workbench.page';
	private static readonly panels = new Map<string, QuantWorkbenchPanel>();

	static show(context: vscode.ExtensionContext, route: QuantPageRoute, snapshot: QuantSnapshot, runHistory: readonly RunRecord[], downloadTasks: readonly DownloadTaskRecord[], downloadOptions: DownloadFormOptions): void {
		const key = routeKey(route);
		const existing = QuantWorkbenchPanel.panels.get(key);
		if (existing) {
			existing.update(route, snapshot, runHistory, downloadTasks, downloadOptions);
			existing.panel.reveal(vscode.ViewColumn.Active, false);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			QuantWorkbenchPanel.viewType,
			titleForRoute(route, snapshot),
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		const page = new QuantWorkbenchPanel(panel, route, snapshot, runHistory, downloadTasks, downloadOptions);
		QuantWorkbenchPanel.panels.set(key, page);
		context.subscriptions.push(panel.onDidDispose(() => {
			QuantWorkbenchPanel.panels.delete(key);
		}));
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private route: QuantPageRoute,
		private snapshot: QuantSnapshot,
		private runHistory: readonly RunRecord[],
		private downloadTasks: readonly DownloadTaskRecord[],
		private downloadOptions: DownloadFormOptions
	) {
		this.panel.webview.onDidReceiveMessage(message => {
			this.handleMessage(message as PanelMessage);
		});
		this.render();
	}

	private update(route: QuantPageRoute, snapshot: QuantSnapshot, runHistory: readonly RunRecord[], downloadTasks: readonly DownloadTaskRecord[], downloadOptions: DownloadFormOptions): void {
		this.route = route;
		this.snapshot = snapshot;
		this.runHistory = runHistory;
		this.downloadTasks = downloadTasks;
		this.downloadOptions = downloadOptions;
		this.panel.title = titleForRoute(route, snapshot);
		this.render();
	}

	private handleMessage(message: PanelMessage): void {
		switch (message.type) {
			case 'openOverview':
				void vscode.commands.executeCommand('quant-workbench.openOverview');
				return;
			case 'openStrategies':
				void vscode.commands.executeCommand('quant-workbench.openStrategies');
				return;
			case 'openData':
				void vscode.commands.executeCommand('quant-workbench.openDataCenter');
				return;
			case 'openStrategy':
				void vscode.commands.executeCommand('quant-workbench.openStrategyDetail', message.strategyId);
				return;
			case 'runStrategy':
				void vscode.commands.executeCommand('quant-workbench.runBacktest', message.strategyId);
				return;
			case 'openConfig':
				void vscode.commands.executeCommand('quant-workbench.openConfig');
				return;
			case 'downloadData':
				void vscode.commands.executeCommand('quant-workbench.downloadData', message.payload);
				return;
		}
	}

	private render(): void {
		this.panel.webview.html = renderQuantWorkbenchPage(this.route, this.snapshot, this.runHistory, this.downloadTasks, this.downloadOptions);
	}
}
