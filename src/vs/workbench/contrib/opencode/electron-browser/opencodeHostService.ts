/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	IOpenCodeHostMainService,
	IOpenCodeHostService,
	type IOpenCodeHostLaunch,
	type IOpenCodeHostState,
	OpenCodeDefaultUrl,
	OpenCodeHostPhase,
	OPENCODE_HOST_CHANNEL,
	SessionsOpenCodeCommandSettingId,
	SessionsOpenCodeCwdSettingId,
	SessionsOpenCodeUiPackageSettingId,
	SessionsOpenCodeUrlSettingId,
} from '../../../../platform/opencode/common/opencodeHost.js';

export class OpenCodeHostService extends Disposable implements IOpenCodeHostService {
	declare readonly _serviceBrand: undefined;

	private readonly mainService: IOpenCodeHostMainService;
	private readonly _onDidChangeState = this._register(new Emitter<IOpenCodeHostState>());
	readonly onDidChangeState = this._onDidChangeState.event;

	private _state: IOpenCodeHostState = { phase: OpenCodeHostPhase.Stopped };
	get state(): IOpenCodeHostState { return this._state; }

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		this.mainService = ProxyChannel.toService<IOpenCodeHostMainService>(
			sharedProcessService.getChannel(OPENCODE_HOST_CHANNEL),
		);

		this._register(this.mainService.onDidChangeState(state => {
			this.setState(state);
		}));

		void this.mainService.getState().then(
			state => this.setState(state),
			err => this.logService.warn('[OpenCodeHost] Failed to restore shared-process state', err),
		);
	}

	async start(): Promise<IOpenCodeHostState> {
		if (this._state.phase === OpenCodeHostPhase.Running || this._state.phase === OpenCodeHostPhase.Starting) {
			return this._state;
		}

		const input = this.read();
		if (!input.command) {
			const ok = await probe(input.url);
			const state = ok
				? {
					phase: OpenCodeHostPhase.Running,
					url: input.url,
					message: `Connected to OpenCode runtime at ${input.url}.`
				}
				: {
					phase: OpenCodeHostPhase.Error,
					url: input.url,
					message: `OpenCode runtime is unavailable at ${input.url}. Configure ${SessionsOpenCodeCommandSettingId} or start the server manually.`
				};
			this.setState(state);
			return state;
		}

		this.setState({
			phase: OpenCodeHostPhase.Starting,
			url: input.url,
			message: 'Starting OpenCode runtime...'
		});
		return this.mainService.start(input);
	}

	async stop(): Promise<void> {
		await this.mainService.stop();
		this.setState({ phase: OpenCodeHostPhase.Stopped });
	}

	private read(): IOpenCodeHostLaunch {
		const url = this.configurationService.getValue<string>(SessionsOpenCodeUrlSettingId)?.trim() || OpenCodeDefaultUrl;
		const command = this.configurationService.getValue<string>(SessionsOpenCodeCommandSettingId)?.trim() || undefined;
		const cwd = this.configurationService.getValue<string>(SessionsOpenCodeCwdSettingId)?.trim() || undefined;
		const uiPackage = this.configurationService.getValue<string>(SessionsOpenCodeUiPackageSettingId)?.trim() || undefined;
		return { url, command, cwd, uiPackage };
	}

	private setState(state: IOpenCodeHostState): void {
		this._state = state;
		this._onDidChangeState.fire(state);
	}
}

registerSingleton(IOpenCodeHostService, OpenCodeHostService, InstantiationType.Delayed);

async function probe(url: string): Promise<boolean> {
	const ctl = new AbortController();
	const timer = setTimeout(() => ctl.abort(), 1500);
	try {
		const endpoint = new URL('/global/health', url);
		const res = await fetch(endpoint, {
			method: 'GET',
			signal: ctl.signal,
		});
		return res.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}
