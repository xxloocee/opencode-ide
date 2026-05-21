/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DataFileIdentity {
	readonly symbol: string;
	readonly market: 'spot' | 'futures' | 'options';
	readonly dtype: string;
	readonly timeframe: string;
	readonly dateStart: string;
	readonly dateEnd: string;
	readonly exchange: string;
}

export function parseDataFileIdentity(filename: string, relativePath: string, text: string | undefined): DataFileIdentity {
	const identity = parseGuiguDataFilename(filename)
		?? parseStructuredFilename(filename)
		?? parseSimplifiedFilename(filename)
		?? parseSymbolOnlyFilename(filename)
		?? parseFallbackIdentity(relativePath, text);
	return applyContentHints(identity, text);
}

function parseGuiguDataFilename(filename: string): DataFileIdentity | undefined {
	const m = /^([a-z]+)-([A-Za-z]+)-?([A-Za-z]+)-([a-z0-9_]+)-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})(?:\.partial)?\.\w+$/.exec(filename);
	if (!m) {
		return undefined;
	}

	const exchange = m[1];
	const p1 = m[2].toUpperCase();
	const p2 = m[3].toUpperCase();
	const symbol = p1 === 'USDT' || p1 === 'USD' || p1 === 'BUSD' ? `${p2}/${p1}` : `${p1}/${p2}`;
	const dtype = normalizeDtype(m[4]);
	const timeframe = normalizeInterval(m[5]);
	const market = inferMarketFromContent(filename, undefined);

	return { symbol, market, dtype, timeframe, dateStart: m[6], dateEnd: m[7], exchange };
}

function parseStructuredFilename(filename: string): DataFileIdentity | undefined {
	const base = filename.replace(/\.(csv|parquet|json)$/i, '');
	const parts = base.split('_');
	if (parts.length < 5) {
		return undefined;
	}

	const p0 = parts[0].toUpperCase();
	const p1 = parts[1].toUpperCase();
	const marketCandidate = parts[1].toLowerCase();

	if (!['spot', 'futures', 'options', 'perp'].includes(marketCandidate)) {
		return undefined;
	}

	const dtype = normalizeDtype(parts[2]);
	const timeframe = normalizeInterval(parts[3]);
	const dateStart = parts[4];
	const dateEnd = parts[5] ?? '';
	const symbol = `${p0}/${p1}`;
	const market = marketCandidate === 'perp' ? 'futures' : (marketCandidate as 'spot' | 'futures' | 'options');

	return { symbol, market, dtype, timeframe, dateStart, dateEnd, exchange: '' };
}

function parseSimplifiedFilename(filename: string): DataFileIdentity | undefined {
	const base = filename.replace(/\.(csv|parquet|json)$/i, '');
	const parts = base.split('_');
	if (parts.length < 3) {
		return undefined;
	}

	const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
	const timeframe = normalizeInterval(parts[parts.length - 1]);
	if (!timeframes.includes(timeframe)) {
		return undefined;
	}

	const body = parts.slice(0, -1);
	if (body.length === 2 && isQuoteAsset(body[1]) && !isDtypeToken(body[1])) {
		return {
			symbol: `${body[0].toUpperCase()}/${body[1].toUpperCase()}`,
			market: 'spot',
			dtype: 'ohlcv',
			timeframe,
			dateStart: '',
			dateEnd: '',
			exchange: ''
		};
	}

	const dtypeIdx = parts.length - 2;
	const dtype = normalizeDtype(parts[dtypeIdx]);
	const symbolParts = parts.slice(0, dtypeIdx);
	const symbol = symbolParts.length >= 2
		? `${symbolParts[0].toUpperCase()}/${symbolParts[1].toUpperCase()}`
		: `${symbolParts[0].toUpperCase()}/USDT`;

	return { symbol, market: 'spot', dtype, timeframe, dateStart: '', dateEnd: '', exchange: '' };
}

function parseSymbolOnlyFilename(filename: string): DataFileIdentity | undefined {
	const base = filename.replace(/\.(csv|parquet|json)$/i, '');
	const parts = base.split('_');
	if (parts.length < 1 || parts.length > 2) {
		return undefined;
	}

	const p0 = parts[0].toUpperCase();
	const p1 = parts.length === 2 ? parts[1].toUpperCase() : 'USDT';
	const symbol = `${p0}/${p1}`;

	return { symbol, market: 'spot', dtype: 'ohlcv', timeframe: '1d', dateStart: '', dateEnd: '', exchange: '' };
}

function parseFallbackIdentity(relativePath: string, text: string | undefined): DataFileIdentity {
	const market = inferMarketFromContent(text, relativePath);
	const timeframe = inferTimeframeFromContent(text);
	return { symbol: 'UNKNOWN', market, dtype: 'unknown', timeframe, dateStart: '', dateEnd: '', exchange: '' };
}

function applyContentHints(identity: DataFileIdentity, text: string | undefined): DataFileIdentity {
	if (!text) {
		return identity;
	}

	const header = text.split(/\r?\n/, 1)[0]?.toLowerCase();
	if (!header) {
		return identity;
	}

	const columns = header.split(',').map(column => column.trim());
	if (columns.includes('open') && columns.includes('high') && columns.includes('low') && columns.includes('close')) {
		return { ...identity, dtype: 'ohlcv' };
	}
	if (columns.includes('date') && columns.includes('close') && columns.length <= 3) {
		return { ...identity, dtype: 'close' };
	}

	return identity;
}

function inferTimeframeFromContent(text: string | undefined): string {
	if (!text) {
		return 'unknown';
	}
	const lower = text.toLowerCase();
	const candidates = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
	for (const c of candidates) {
		if (lower.includes(`"${c}"`) || lower.includes(`'${c}'`) || lower.includes(`>${c}<`)) {
			return c;
		}
	}
	if (lower.includes('daily')) {
		return '1d';
	}
	return 'unknown';
}

function inferMarketFromContent(text: string | undefined, filenameHint: string | undefined): 'spot' | 'futures' | 'options' {
	const corpus = `${text ?? ''} ${filenameHint ?? ''}`.toLowerCase();
	if (corpus.includes('option')) {
		return 'options';
	}
	if (corpus.includes('future') || corpus.includes('perp') || corpus.includes('swap') || corpus.includes('contract') || corpus.includes(':usdt')) {
		return 'futures';
	}
	return 'spot';
}

function normalizeDtype(dtype: string): string {
	const lower = dtype.toLowerCase();
	const mapping: Record<string, string> = {
		ohlcv: 'ohlcv', kline: 'ohlcv', candle: 'ohlcv', candles: 'ohlcv',
		trades: 'trades', trade: 'trades',
		funding_rate: 'funding_rate', funding: 'funding_rate',
		open_interest: 'open_interest', oi: 'open_interest',
		book_l1: 'book_l1', l1: 'book_l1',
		book_l2: 'book_l2', l2: 'book_l2',
		liquidations: 'liquidations', liq: 'liquidations'
	};
	return mapping[lower] ?? lower;
}

function isDtypeToken(value: string): boolean {
	return normalizeDtype(value) !== value.toLowerCase() || ['ohlcv', 'trades', 'funding_rate', 'open_interest', 'book_l1', 'book_l2', 'liquidations'].includes(value.toLowerCase());
}

function isQuoteAsset(value: string): boolean {
	return ['USDT', 'USD', 'BUSD', 'USDC', 'BTC', 'ETH'].includes(value.toUpperCase());
}

function normalizeInterval(interval: string): string {
	const lower = interval.toLowerCase();
	const mapping: Record<string, string> = {
		'1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
		'1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
		daily: '1d'
	};
	return mapping[lower] ?? lower;
}

export function isRealDataSource(relativePath: string, text: string | undefined): boolean {
	const lower = relativePath.toLowerCase();
	if (lower.includes('.sim.') || lower.includes('noexchange-') || lower.includes('simulated')) {
		return false;
	}
	if (text) {
		const contentLower = text.slice(0, 512).toLowerCase();
		if (contentLower.includes('simulated') || contentLower.includes('mock') || contentLower.includes('dummy')) {
			return false;
		}
	}
	return true;
}
