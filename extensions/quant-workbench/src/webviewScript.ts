/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function renderWebviewScript(strategyPayload: string, dataPayload: string, downloadOptionsPayload: string): string {
	return `
		const vscode = acquireVsCodeApi();
		const strategies = ${strategyPayload};
		const datasets = ${dataPayload};
		const downloadOptions = ${downloadOptionsPayload};

		function postAction(action, strategyId) {
			const messages = {
				openOverview: { type: 'openOverview' },
				openStrategies: { type: 'openStrategies' },
				openData: { type: 'openData' },
				openStrategy: { type: 'openStrategy', strategyId },
				runStrategy: { type: 'runStrategy', strategyId },
				openConfig: { type: 'openConfig' }
			};
			const message = messages[action];
			if (message) {
				vscode.postMessage(message);
			}
		}

		function readDownloadForm() {
			const channel = document.getElementById('download-channel');
			const exchange = document.getElementById('download-exchange');
			const symbol = document.getElementById('download-symbol');
			const dtype = document.getElementById('download-dtype');
			const interval = document.getElementById('download-interval');
			const start = document.getElementById('download-start');
			const end = document.getElementById('download-end');
			const activeMarket = document.querySelector('input[name="market-kind"]:checked');
			return {
				channel: channel ? channel.value : 'auto',
				exchange: exchange ? exchange.value : 'binance',
				symbol: symbol ? symbol.value.trim() : '',
				market: activeMarket ? activeMarket.value : 'spot',
				dtype: dtype ? dtype.value : 'ohlcv',
				interval: interval ? interval.value : '1h',
				start: start ? start.value : '',
				end: end ? end.value : ''
			};
		}

		function validateDownloadForm() {
			const submit = document.getElementById('download-submit');
			if (!submit) {
				return false;
			}
			const modal = document.getElementById('download-modal');
			const toolAvailable = !modal || modal.getAttribute('data-tool-available') !== 'false';
			const form = readDownloadForm();
			const valid = toolAvailable && Boolean(form.symbol) && Boolean(form.start) && Boolean(form.end) && form.start <= form.end;
			submit.classList.toggle('button--disabled', !valid);
			submit.disabled = !valid;
			return valid;
		}

		function submitDownload() {
			if (!validateDownloadForm()) {
				return;
			}
			const payload = readDownloadForm();
			vscode.postMessage({ type: 'downloadData', payload });
			closeModal('download-modal');
		}

		function activateFilter(group, value) {
			document.querySelectorAll('[data-filter-group="' + group + '"]').forEach(node => {
				node.classList.toggle('is-active', node.getAttribute('data-filter-value') === value);
			});
		}

		function applyStrategyFilters() {
			const board = document.getElementById('strategy-board');
			if (!board) {
				return;
			}
			const activeStatus = document.querySelector('[data-filter-group="strategy-status"].is-active');
			const activeAsset = document.querySelector('[data-filter-group="strategy-asset"].is-active');
			const activeSort = document.querySelector('[data-filter-group="strategy-sort"].is-active');
			const status = activeStatus ? activeStatus.getAttribute('data-filter-value') : 'all';
			const asset = activeAsset ? activeAsset.getAttribute('data-filter-value') : 'all';
			const sort = activeSort ? activeSort.getAttribute('data-filter-value') : 'updated';
			const rows = Array.from(board.querySelectorAll('.strategy-row-wrap'))
				.map(wrap => ({ wrap, card: wrap.querySelector('[data-role="strategy-card"]') }))
				.filter(entry => entry.card);

			rows.forEach(entry => {
				const cardStatus = entry.card.getAttribute('data-status');
				const cardAsset = entry.card.getAttribute('data-asset');
				const matchesStatus = status === 'all' || status === cardStatus;
				const matchesAsset = asset === 'all' || asset === cardAsset;
				entry.wrap.style.display = matchesStatus && matchesAsset ? '' : 'none';
			});

			const sorted = rows.slice().sort((left, right) => {
				if (sort === 'return') {
					return Number(right.card.getAttribute('data-return-pct') || '-Infinity') - Number(left.card.getAttribute('data-return-pct') || '-Infinity');
				}
				if (sort === 'sharpe') {
					return Number(right.card.getAttribute('data-sharpe-ratio') || '-Infinity') - Number(left.card.getAttribute('data-sharpe-ratio') || '-Infinity');
				}
				return Number(right.card.getAttribute('data-updated-at') || '0') - Number(left.card.getAttribute('data-updated-at') || '0');
			});

			sorted.forEach(entry => board.appendChild(entry.wrap));
		}

		function applyDataFilters() {
			const activeMarket = document.querySelector('[data-filter-group="data-market"].is-active');
			const activeTimeframe = document.querySelector('[data-filter-group="data-timeframe"].is-active');
			const market = activeMarket ? activeMarket.getAttribute('data-filter-value') : 'all';
			const timeframe = activeTimeframe ? activeTimeframe.getAttribute('data-filter-value') : 'all';

			document.querySelectorAll('[data-role="data-row"]').forEach(node => {
				const rowMarket = node.getAttribute('data-market');
				const rowTimeframe = node.getAttribute('data-timeframe');
				const matchesMarket = market === 'all' || market === rowMarket;
				const matchesTimeframe = timeframe === 'all' || timeframe === rowTimeframe;
				node.style.display = matchesMarket && matchesTimeframe ? '' : 'none';
			});

			document.querySelectorAll('[data-role="data-group"]').forEach(group => {
				const visibleRows = Array.from(group.querySelectorAll('[data-role="data-row"]')).filter(row => row.style.display !== 'none');
				group.style.display = visibleRows.length > 0 ? '' : 'none';
			});
		}

		function openModal(id) {
			const modal = document.getElementById(id);
			if (modal) {
				modal.classList.add('is-open');
				validateDownloadForm();
			}
		}

		function closeModal(id) {
			const modal = document.getElementById(id);
			if (modal) {
				modal.classList.remove('is-open');
			}
		}

		function toggleStrategyRow(id) {
			const detail = document.getElementById('detail-' + id);
			if (!detail) {
				return;
			}
			const wrap = detail.closest('.strategy-row-wrap');
			const icon = wrap ? wrap.querySelector('[data-toggle-strategy="' + id + '"]') : null;
			const isOpen = detail.classList.contains('is-open');

			if (isOpen) {
				detail.classList.remove('is-open');
				detail.style.maxHeight = '0';
				setTimeout(() => {
					if (!detail.classList.contains('is-open')) {
						detail.style.display = 'none';
					}
				}, 280);
				if (icon) {
					icon.textContent = '\\u25b8';
					icon.classList.remove('is-open');
				}
			} else {
				detail.style.display = 'block';
				detail.classList.add('is-open');
				requestAnimationFrame(() => {
					detail.style.maxHeight = detail.scrollHeight + 'px';
				});
				if (icon) {
					icon.textContent = '\\u25be';
					icon.classList.add('is-open');
				}
			}
		}

		function toggleGroup(id, trigger) {
			const body = document.getElementById('group-' + id);
			if (!body) {
				return;
			}
			const isOpen = body.classList.contains('is-open');
			const icon = trigger.querySelector('.data-group-row__icon');

			if (isOpen) {
				body.classList.remove('is-open');
				body.style.maxHeight = '0';
				trigger.setAttribute('aria-expanded', 'false');
				if (icon) {
					icon.textContent = '\\u25b8';
					icon.classList.remove('is-open');
				}
			} else {
				body.classList.add('is-open');
				body.style.maxHeight = body.scrollHeight + 'px';
				trigger.setAttribute('aria-expanded', 'true');
				if (icon) {
					icon.textContent = '\\u25be';
					icon.classList.add('is-open');
				}
			}
		}

		document.addEventListener('click', event => {
			const target = event.target.closest('[data-action], [data-filter-group], [data-open-modal], [data-close-modal], [data-toggle-group], [data-submit-download], [data-toggle-strategy]');
			if (!target) {
				return;
			}

			const toggleStrategyId = target.getAttribute('data-toggle-strategy');
			if (toggleStrategyId) {
				toggleStrategyRow(toggleStrategyId);
				return;
			}

			const openModalId = target.getAttribute('data-open-modal');
			if (openModalId) {
				openModal(openModalId);
				return;
			}

			const closeModalId = target.getAttribute('data-close-modal');
			if (closeModalId) {
				closeModal(closeModalId);
				return;
			}

			const toggleGroupId = target.getAttribute('data-toggle-group');
			if (toggleGroupId) {
				toggleGroup(toggleGroupId, target);
				return;
			}

			if (target.getAttribute('data-submit-download')) {
				submitDownload();
				return;
			}

			const filterGroup = target.getAttribute('data-filter-group');
			if (filterGroup) {
				activateFilter(filterGroup, target.getAttribute('data-filter-value'));
				if (filterGroup.indexOf('strategy-') === 0) {
					applyStrategyFilters();
				} else if (filterGroup.indexOf('data-') === 0) {
					applyDataFilters();
				}
				return;
			}

			const action = target.getAttribute('data-action');
			if (action) {
				postAction(action, target.getAttribute('data-strategy-id') || undefined);
			}
		});

		document.querySelectorAll('#download-modal input, #download-modal select').forEach(node => {
			node.addEventListener('input', validateDownloadForm);
			node.addEventListener('change', validateDownloadForm);
		});

		applyStrategyFilters();
		applyDataFilters();
		validateDownloadForm();
	`;
}
