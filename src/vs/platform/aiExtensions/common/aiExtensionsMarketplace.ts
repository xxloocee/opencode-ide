/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IHeaders } from '../../../base/parts/request/common/request.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const AI_EXTENSIONS_MARKETPLACE_CHANNEL = 'aiExtensionsMarketplace';

export interface IAIExtensionsMarketplaceFetchRequest {
	readonly url: string;
	readonly callSite?: string;
}

export interface IAIExtensionsMarketplaceFetchResponse {
	readonly statusCode: number;
	readonly headers?: IHeaders;
	readonly body: string;
}

export interface IAIExtensionsMarketplaceService {
	readonly _serviceBrand: undefined;

	fetch(request: IAIExtensionsMarketplaceFetchRequest, token: CancellationToken): Promise<IAIExtensionsMarketplaceFetchResponse>;
}

export const IAIExtensionsMarketplaceService = createDecorator<IAIExtensionsMarketplaceService>('aiExtensionsMarketplaceService');
