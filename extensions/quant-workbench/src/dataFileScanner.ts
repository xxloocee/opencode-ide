/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isRealDataSource, parseDataFileIdentity } from './dataFileIdentity';
import { QuantFact, QuantItem } from './models';
import { basename, buildCsvPreview, formatBytes, readText, splitLines } from './scannerUtils';

const csvPattern = '**/data/*.csv';
const parquetPattern = '**/data/**/*.parquet';
const ignorePattern = '**/node_modules/**';

export async function scanDataFiles(folder: vscode.Uri): Promise<QuantItem[]> {
	const patterns = [new vscode.RelativePattern(folder, csvPattern), new vscode.RelativePattern(folder, parquetPattern)];
	const resultSets = await Promise.all(patterns.map(pattern => vscode.workspace.findFiles(pattern, ignorePattern)));
	const files = [...new Map(resultSets.flat().map(uri => [uri.toString(), uri])).values()];
	const items: QuantItem[] = [];
	for (const uri of files) {
		const text = await readText(uri);
		const stats = await vscode.workspace.fs.stat(uri);
		const preview = text ? buildCsvPreview(text) : undefined;
		const facts = buildCsvFacts(uri, stats.size, preview);
		const metadata = buildDataMetadata(folder, uri, text);
		if (metadata.storage !== 'primary') {
			continue;
		}
		items.push({
			kind: 'data',
			id: uri.toString(),
			label: basename(uri),
			description: vscode.l10n.t('Data file'),
			summary: vscode.l10n.t('Data file discovered from workspace data directories.'),
			detail: uri.fsPath,
			uri,
			facts,
			preview,
			metadata,
			parsedTimeframe: metadata.timeframe,
			parsedSource: (metadata.source === 'real' ? 'real' : 'simulated') as 'real' | 'simulated'
		});
	}
	return items;
}

function buildCsvFacts(uri: vscode.Uri, size: number, preview: string | undefined): QuantFact[] {
	const facts: QuantFact[] = [
		{ label: vscode.l10n.t('Size'), value: formatBytes(size) },
		{ label: vscode.l10n.t('Path'), value: uri.fsPath }
	];

	if (preview) {
		const header = splitLines(preview)[0];
		if (header) {
			facts.push({ label: vscode.l10n.t('Columns'), value: header });
		}
	}

	return facts;
}

function buildDataMetadata(folder: vscode.Uri, uri: vscode.Uri, text: string | undefined): Record<string, string> {
	const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
	const lower = relative.toLowerCase();
	const extension = lower.endsWith('.parquet') ? 'parquet' : lower.endsWith('.csv') ? 'csv' : 'unknown';
	const filename = basename(uri);
	const identity = parseDataFileIdentity(filename, relative, text);
	const isPartial = lower.includes('.partial.');
	const storage = isPartial ? 'partial' : lower.includes('/raw/') ? 'cache' : 'primary';
	const source = isRealDataSource(relative, text) ? 'real' : 'simulated';

	return {
		relativePath: relative,
		extension,
		storage,
		source,
		partial: isPartial ? 'true' : 'false',
		workspaceRoot: folder.fsPath,
		symbol: identity.symbol,
		market: identity.market,
		dtype: identity.dtype,
		timeframe: identity.timeframe,
		dateStart: identity.dateStart,
		dateEnd: identity.dateEnd,
		exchange: identity.exchange
	};
}
