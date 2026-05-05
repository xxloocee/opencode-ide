/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const OPENCODE_HOST_CHANNEL = 'openCodeHost';
export const OpenCodeDefaultUrl = 'http://127.0.0.1:4096';
export const SessionsOpenCodeCommandSettingId = 'sessions.openCode.command';
export const SessionsOpenCodeCwdSettingId = 'sessions.openCode.cwd';
export const SessionsOpenCodeUiPackageSettingId = 'sessions.openCode.uiPackage';
export const SessionsOpenCodeEnableGenerativeUiCspSettingId = 'sessions.openCode.enableGenerativeUiCsp';

export const enum OpenCodeHostPhase {
	Stopped = 'stopped',
	Starting = 'starting',
	Running = 'running',
	Error = 'error',
}

export interface IOpenCodeHostState {
	readonly phase: OpenCodeHostPhase;
	readonly url?: string;
	readonly port?: number;
	readonly pid?: number;
	readonly owned?: boolean;
	readonly message?: string;
}

export interface IOpenCodeHostLaunch {
	readonly url: string;
	readonly command?: string;
	readonly cwd?: string;
	readonly uiPackage?: string;
	readonly enableGenerativeUiCsp?: boolean;
}

export interface IOpenCodeHostService {
	readonly _serviceBrand: undefined;

	readonly state: IOpenCodeHostState;
	readonly onDidChangeState: Event<IOpenCodeHostState>;

	start(): Promise<IOpenCodeHostState>;
	stop(): Promise<void>;
}

export const IOpenCodeHostService = createDecorator<IOpenCodeHostService>('openCodeHostService');

export interface IOpenCodeHostMainService {
	readonly _serviceBrand: undefined;

	onDidChangeState(windowId: number): Event<IOpenCodeHostState>;

	getState(windowId: number): Promise<IOpenCodeHostState>;
	start(windowId: number, input: IOpenCodeHostLaunch): Promise<IOpenCodeHostState>;
	stop(windowId: number): Promise<void>;
}

export const IOpenCodeHostMainService = createDecorator<IOpenCodeHostMainService>('openCodeHostMainService');
