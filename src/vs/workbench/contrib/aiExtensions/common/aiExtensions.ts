/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMcpServerConfiguration } from '../../../../platform/mcp/common/mcpPlatformTypes.js';

export type AIExtensionType = 'skill' | 'plugin' | 'mcp';
export type AIExtensionSource = 'codex' | 'claude' | 'opencode';
export type AIExtensionInstallScope = 'profile' | 'external';
export type AIExtensionInstallState = 'notInstalled' | 'installed' | 'viewOnly' | 'unsupported';
export type AIExtensionUpdateState = 'unknown' | 'latest' | 'available';
export type AIExtensionSyncStatus = 'notSynced' | 'pending' | 'success' | 'failed';

export interface IAIExtensionSkillContribution {
	readonly name: string;
	readonly content: string;
}

export interface IAIExtensionPluginContribution {
	readonly name: string;
	readonly content?: string;
	readonly npm?: string;
}

export interface IAIExtensionMcpContribution {
	readonly name: string;
	readonly config: IMcpServerConfiguration;
}

export interface IAIExtensionFileContribution {
	readonly path: string;
	readonly content: string;
}

export interface IAIExtensionContributions {
	readonly skills?: readonly IAIExtensionSkillContribution[];
	readonly plugins?: readonly IAIExtensionPluginContribution[];
	readonly mcp?: readonly IAIExtensionMcpContribution[];
	readonly files?: readonly IAIExtensionFileContribution[];
}

export interface IAIExtensionDescriptor {
	readonly id: string;
	readonly name: string;
	readonly version?: string;
	readonly source: AIExtensionSource;
	readonly sourceLabel: string;
	readonly marketplaceUrl?: string;
	readonly author?: string;
	readonly category?: string;
	readonly homepage?: string;
	readonly iconUrl?: string;
	readonly downloadCount?: number;
	readonly starCount?: number;
	readonly sourceTotalCount?: number;
	readonly type: AIExtensionType;
	readonly description: string;
	readonly risk: string;
	readonly installable: boolean;
	readonly installState: AIExtensionInstallState;
	readonly installedByIde: boolean;
	readonly enabled: boolean;
	readonly trusted?: boolean;
	readonly installScope: AIExtensionInstallScope;
	readonly updateState: AIExtensionUpdateState;
	readonly syncStatus: AIExtensionSyncStatus;
	readonly syncError?: string;
	readonly lastSyncedAt?: number;
	readonly needsRuntimeRefresh: boolean;
	readonly detail?: string;
	readonly sourceUri?: URI;
	readonly sourceMetadata?: unknown;
	readonly contributions: IAIExtensionContributions;
}

export interface IAIExtensionsOverlay {
	readonly configDir: URI;
	readonly configFile: URI;
	readonly requiresRuntimeRefresh: boolean;
	readonly syncedAt: number;
}

export const IAIExtensionsWorkbenchService = createDecorator<IAIExtensionsWorkbenchService>('aiExtensionsWorkbenchService');

export interface IAIExtensionsWorkbenchService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;

	list(): Promise<readonly IAIExtensionDescriptor[]>;
	refresh(): Promise<readonly IAIExtensionDescriptor[]>;
	installed(): Promise<readonly IAIExtensionDescriptor[]>;
	install(id: string): Promise<IAIExtensionDescriptor>;
	uninstall(id: string): Promise<void>;
	enable(id: string): Promise<IAIExtensionDescriptor>;
	disable(id: string): Promise<IAIExtensionDescriptor>;
	trust(id: string): Promise<IAIExtensionDescriptor>;
	update(id: string): Promise<IAIExtensionDescriptor>;
	sync(): Promise<IAIExtensionsOverlay>;
	getOpenCodeOverlay(): Promise<IAIExtensionsOverlay>;
}
