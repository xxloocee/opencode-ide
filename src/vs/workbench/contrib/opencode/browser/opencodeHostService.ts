/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IOpenCodeHostService, IOpenCodeHostState, OpenCodeHostPhase } from '../../../../platform/opencode/common/opencodeHost.js';

const notSupported = () => { throw new Error('OpenCode host is only available in the desktop workbench.'); };

export class OpenCodeHostService implements IOpenCodeHostService {

	declare readonly _serviceBrand: undefined;

	readonly state: IOpenCodeHostState = {
		phase: OpenCodeHostPhase.Error,
		message: 'OpenCode host requires the desktop workbench.'
	};
	readonly onDidChangeState = Event.None;

	async start(): Promise<IOpenCodeHostState> {
		return notSupported();
	}

	async stop(): Promise<void> {
		return;
	}
}

registerSingleton(IOpenCodeHostService, OpenCodeHostService, InstantiationType.Delayed);
