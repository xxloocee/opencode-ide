/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QuantPageRoute, QuantSnapshot } from './panelTypes';

export function routeKey(route: QuantPageRoute): string {
	return [route.page, route.strategyId ?? '', route.dataId ?? ''].join(':');
}

export function titleForRoute(route: QuantPageRoute, snapshot: QuantSnapshot): string {
	if (route.page === 'overview') {
		return vscode.l10n.t('\u91cf\u5316\u9996\u9875\u603b\u89c8');
	}
	if (route.page === 'strategies') {
		return vscode.l10n.t('\u7b56\u7565\u770b\u677f');
	}
	if (route.page === 'data') {
		return vscode.l10n.t('\u6570\u636e\u7ba1\u7406');
	}
	const strategy = snapshot.items.find(item => item.kind === 'strategy' && item.id === route.strategyId);
	return strategy ? vscode.l10n.t('\u7b56\u7565\u8be6\u60c5: {0}', strategy.label) : vscode.l10n.t('\u7b56\u7565\u8be6\u60c5');
}

export function serializeForScript(value: unknown): string {
	return JSON.stringify(value).replace(/<\//g, '<\\/');
}

export function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
