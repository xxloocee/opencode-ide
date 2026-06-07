/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { ISharedProcessService } from '../../ipc/electron-browser/services.js';
import { AI_EXTENSIONS_MARKETPLACE_CHANNEL, IAIExtensionsMarketplaceFetchRequest, IAIExtensionsMarketplaceFetchResponse, IAIExtensionsMarketplaceService } from '../common/aiExtensionsMarketplace.js';
import { AIExtensionsMarketplaceChannelClient } from '../common/aiExtensionsMarketplaceIpc.js';

export class AIExtensionsMarketplaceService extends Disposable implements IAIExtensionsMarketplaceService {
	declare readonly _serviceBrand: undefined;

	private readonly client: AIExtensionsMarketplaceChannelClient;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		super();
		this.client = new AIExtensionsMarketplaceChannelClient(sharedProcessService.getChannel(AI_EXTENSIONS_MARKETPLACE_CHANNEL));
	}

	fetch(request: IAIExtensionsMarketplaceFetchRequest, token: CancellationToken): Promise<IAIExtensionsMarketplaceFetchResponse> {
		return this.client.fetch(request, token);
	}
}

registerSingleton(IAIExtensionsMarketplaceService, AIExtensionsMarketplaceService, InstantiationType.Delayed);
