/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { killTree } from '../../../base/node/processes.js';
import { ILogService } from '../../log/common/log.js';
import { IOpenCodeHostMainService, type IOpenCodeHostLaunch, type IOpenCodeHostState, OpenCodeHostPhase } from '../common/opencodeHost.js';

export class OpenCodeHostMainService extends Disposable implements IOpenCodeHostMainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<IOpenCodeHostState>());
	readonly onDidChangeState: Event<IOpenCodeHostState> = this._onDidChangeState.event;

	private state: IOpenCodeHostState = { phase: OpenCodeHostPhase.Stopped };
	private proc: cp.ChildProcess | undefined;
	private own = false;
	private stopping = false;

	constructor(
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getState(): Promise<IOpenCodeHostState> {
		return this.state;
	}

	async start(input: IOpenCodeHostLaunch): Promise<IOpenCodeHostState> {
		if (this.state.phase === OpenCodeHostPhase.Running || this.state.phase === OpenCodeHostPhase.Starting) {
			return this.state;
		}

		if (await probe(input.url)) {
			this.own = false;
			this.setState({
				phase: OpenCodeHostPhase.Running,
				url: input.url,
				message: `Connected to OpenCode runtime at ${input.url}.`
			});
			return this.state;
		}

		if (!input.command) {
			this.setState({
				phase: OpenCodeHostPhase.Error,
				url: input.url,
				message: `OpenCode runtime is unavailable at ${input.url}. Configure sessions.openCode.command or start the server manually.`
			});
			return this.state;
		}

		this.stopping = false;
		this.setState({
			phase: OpenCodeHostPhase.Starting,
			url: input.url,
			message: 'Starting OpenCode runtime...'
		});

		this.logService.info(`[OpenCodeHost] Starting command: ${input.command}${input.cwd ? ` (cwd: ${input.cwd})` : ''}`);
		const proc = cp.spawn(input.command, {
			cwd: input.cwd,
			env: {
				...process.env,
				...(input.uiPackage ? { OPENCODE_UI_PACKAGE: input.uiPackage } : {}),
			},
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.proc = proc;
		this.own = true;

		proc.stdout?.on('data', data => {
			const text = data.toString().trim();
			if (text) {
				this.logService.info(`[OpenCodeHost] ${text}`);
			}
		});

		proc.stderr?.on('data', data => {
			const text = data.toString().trim();
			if (text) {
				this.logService.warn(`[OpenCodeHost] ${text}`);
			}
		});

		proc.once('exit', (code, signal) => {
			this.proc = undefined;
			if (this.stopping) {
				this.own = false;
				return;
			}
			if (this.state.phase === OpenCodeHostPhase.Starting) {
				this.logService.warn(`[OpenCodeHost] Launcher process exited while waiting for runtime (${code ?? signal ?? 'unknown'}).`);
				return;
			}
			this.own = false;
			this.setState({
				phase: OpenCodeHostPhase.Error,
				url: input.url,
				message: `OpenCode runtime exited unexpectedly (${code ?? signal ?? 'unknown'}).`
			});
		});

		const ok = await waitForHealthy(input.url, 20_000);
		if (!ok) {
			this.logService.error('[OpenCodeHost] Timed out waiting for runtime health check');
			await this.stop();
			this.setState({
				phase: OpenCodeHostPhase.Error,
				url: input.url,
				message: `OpenCode runtime did not become healthy at ${input.url}.`
			});
			return this.state;
		}

		this.setState({
			phase: OpenCodeHostPhase.Running,
			url: input.url,
			message: `OpenCode runtime is running at ${input.url}.`
		});
		return this.state;
	}

	async stop(): Promise<void> {
		await this.shutdown();
	}

	private async shutdown(): Promise<void> {
		this.stopping = true;
		const proc = this.proc;
		this.proc = undefined;
		if (proc && this.own) {
			await kill(proc.pid, this.logService);
		}
		this.own = false;
		this.setState({ phase: OpenCodeHostPhase.Stopped });
	}

	private setState(state: IOpenCodeHostState): void {
		this.state = state;
		this._onDidChangeState.fire(state);
	}
}

async function waitForHealthy(url: string, timeout: number): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await probe(url)) {
			return true;
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	return false;
}

async function probe(url: string): Promise<boolean> {
	const endpoint = new URL('/global/health', url);
	const mod = endpoint.protocol === 'https:' ? await import('https') : await import('http');

	return new Promise(resolve => {
		const req = mod.request(endpoint, { method: 'GET' }, res => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on('error', () => resolve(false));
		req.setTimeout(1500, () => {
			req.destroy();
			resolve(false);
		});
		req.end();
	});
}

async function kill(pid: number | undefined, logService: ILogService) {
	if (!pid) {
		return;
	}

	try {
		await killTree(pid, true);
	} catch (err) {
		logService.warn('[OpenCodeHost] Failed to kill process tree', err);
	}
}
