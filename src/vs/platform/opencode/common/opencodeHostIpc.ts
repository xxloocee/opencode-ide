/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IOpenCodeHostLaunch, IOpenCodeHostMainService, IOpenCodeHostState } from './opencodeHost.js';

export class OpenCodeHostChannel implements IServerChannel<string> {

	constructor(private readonly service: IOpenCodeHostMainService) { }

	listen<T>(_ctx: string, event: string, windowId?: number): Event<T> {
		if (event === 'onDidChangeState') {
			return this.service.onDidChangeState(asWindowId(windowId)) as Event<T>;
		}

		throw new Error(`Event not found: ${event}`);
	}

	call<T>(_ctx: string, command: string, args?: [number, IOpenCodeHostLaunch?]): Promise<T> {
		const windowId = asWindowId(args?.[0]);
		switch (command) {
			case 'getState':
				return this.service.getState(windowId) as Promise<T>;
			case 'start':
				return this.service.start(windowId, args?.[1]!) as Promise<T>;
			case 'stop':
				return this.service.stop(windowId) as Promise<T>;
		}

		throw new Error(`Method not found: ${command}`);
	}
}

export interface IOpenCodeHostWindowClient {
	readonly onDidChangeState: Event<IOpenCodeHostState>;

	getState(): Promise<IOpenCodeHostState>;
	start(input: IOpenCodeHostLaunch): Promise<IOpenCodeHostState>;
	stop(): Promise<void>;
}

export class OpenCodeHostChannelClient implements IOpenCodeHostWindowClient {

	readonly onDidChangeState: Event<IOpenCodeHostState>;

	constructor(
		private readonly channel: IChannel,
		private readonly windowId: number,
	) {
		this.onDidChangeState = this.channel.listen<IOpenCodeHostState>('onDidChangeState', this.windowId);
	}

	getState(): Promise<IOpenCodeHostState> {
		return this.channel.call('getState', [this.windowId]);
	}

	start(input: IOpenCodeHostLaunch): Promise<IOpenCodeHostState> {
		return this.channel.call('start', [this.windowId, input]);
	}

	stop(): Promise<void> {
		return this.channel.call('stop', [this.windowId]);
	}
}

function asWindowId(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}
