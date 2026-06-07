/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { asText, IRequestService } from '../../request/common/request.js';
import { IAIExtensionsMarketplaceFetchRequest, IAIExtensionsMarketplaceFetchResponse, IAIExtensionsMarketplaceService } from '../common/aiExtensionsMarketplace.js';

const AllowedMarketplaceHosts = new Set([
	'agentskills.to',
	'claudeskills.club',
	'glama.ai',
	'raw.githubusercontent.com',
	'registry.modelcontextprotocol.io',
	'skillery.dev',
	'skills.pub',
	'skillsmp.com',
]);

export class AIExtensionsMarketplaceMainService extends Disposable implements IAIExtensionsMarketplaceService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async fetch(request: IAIExtensionsMarketplaceFetchRequest, token: CancellationToken): Promise<IAIExtensionsMarketplaceFetchResponse> {
		const url = validateMarketplaceUrl(request.url);
		const context = await this.requestService.request({
			type: 'GET',
			url,
			callSite: request.callSite || 'aiExtensions.marketplace',
			timeout: 20000,
			headers: {
				Accept: 'application/json, text/plain, */*',
			},
		}, token);
		const body = await asText(context) ?? '';
		this.logService.trace(`[AIExtensionsMarketplace] ${url} returned ${context.res.statusCode}`);
		return {
			statusCode: context.res.statusCode ?? 0,
			headers: context.res.headers,
			body,
		};
	}
}

function validateMarketplaceUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== 'https:') {
		throw new Error(`AI Extensions marketplace only supports HTTPS URLs: ${value}`);
	}
	const host = url.hostname.toLowerCase();
	if (!AllowedMarketplaceHosts.has(host)) {
		throw new Error(`AI Extensions marketplace host is not allowed: ${host}`);
	}
	return url.toString();
}
