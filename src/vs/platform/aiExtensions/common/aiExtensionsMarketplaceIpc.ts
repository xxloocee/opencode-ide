/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IAIExtensionsMarketplaceFetchRequest, IAIExtensionsMarketplaceFetchResponse, IAIExtensionsMarketplaceService } from './aiExtensionsMarketplace.js';

export class AIExtensionsMarketplaceChannel implements IServerChannel<string> {

	constructor(private readonly service: IAIExtensionsMarketplaceService) { }

	listen<T>(_ctx: string, event: string): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call<T>(_ctx: string, command: string, request?: IAIExtensionsMarketplaceFetchRequest, token: CancellationToken = CancellationToken.None): Promise<T> {
		switch (command) {
			case 'fetch':
				if (!isFetchRequest(request)) {
					throw new Error('Invalid AI Extensions marketplace fetch request.');
				}
				return this.service.fetch(request, token) as Promise<T>;
		}

		throw new Error(`Method not found: ${command}`);
	}
}

export class AIExtensionsMarketplaceChannelClient implements IAIExtensionsMarketplaceService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly channel: IChannel) { }

	fetch(request: IAIExtensionsMarketplaceFetchRequest, token: CancellationToken): Promise<IAIExtensionsMarketplaceFetchResponse> {
		return this.channel.call('fetch', request, token);
	}
}

function isFetchRequest(value: unknown): value is IAIExtensionsMarketplaceFetchRequest {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const request = value as Partial<IAIExtensionsMarketplaceFetchRequest>;
	return typeof request.url === 'string'
		&& request.url.length > 0
		&& (request.callSite === undefined || typeof request.callSite === 'string');
}
