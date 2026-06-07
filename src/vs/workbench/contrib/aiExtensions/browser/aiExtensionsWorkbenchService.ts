/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRequestContext } from '../../../../base/parts/request/common/request.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IAIExtensionsMarketplaceService } from '../../../../platform/aiExtensions/common/aiExtensionsMarketplace.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { asJson, asText } from '../../../../platform/request/common/request.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import {
	AIExtensionSource,
	IAIExtensionDescriptor,
	IAIExtensionMcpContribution,
	IAIExtensionsOverlay,
	IAIExtensionsWorkbenchService,
} from '../common/aiExtensions.js';

interface IAIExtensionSyncState {
	readonly status: 'pending' | 'success' | 'failed';
	readonly syncedAt?: number;
	readonly error?: string;
}

interface IStoredAIExtension {
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
	readonly type: IAIExtensionDescriptor['type'];
	readonly description: string;
	readonly risk: string;
	readonly enabled: boolean;
	readonly detail?: string;
	readonly contributions: IAIExtensionDescriptor['contributions'];
	readonly sourceMetadata?: unknown;
	readonly trusted: boolean;
	readonly syncState: IAIExtensionSyncState;
	readonly installedAt: number;
	readonly updatedAt: number;
}

interface IStoredRegistry {
	readonly version: 1;
	readonly items: readonly IStoredAIExtension[];
}

const InstalledRegistryVersion = 1;
const InstalledRegistryName = 'installed.json';
const StateFolderName = 'state';
const SyncStateName = 'sync.json';
const OverlayTempSegment = 'dir.tmp';
const OverlayBackupSegment = 'dir.backup';
const ConfigBackupName = 'opencode.backup.json';
const MarketplaceCacheTtl = 5 * 60 * 1000;

const AIExtensionRemoteMarketplaces: readonly IRemoteMarketplaceDefinition[] = [
	{
		format: 'claudeMarketplace',
		provider: 'claude',
		label: 'anthropic-agent-skills',
		repo: 'anthropics/skills',
		definitionPath: '.claude-plugin/marketplace.json',
		type: 'skills',
	},
	{
		format: 'claudeSkills',
		provider: 'claude',
		label: 'Claude Skills Library',
		endpoint: 'https://claudeskills.club/api/skills?limit=100',
		type: 'skills',
	},
	{
		format: 'skillsmp',
		provider: 'codex',
		label: 'SkillsMP',
		endpoint: 'https://skillsmp.com/api/skills?limit=100&sortBy=stars',
		type: 'skills',
	},
	{
		format: 'skillsPub',
		provider: 'codex',
		label: 'skills.pub',
		endpoint: 'https://skills.pub/api/skills?limit=48',
		type: 'skills',
	},
	{
		format: 'skillery',
		provider: 'codex',
		label: 'Skillery',
		endpoint: 'https://skillery.dev/api/skills?limit=32',
		type: 'skills',
	},
	{
		format: 'agentskills',
		provider: 'codex',
		label: 'AgentSkills.to',
		endpoint: 'https://agentskills.to/api/skills?limit=200',
		type: 'skills',
	},
	{
		format: 'skillWiki',
		provider: 'codex',
		label: 'SkillWiki',
		endpoint: 'https://raw.githubusercontent.com/sophgen/skillwiki/main/website/public/available-skills.xml',
		type: 'skills',
	},
	{
		format: 'claudeMarketplace',
		provider: 'claude',
		label: 'claude-plugins-official',
		repo: 'anthropics/claude-plugins-official',
		definitionPath: '.claude-plugin/marketplace.json',
		type: 'plugins',
	},
	{
		format: 'claudeMarketplace',
		provider: 'claude',
		label: 'claude-community',
		repo: 'anthropics/claude-plugins-community',
		definitionPath: '.claude-plugin/marketplace.json',
		type: 'plugins',
	},
	{
		format: 'claudeMarketplace',
		provider: 'claude',
		label: 'claude-code-plugins',
		repo: 'anthropics/claude-code',
		definitionPath: '.claude-plugin/marketplace.json',
		type: 'plugins',
	},
	{
		format: 'mcpRegistry',
		provider: 'opencode',
		label: 'MCP Registry',
		endpoint: 'https://registry.modelcontextprotocol.io/v0.1/servers?limit=100',
		type: 'mcp',
	},
	{
		format: 'glamaMcp',
		provider: 'opencode',
		label: 'Glama MCP',
		endpoint: 'https://glama.ai/api/mcp/v1/servers?first=100',
		type: 'mcp',
	},
];

interface IRemoteMarketplaceDefinition {
	readonly format: 'claudeMarketplace' | 'claudeSkills' | 'skillsmp' | 'skillsPub' | 'skillery' | 'agentskills' | 'skillWiki' | 'mcpRegistry' | 'glamaMcp';
	readonly provider: AIExtensionSource;
	readonly label: string;
	readonly repo?: string;
	readonly definitionPath?: string;
	readonly endpoint?: string;
	readonly type: 'skills' | 'plugins' | 'mcp';
}

interface IRemoteMarketplaceJson {
	readonly name?: string;
	readonly plugins?: readonly IRemoteMarketplaceEntry[];
}

interface IRemoteMarketplaceEntry {
	readonly name?: string;
	readonly description?: string;
	readonly version?: string;
	readonly source?: string | IRemoteMarketplaceSource;
	readonly skills?: readonly string[];
	readonly author?: { readonly name?: string; readonly email?: string; readonly url?: string };
	readonly category?: string;
	readonly homepage?: string;
	readonly icon?: string;
	readonly logo?: string;
	readonly downloads?: number | string;
	readonly downloadCount?: number | string;
	readonly installCount?: number | string;
	readonly installs?: number | string;
	readonly stars?: number | string;
	readonly starCount?: number | string;
	readonly stargazers?: number | string;
	readonly stargazerCount?: number | string;
	readonly keywords?: readonly string[];
}

interface IRemotePluginSourceMetadata {
	readonly source?: string | IRemoteMarketplaceSource;
	readonly marketplaceRepo?: string;
}

interface IRemoteSkillSourceMetadata {
	readonly skillCandidates?: readonly string[];
}

interface IRemoteMarketplaceSource {
	readonly source?: string;
	readonly repo?: string;
	readonly url?: string;
	readonly path?: string;
	readonly ref?: string;
	readonly sha?: string;
}

interface IClaudeSkillsJson {
	readonly success?: boolean;
	readonly data?: {
		readonly items?: readonly IClaudeSkillsEntry[];
		readonly pagination?: {
			readonly total?: number | string;
		};
	};
}

interface IClaudeSkillsEntry {
	readonly id?: number | string;
	readonly rawId?: string;
	readonly slug?: string;
	readonly title?: string;
	readonly name?: string;
	readonly description?: string;
	readonly githubUrl?: string;
	readonly author?: string;
	readonly authorAvatar?: string;
	readonly stars?: number | string;
	readonly score?: number | string;
}

interface IClaudePluginMcpJson {
	readonly mcpServers?: Record<string, IClaudePluginMcpServer>;
}

interface IClaudePluginMcpServer {
	readonly type?: string;
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Record<string, string>;
	readonly cwd?: string;
}

interface ISkillsMpJson {
	readonly skills?: readonly ISkillsMpEntry[];
	readonly success?: boolean;
	readonly data?: {
		readonly skills?: readonly ISkillsMpEntry[];
	};
	readonly pagination?: {
		readonly total?: number | string;
		readonly totalAll?: number | string;
	};
}

interface ISkillsMpEntry {
	readonly id?: string;
	readonly name?: string;
	readonly author?: string;
	readonly authorAvatar?: string;
	readonly description?: string;
	readonly githubUrl?: string;
	readonly skillUrl?: string;
	readonly stars?: number | string;
	readonly forks?: number | string;
	readonly updatedAt?: number | string;
	readonly path?: string;
	readonly branch?: string;
}

interface ISkillsPubJson {
	readonly skills?: readonly ISkillsPubEntry[];
	readonly data?: {
		readonly skills?: readonly ISkillsPubEntry[];
		readonly total?: number | string;
	};
	readonly total?: number | string;
}

interface ISkillsPubEntry {
	readonly skillId?: string;
	readonly repoName?: string;
	readonly skillName?: string;
	readonly pluginName?: string;
	readonly pluginDescription?: string;
	readonly author?: { readonly name?: string; readonly email?: string; readonly url?: string };
	readonly repositoryUrl?: string;
	readonly version?: string;
	readonly updatedAt?: number | string;
}

interface ISkilleryJson {
	readonly data?: readonly ISkilleryEntry[];
}

interface ISkilleryEntry {
	readonly slug?: string;
	readonly name?: string;
	readonly description?: string;
	readonly source?: string;
	readonly githubPath?: string;
	readonly githubBranch?: string;
	readonly qualityScore?: number | string;
	readonly isVerified?: number | boolean;
	readonly updatedAt?: string;
}

interface ISkilleryDetailJson {
	readonly data?: ISkilleryDetail;
}

interface ISkilleryDetail extends ISkilleryEntry {
	readonly githubOwner?: string;
	readonly githubRepo?: string;
	readonly githubStars?: number | string;
	readonly githubForks?: number | string;
	readonly skillTags?: readonly string[];
}

interface IAgentSkillsJson {
	readonly skills?: readonly IAgentSkillsEntry[];
}

interface IAgentSkillsEntry {
	readonly id?: string;
	readonly name?: string;
	readonly slug?: string;
	readonly description?: string;
	readonly total_install?: number | string;
	readonly weekly_install?: number | string;
	readonly category?: string;
	readonly github_json?: {
		readonly owner?: string;
		readonly repo?: string;
		readonly stars?: number | string;
		readonly description?: string;
	};
	readonly metadata?: {
		readonly install_command?: string;
	};
	readonly categories?: {
		readonly name?: string;
	};
	readonly author?: string | { readonly name?: string };
}

interface ISkillWikiEntry {
	readonly name?: string;
	readonly description?: string;
	readonly domain?: string;
	readonly tags?: string;
	readonly location?: string;
}

interface IMcpRegistryJson {
	readonly servers?: readonly IMcpRegistryEntry[];
	readonly metadata?: {
		readonly count?: number | string;
		readonly nextCursor?: string;
	};
}

interface IMcpRegistryEntry {
	readonly server?: {
		readonly name?: string;
		readonly title?: string;
		readonly description?: string;
		readonly version?: string;
		readonly repository?: {
			readonly url?: string;
		};
		readonly remotes?: readonly {
			readonly type?: string;
			readonly url?: string;
		}[];
	};
	readonly _meta?: {
		readonly 'io.modelcontextprotocol.registry/official'?: {
			readonly isLatest?: boolean;
		};
	};
}

interface IGlamaMcpJson {
	readonly servers?: readonly IGlamaMcpEntry[];
}

interface IGlamaMcpEntry {
	readonly id?: string;
	readonly name?: string;
	readonly namespace?: string;
	readonly slug?: string;
	readonly description?: string;
	readonly url?: string;
	readonly repository?: {
		readonly url?: string;
	};
	readonly attributes?: readonly string[];
	readonly tools?: readonly unknown[];
	readonly environmentVariablesJsonSchema?: {
		readonly required?: readonly string[];
	};
	readonly spdxLicense?: {
		readonly name?: string;
		readonly url?: string;
	} | null;
}

export class AIExtensionsWorkbenchService extends Disposable implements IAIExtensionsWorkbenchService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;
	private marketplaceDescriptorCache: readonly IAIExtensionDescriptor[] | undefined;
	private marketplaceDescriptorFetch: Promise<readonly IAIExtensionDescriptor[]> | undefined;
	private marketplaceDescriptorCacheTime = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IUserDataProfileService private readonly profileService: IUserDataProfileService,
		@IAIExtensionsMarketplaceService private readonly marketplaceService: IAIExtensionsMarketplaceService,
	) {
		super();
		this._register(this.profileService.onDidChangeCurrentProfile(() => this._onDidChange.fire()));
	}

	async list(): Promise<readonly IAIExtensionDescriptor[]> {
		const discovered = await this.marketplaceDescriptors();
		const installed = new Map((await this.readInstalled()).map(item => [item.id, this.toDescriptor(item)]));

		const result = new Map<string, IAIExtensionDescriptor>();
		for (const item of discovered) {
			result.set(item.id, installed.get(item.id) ?? item);
		}
		return [...result.values()].sort(compareDescriptors);
	}

	async refresh(): Promise<readonly IAIExtensionDescriptor[]> {
		this.marketplaceDescriptorCache = undefined;
		this.marketplaceDescriptorCacheTime = 0;
		this.marketplaceDescriptorFetch = undefined;
		const items = await this.list();
		this._onDidChange.fire();
		return items;
	}

	async installed(): Promise<readonly IAIExtensionDescriptor[]> {
		return (await this.readInstalled()).map(item => this.toDescriptor(item)).sort(compareDescriptors);
	}

	async install(id: string): Promise<IAIExtensionDescriptor> {
		const item = (await this.list()).find(candidate => candidate.id === id);
		if (!item) {
			throw new Error(localize('aiExtensions.install.notFound', "AI extension not found: {0}", id));
		}
		if (!item.installable) {
			throw new Error(localize('aiExtensions.install.unsupported', "This source is not installable yet."));
		}
		if (item.installedByIde) {
			return item;
		}

		const now = Date.now();
		const installItem = await this.resolveInstallDescriptor(item);
		if (!hasContributions(installItem.contributions)) {
			throw new Error(localize('aiExtensions.install.noRuntimeContent', "This AI extension does not expose installable runtime content yet."));
		}
		const trusted = installItem.type === 'skill';
		const enabled = trusted && defaultEnablement(installItem);
		const stored: IStoredAIExtension = {
			id: installItem.id,
			name: installItem.name,
			version: installItem.version,
			source: installItem.source,
			sourceLabel: installItem.sourceLabel,
			marketplaceUrl: installItem.marketplaceUrl,
			author: installItem.author,
			category: installItem.category,
			homepage: installItem.homepage,
			iconUrl: installItem.iconUrl,
			downloadCount: installItem.downloadCount,
			starCount: installItem.starCount,
			type: installItem.type,
			description: installItem.description,
			risk: installItem.risk,
			enabled,
			detail: installItem.detail,
			contributions: installItem.contributions,
			sourceMetadata: installItem.sourceMetadata ?? createSourceMetadata(installItem),
			trusted,
			syncState: { status: 'pending' },
			installedAt: now,
			updatedAt: now,
		};
		const installed = await this.readInstalled();
		await this.writeInstalled([...installed.filter(candidate => candidate.id !== id), stored]);
		await this.writeSourceManifest(stored);
		this._onDidChange.fire();
		return this.toDescriptor(stored);
	}

	async uninstall(id: string): Promise<void> {
		const installed = await this.readInstalled();
		const next = installed.filter(item => item.id !== id);
		if (next.length === installed.length) {
			return;
		}
		await this.writeInstalled(next);
		await this.deleteSource(id);
		await this.sync();
		this._onDidChange.fire();
	}

	async enable(id: string): Promise<IAIExtensionDescriptor> {
		return this.setEnablement(id, true);
	}

	async disable(id: string): Promise<IAIExtensionDescriptor> {
		return this.setEnablement(id, false);
	}

	async update(id: string): Promise<IAIExtensionDescriptor> {
		const installed = await this.readInstalled();
		const existing = installed.find(candidate => candidate.id === id);
		if (!existing) {
			throw new Error(localize('aiExtensions.update.notInstalled', "This AI extension is not installed."));
		}
		const remote = await this.refreshRemoteDescriptor(id);
		if (!remote) {
			throw new Error(localize('aiExtensions.update.notFound', "The remote marketplace entry is no longer available."));
		}
		const resolved = await this.resolveInstallDescriptor(remote);
		if (!hasContributions(resolved.contributions)) {
			throw new Error(localize('aiExtensions.update.noRuntimeContent', "The latest marketplace entry does not expose installable runtime content."));
		}
		const now = Date.now();
		const trusted = existing.trusted;
		const enabled = existing.enabled && trusted && defaultEnablement(resolved);
		const updated: IStoredAIExtension = {
			...existing,
			name: resolved.name,
			version: resolved.version,
			source: resolved.source,
			sourceLabel: resolved.sourceLabel,
			marketplaceUrl: resolved.marketplaceUrl,
			author: resolved.author,
			category: resolved.category,
			homepage: resolved.homepage,
			iconUrl: resolved.iconUrl,
			downloadCount: resolved.downloadCount,
			starCount: resolved.starCount,
			type: resolved.type,
			description: resolved.description,
			risk: resolved.risk,
			enabled,
			detail: resolved.detail,
			contributions: resolved.contributions,
			sourceMetadata: resolved.sourceMetadata ?? createSourceMetadata(resolved),
			trusted,
			syncState: { status: 'pending' },
			updatedAt: now,
		};
		await this.writeInstalled(installed.map(item => item.id === id ? updated : item));
		await this.writeSourceManifest(updated);
		this._onDidChange.fire();
		return this.toDescriptor(updated);
	}

	async trust(id: string): Promise<IAIExtensionDescriptor> {
		const installed = await this.readInstalled();
		const existing = installed.find(item => item.id === id);
		if (!existing) {
			throw new Error(localize('aiExtensions.trust.notInstalled', "This AI extension is not installed."));
		}
		if (existing.trusted) {
			return this.toDescriptor(existing);
		}
		const updated = { ...existing, trusted: true, updatedAt: Date.now() };
		await this.writeInstalled(installed.map(item => item.id === id ? updated : item));
		this._onDidChange.fire();
		return this.toDescriptor(updated);
	}

	async sync(): Promise<IAIExtensionsOverlay> {
		const overlay = await this.getOpenCodeOverlay();
		const installed = await this.prepareInstalledForSync(await this.readInstalled());
		const enabled = installed.filter(item => item.enabled && item.trusted);
		const config: { $schema: string; mcp?: Record<string, unknown>; plugin?: string[] } = {
			$schema: 'https://opencode.ai/config.json',
		};
		const syncedAt = Date.now();
		const tempConfigDir = joinPath(dirname(overlay.configDir), OverlayTempSegment);
		const tempConfigFile = joinPath(dirname(overlay.configFile), 'opencode.tmp.json');
		const enabledIds = new Set(enabled.map(item => item.id));

		const mcp: Record<string, unknown> = {};
		const plugin: string[] = [];
		const names = new Set<string>();
		try {
			for (const item of enabled) {
				for (const skill of item.contributions.skills ?? []) {
					const safeName = stableName(skill.name);
					this.assertUnique(names, `skill:${safeName}`);
				}
				const extensionRoot = this.extensionRootForItem(tempConfigDir, item);
				for (const server of item.contributions.mcp ?? []) {
					const safeName = stableName(server.name);
					this.assertUnique(names, `mcp:${safeName}`);
					mcp[safeName] = toOpenCodeMcpConfig(server, extensionRoot.fsPath);
				}
				for (const extensionPlugin of item.contributions.plugins ?? []) {
					const safeName = stableName(extensionPlugin.name);
					this.assertUnique(names, `plugin:${safeName}`);
					if (extensionPlugin.npm) {
						plugin.push(extensionPlugin.npm);
					}
				}
			}

			await this.fileService.del(tempConfigDir, { recursive: true, useTrash: false }).catch(() => undefined);
			await this.ensureFolder(tempConfigDir);
			await this.ensureFolder(dirname(overlay.configFile));

			for (const item of enabled) {
				for (const skill of item.contributions.skills ?? []) {
					const safeName = stableName(skill.name);
					await this.writeText(joinPath(tempConfigDir, 'skills', safeName, 'SKILL.md'), skill.content);
				}
				for (const extensionPlugin of item.contributions.plugins ?? []) {
					const safeName = stableName(extensionPlugin.name);
					if (extensionPlugin.content) {
						await this.writeText(joinPath(tempConfigDir, 'plugins', `${safeName}.ts`), extensionPlugin.content);
					}
				}
				for (const file of item.contributions.files ?? []) {
					const safePath = safeContributionPath(file.path);
					if (safePath) {
						await this.writeText(joinPath(this.extensionRootForItem(tempConfigDir, item), safePath), file.content);
					}
				}
			}

			if (Object.keys(mcp).length > 0) {
				config.mcp = mcp;
			}
			if (plugin.length > 0) {
				config.plugin = plugin;
			}
			await this.writeText(tempConfigFile, JSON.stringify(config, null, 2));
			await this.replaceOverlay(tempConfigDir, overlay.configDir, tempConfigFile, overlay.configFile);
			await this.writeSyncState({
				status: 'success',
				syncedAt,
				configDir: overlay.configDir.toString(),
				configFile: overlay.configFile.toString(),
				enabledCount: enabled.length,
				written: {
					skills: enabled.reduce((count, item) => count + (item.contributions.skills?.length ?? 0), 0),
					plugins: enabled.reduce((count, item) => count + (item.contributions.plugins?.length ?? 0), 0),
					mcp: Object.keys(mcp).length,
				},
			});
			await this.writeInstalled(installed.map(item => item.enabled && !enabledIds.has(item.id)
				? { ...item, syncState: { status: 'pending' }, updatedAt: syncedAt }
				: { ...item, syncState: { status: 'success', syncedAt }, updatedAt: syncedAt }));
			this._onDidChange.fire();
			return { ...overlay, syncedAt, requiresRuntimeRefresh: true };
		} catch (err) {
			await this.fileService.del(tempConfigDir, { recursive: true, useTrash: false }).catch(() => undefined);
			await this.fileService.del(tempConfigFile, { useTrash: false }).catch(() => undefined);
			const message = getErrorMessage(err);
			await this.writeSyncState({
				status: 'failed',
				syncedAt,
				configDir: overlay.configDir.toString(),
				configFile: overlay.configFile.toString(),
				enabledCount: enabled.length,
				error: message,
			});
			await this.writeInstalled(installed.map(item => enabledIds.has(item.id) ? { ...item, syncState: { status: 'failed', syncedAt, error: message }, updatedAt: syncedAt } : item));
			this._onDidChange.fire();
			throw err;
		}
	}

	async getOpenCodeOverlay(): Promise<IAIExtensionsOverlay> {
		const root = joinPath(this.profileService.currentProfile.location, 'opencode', 'ai-extensions-ide');
		return {
			configDir: joinPath(root, 'dir'),
			configFile: joinPath(root, 'config', 'opencode.json'),
			requiresRuntimeRefresh: false,
			syncedAt: 0,
		};
	}

	private async setEnablement(id: string, enabled: boolean): Promise<IAIExtensionDescriptor> {
		const installed = await this.readInstalled();
		const existing = installed.find(item => item.id === id);
		if (!existing) {
			throw new Error(localize('aiExtensions.enable.notInstalled', "This AI extension is not installed."));
		}
		if (enabled && !existing.trusted) {
			throw new Error(localize('aiExtensions.enable.untrusted', "Trust this source before enabling the AI extension."));
		}
		if (enabled && existing.type === 'plugin' && hasRuntimePluginContribution(existing)) {
			throw new Error(localize('aiExtensions.enable.pluginUnsupported', "Plugin runtime enablement is deferred; installed plugins stay disabled for now."));
		}
		const updated = { ...existing, enabled, updatedAt: Date.now() };
		await this.writeInstalled(installed.map(item => item.id === id ? updated : item));
		await this.sync();
		const refreshed = (await this.readInstalled()).find(item => item.id === id) ?? updated;
		this._onDidChange.fire();
		return this.toDescriptor(refreshed);
	}

	private async marketplaceDescriptors(): Promise<readonly IAIExtensionDescriptor[]> {
		if (this.marketplaceDescriptorCache && Date.now() - this.marketplaceDescriptorCacheTime < MarketplaceCacheTtl) {
			return this.marketplaceDescriptorCache;
		}
		if (!this.marketplaceDescriptorFetch) {
			this.marketplaceDescriptorFetch = this.remoteMarketplaceDescriptors().then(items => {
				this.marketplaceDescriptorCache = items;
				this.marketplaceDescriptorCacheTime = Date.now();
				return items;
			}).finally(() => {
				this.marketplaceDescriptorFetch = undefined;
			});
		}
		return this.marketplaceDescriptorFetch;
	}

	private async refreshRemoteDescriptor(id: string): Promise<IAIExtensionDescriptor | undefined> {
		const items = await this.remoteMarketplaceDescriptors();
		this.marketplaceDescriptorCache = items;
		this.marketplaceDescriptorCacheTime = Date.now();
		return items.find(item => item.id === id);
	}

	private async fetchMarketplaceResource(url: string, callSite: string): Promise<IRequestContext> {
		const response = await this.marketplaceService.fetch({ url, callSite }, CancellationToken.None);
		return {
			res: {
				statusCode: response.statusCode,
				headers: response.headers ?? {},
			},
			stream: bufferToStream(VSBuffer.fromString(response.body)),
		};
	}

	private async remoteMarketplaceDescriptors(): Promise<readonly IAIExtensionDescriptor[]> {
		const groups = await Promise.all(AIExtensionRemoteMarketplaces.map(marketplace => this.fetchRemoteMarketplace(marketplace)));
		return groups.flat();
	}

	private async fetchRemoteMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (marketplace.format === 'skillsmp') {
			return this.fetchSkillsMpMarketplace(marketplace);
		}
		if (marketplace.format === 'skillsPub') {
			return this.fetchSkillsPubMarketplace(marketplace);
		}
		if (marketplace.format === 'claudeSkills') {
			return this.fetchClaudeSkillsMarketplace(marketplace);
		}
		if (marketplace.format === 'skillery') {
			return this.fetchSkilleryMarketplace(marketplace);
		}
		if (marketplace.format === 'agentskills') {
			return this.fetchAgentSkillsMarketplace(marketplace);
		}
		if (marketplace.format === 'skillWiki') {
			return this.fetchSkillWikiMarketplace(marketplace);
		}
		if (marketplace.format === 'mcpRegistry') {
			return this.fetchMcpRegistryMarketplace(marketplace);
		}
		if (marketplace.format === 'glamaMcp') {
			return this.fetchGlamaMcpMarketplace(marketplace);
		}
		if (!marketplace.repo || !marketplace.definitionPath) {
			return [];
		}
		const marketplaceUrl = `https://raw.githubusercontent.com/${marketplace.repo}/main/${marketplace.definitionPath}`;
		try {
			const context = await this.fetchMarketplaceResource(marketplaceUrl, 'aiExtensions.fetchMarketplace');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplaceUrl} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<IRemoteMarketplaceJson>(context);
			if (!json?.plugins) {
				return [];
			}
			const label = json.name || marketplace.label;
			if (marketplace.type === 'skills') {
				return (await Promise.all(json.plugins.map(entry => this.toRemoteSkillDescriptors(marketplace, label, marketplaceUrl, entry)))).flat();
			}
			return (await Promise.all(json.plugins.map(entry => this.toRemotePluginDescriptor(marketplace, label, marketplaceUrl, entry)))).filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplaceUrl}`, err);
			return [];
		}
	}

	private async prepareInstalledForSync(installed: readonly IStoredAIExtension[]): Promise<readonly IStoredAIExtension[]> {
		const now = Date.now();
		let changed = false;
		const next: IStoredAIExtension[] = [];
		for (const item of installed) {
			if (item.type !== 'plugin' || hasContributions(item.contributions)) {
				next.push(item);
				continue;
			}
			const descriptor = await this.resolveInstallDescriptor(this.toDescriptor(item));
			if (!hasContributions(descriptor.contributions)) {
				next.push(item);
				continue;
			}
			changed = true;
			next.push({
				...item,
				contributions: descriptor.contributions,
				enabled: item.trusted && defaultEnablement(descriptor),
				trusted: item.trusted,
				updatedAt: now,
			});
		}
		return changed ? next : installed;
	}

	private async fetchSkillsMpMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchSkillsMp');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<ISkillsMpJson>(context);
			const skills = json?.data?.skills ?? json?.skills ?? [];
			const sourceTotalCount = readCount(json?.pagination?.totalAll) ?? readCount(json?.pagination?.total);
			const descriptors = await Promise.all(skills.map(entry => this.toSkillsMpDescriptor(marketplace, entry, sourceTotalCount)));
			return descriptors.filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private async fetchMcpRegistryMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchMcpRegistry');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<IMcpRegistryJson>(context);
			const descriptors = (json?.servers ?? []).map(entry => this.toMcpRegistryDescriptor(marketplace, entry)).filter(isDefined);
			return descriptors;
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private toMcpRegistryDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: IMcpRegistryEntry): IAIExtensionDescriptor | undefined {
		if (entry._meta?.['io.modelcontextprotocol.registry/official']?.isLatest === false) {
			return undefined;
		}
		const server = entry.server;
		const name = server?.title || server?.name;
		if (!server?.name || !name) {
			return undefined;
		}
		const remote = server.remotes?.find(candidate => isHttpsUrl(candidate.url));
		const remoteUrl = remote?.url;
		const installable = !!remoteUrl;
		const contributions = remoteUrl ? {
			mcp: [{
				name: stableName(server.name),
				config: {
					type: McpServerType.REMOTE,
					url: remoteUrl,
				},
			}],
		} satisfies IAIExtensionDescriptor['contributions'] : {};
		return {
			id: `marketplace.mcp.${stableName(marketplace.label)}.${stableName(server.name)}`,
			name,
			version: server.version,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: 'https://registry.modelcontextprotocol.io/',
			homepage: server.repository?.url,
			iconUrl: githubAvatarUrl(githubRepoFromUrl(server.repository?.url) ?? ''),
			type: 'mcp',
			description: server.description || localize('aiExtensions.mcp.description', "MCP server from an accessible marketplace."),
			risk: localize('aiExtensions.mcp.risk', "MCP servers can expose tools and external data access. Review the server source and required configuration before installing."),
			installable,
			installState: installable ? 'notInstalled' : 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: [marketplace.label, server.name, server.repository?.url, remote?.type].filter(isNonEmptyString).join(' / '),
			contributions,
		};
	}

	private async fetchGlamaMcpMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchGlamaMcp');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<IGlamaMcpJson>(context);
			return (json?.servers ?? []).map(entry => this.toGlamaMcpDescriptor(marketplace, entry)).filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private toGlamaMcpDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: IGlamaMcpEntry): IAIExtensionDescriptor | undefined {
		const name = entry.name || entry.slug;
		const id = entry.id || entry.slug || name;
		if (!name || !id) {
			return undefined;
		}
		const toolCount = entry.tools?.length ?? 0;
		const requiredEnv = entry.environmentVariablesJsonSchema?.required?.length ?? 0;
		return {
			id: `marketplace.mcp.${stableName(marketplace.label)}.${stableName(id)}`,
			name,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: entry.url || 'https://glama.ai/mcp',
			author: entry.namespace,
			category: entry.attributes?.join(', '),
			homepage: entry.repository?.url,
			iconUrl: githubAvatarUrl(githubRepoFromUrl(entry.repository?.url) ?? ''),
			type: 'mcp',
			description: entry.description || localize('aiExtensions.mcp.description', "MCP server from an accessible marketplace."),
			risk: localize('aiExtensions.mcp.risk', "MCP servers can expose tools and external data access. Review the server source and required configuration before installing."),
			installable: false,
			installState: 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: [
				marketplace.label,
				entry.repository?.url,
				toolCount ? localize('aiExtensions.mcp.toolsDetail', "{0} tools", toolCount) : undefined,
				requiredEnv ? localize('aiExtensions.mcp.envDetail', "{0} required environment variables", requiredEnv) : undefined,
				entry.spdxLicense?.name,
			].filter(isNonEmptyString).join(' / '),
			contributions: {},
		};
	}

	private async toSkillsMpDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: ISkillsMpEntry, sourceTotalCount: number | undefined): Promise<IAIExtensionDescriptor | undefined> {
		if (!entry.name || !entry.githubUrl) {
			return undefined;
		}
		const rawUrl = githubRawUrlFromTree(entry.githubUrl, entry.branch, entry.path);
		const candidates = rawUrl ? [rawUrl] : [];
		const name = entry.name;
		const description = entry.description || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace.");
		return {
			id: `marketplace.skill.${stableName(marketplace.label)}.${stableName(entry.id ?? `${entry.author ?? 'author'}-${name}`)}`,
			name,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: entry.skillUrl || 'https://skillsmp.com/',
			author: entry.author,
			homepage: entry.githubUrl,
			iconUrl: entry.authorAvatar || githubAvatarUrl(githubRepoFromUrl(entry.githubUrl) ?? ''),
			starCount: readCount(entry.stars),
			sourceTotalCount,
			type: 'skill',
			description,
			risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
			installable: candidates.length > 0,
			installState: candidates.length > 0 ? 'notInstalled' : 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: rawUrl ? `${marketplace.label} / ${entry.githubUrl} / ${rawUrl}` : `${marketplace.label} / ${entry.githubUrl}`,
			sourceMetadata: createRemoteSkillSourceMetadata(candidates),
			contributions: {},
		};
	}

	private async fetchSkillsPubMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchSkillsPub');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<ISkillsPubJson>(context);
			const skills = json?.data?.skills ?? json?.skills ?? [];
			const sourceTotalCount = readCount(json?.data?.total) ?? readCount(json?.total);
			const descriptors = await Promise.all(skills.map(entry => this.toSkillsPubDescriptor(marketplace, entry, sourceTotalCount)));
			return descriptors.filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private async fetchClaudeSkillsMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchClaudeSkills');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<IClaudeSkillsJson>(context);
			const skills = json?.data?.items ?? [];
			const sourceTotalCount = readCount(json?.data?.pagination?.total);
			const descriptors = await Promise.all(skills.map(entry => this.toClaudeSkillsDescriptor(marketplace, entry, sourceTotalCount)));
			return descriptors.filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private async toClaudeSkillsDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: IClaudeSkillsEntry, sourceTotalCount: number | undefined): Promise<IAIExtensionDescriptor | undefined> {
		const name = entry.name || entry.title || entry.slug;
		if (!name || !entry.githubUrl) {
			return undefined;
		}
		const rawUrl = githubRawUrlFromTree(entry.githubUrl, undefined, undefined);
		const candidates = rawUrl ? [rawUrl] : [];
		return {
			id: `marketplace.skill.${stableName(marketplace.label)}.${stableName(entry.rawId ?? entry.slug ?? String(entry.id ?? name))}`,
			name,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: entry.slug ? `https://claudeskills.club/skills/${encodeURIComponent(entry.slug)}` : 'https://claudeskills.club/skills',
			author: entry.author,
			homepage: entry.githubUrl,
			iconUrl: entry.authorAvatar || githubAvatarUrl(githubRepoFromUrl(entry.githubUrl) ?? ''),
			starCount: readCount(entry.stars),
			sourceTotalCount,
			type: 'skill',
			description: entry.description || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace."),
			risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
			installable: candidates.length > 0,
			installState: candidates.length > 0 ? 'notInstalled' : 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: rawUrl ? `${marketplace.label} / ${entry.githubUrl} / ${rawUrl}` : `${marketplace.label} / ${entry.githubUrl}`,
			sourceMetadata: createRemoteSkillSourceMetadata(candidates),
			contributions: {},
		};
	}

	private async toSkillsPubDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: ISkillsPubEntry, sourceTotalCount: number | undefined): Promise<IAIExtensionDescriptor | undefined> {
		if (!entry.skillName || !entry.repositoryUrl) {
			return undefined;
		}
		const candidates = skillsPubRawCandidates(entry.repositoryUrl, entry.skillName, entry.skillId);
		const name = entry.skillName;
		const description = entry.pluginDescription || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace.");
		return {
			id: `marketplace.skill.${stableName(marketplace.label)}.${stableName(entry.skillId ?? `${entry.repoName ?? 'repo'}-${name}`)}`,
			name,
			version: entry.version || undefined,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: entry.skillId ? `https://skills.pub/en/skills/${encodeURIComponent(entry.skillId)}` : 'https://skills.pub/en/skills',
			author: entry.author?.name,
			homepage: entry.repositoryUrl,
			iconUrl: githubAvatarUrl(githubRepoFromUrl(entry.repositoryUrl) ?? ''),
			sourceTotalCount,
			type: 'skill',
			description,
			risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
			installable: candidates.length > 0,
			installState: candidates.length > 0 ? 'notInstalled' : 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: candidates[0] ? `${marketplace.label} / ${entry.repositoryUrl} / ${candidates[0]}` : `${marketplace.label} / ${entry.repositoryUrl}`,
			sourceMetadata: createRemoteSkillSourceMetadata(candidates),
			contributions: {},
		};
	}

	private async fetchSkilleryMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchSkillery');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<ISkilleryJson>(context);
			const descriptors = await Promise.all((json?.data ?? []).map(entry => this.toSkilleryDescriptor(marketplace, entry)));
			return descriptors.filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private async toSkilleryDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: ISkilleryEntry): Promise<IAIExtensionDescriptor | undefined> {
		if (!entry.slug || !entry.name) {
			return undefined;
		}
		const detail = await this.fetchSkilleryDetail(entry.slug);
		const repo = detail?.githubOwner && detail.githubRepo ? `${detail.githubOwner}/${detail.githubRepo}` : undefined;
		const branch = detail?.githubBranch || entry.githubBranch || 'HEAD';
		const skillPath = detail?.githubPath || entry.githubPath;
		const candidates = repo && skillPath ? skilleryRawCandidates(repo, branch, skillPath) : [];
		const name = detail?.name || entry.name;
		const description = detail?.description || entry.description || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace.");
		return {
			id: `marketplace.skill.${stableName(marketplace.label)}.${stableName(entry.slug)}`,
			name,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: `https://skillery.dev/skills/${entry.slug}`,
			author: detail?.githubOwner,
			category: detail?.skillTags?.join(', '),
			homepage: repo ? `https://github.com/${repo}` : undefined,
			iconUrl: repo ? githubAvatarUrl(repo) : undefined,
			starCount: readCount(detail?.githubStars),
			type: 'skill',
			description,
			risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
			installable: candidates.length > 0,
			installState: candidates.length > 0 ? 'notInstalled' : 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: candidates[0] ? `${marketplace.label} / ${candidates[0]}` : marketplace.label,
			sourceMetadata: createRemoteSkillSourceMetadata(candidates),
			contributions: {},
		};
	}

	private async fetchSkilleryDetail(slug: string): Promise<ISkilleryDetail | undefined> {
		const url = `https://skillery.dev/api/skills/${encodeURIComponent(slug)}`;
		try {
			const context = await this.fetchMarketplaceResource(url, 'aiExtensions.fetchSkilleryDetail');
			if (context.res.statusCode !== 200) {
				return undefined;
			}
			return (await asJson<ISkilleryDetailJson>(context))?.data;
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch Skillery skill ${url}`, err);
			return undefined;
		}
	}

	private async fetchAgentSkillsMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchAgentSkills');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const json = await asJson<IAgentSkillsJson>(context);
			const descriptors = await Promise.all((json?.skills ?? []).map(entry => this.toAgentSkillsDescriptor(marketplace, entry)));
			return descriptors.filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private async toAgentSkillsDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: IAgentSkillsEntry): Promise<IAIExtensionDescriptor | undefined> {
		const slug = entry.slug || entry.name;
		if (!entry.name || !slug) {
			return undefined;
		}
		const repo = entry.github_json?.owner && entry.github_json.repo ? `${entry.github_json.owner}/${entry.github_json.repo}` : undefined;
		const candidates = repo ? agentSkillsRawCandidates(repo, slug) : [];
		const name = entry.name;
		const description = entry.description || entry.github_json?.description || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace.");
		const installCommand = entry.metadata?.install_command;
		return {
			id: `marketplace.skill.${stableName(marketplace.label)}.${stableName(entry.id ?? slug)}`,
			name,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: `https://agentskills.to/skills/${encodeURIComponent(slug)}`,
			author: agentSkillsAuthor(entry) ?? entry.github_json?.owner,
			category: entry.categories?.name ?? entry.category,
			homepage: repo ? `https://github.com/${repo}` : undefined,
			iconUrl: repo ? githubAvatarUrl(repo) : undefined,
			downloadCount: readCount(entry.total_install) ?? readCount(entry.weekly_install),
			starCount: readCount(entry.github_json?.stars),
			type: 'skill',
			description,
			risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
			installable: candidates.length > 0,
			installState: candidates.length > 0 ? 'notInstalled' : 'viewOnly',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: [marketplace.label, repo, installCommand, candidates[0]].filter(isNonEmptyString).join(' / '),
			sourceMetadata: createRemoteSkillSourceMetadata(candidates),
			contributions: {},
		};
	}

	private async fetchSkillWikiMarketplace(marketplace: IRemoteMarketplaceDefinition): Promise<readonly IAIExtensionDescriptor[]> {
		if (!marketplace.endpoint) {
			return [];
		}
		try {
			const context = await this.fetchMarketplaceResource(marketplace.endpoint, 'aiExtensions.fetchSkillWiki');
			if (context.res.statusCode !== 200) {
				this.logService.debug(`[AIExtensions] ${marketplace.endpoint} returned ${context.res.statusCode}`);
				return [];
			}
			const entries = parseSkillWikiXml(await asText(context) ?? '');
			const descriptors = await Promise.all(entries.map(entry => this.toSkillWikiDescriptor(marketplace, entry)));
			return descriptors.filter(isDefined);
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch ${marketplace.endpoint}`, err);
			return [];
		}
	}

	private async toSkillWikiDescriptor(marketplace: IRemoteMarketplaceDefinition, entry: ISkillWikiEntry): Promise<IAIExtensionDescriptor | undefined> {
		if (!entry.name || !entry.location) {
			return undefined;
		}
		const path = skillWikiPathFromLocation(entry.location);
		const candidates = [entry.location];
		const name = entry.name;
		const description = entry.description || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace.");
		return {
			id: `marketplace.skill.${stableName(marketplace.label)}.${stableName(path ?? entry.name)}`,
			name,
			source: marketplace.provider,
			sourceLabel: marketplace.label,
			marketplaceUrl: path ? `https://skillwiki.ai/skills/${path}` : 'https://skillwiki.ai/',
			author: 'SkillWiki',
			category: [entry.domain, entry.tags].filter(isNonEmptyString).join(' / ') || undefined,
			homepage: 'https://github.com/sophgen/skillwiki',
			iconUrl: githubAvatarUrl('sophgen/skillwiki'),
			type: 'skill',
			description,
			risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
			installable: true,
			installState: 'notInstalled',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: `${marketplace.label} / ${entry.location}`,
			sourceMetadata: createRemoteSkillSourceMetadata(candidates),
			contributions: {},
		};
	}

	private async toRemoteSkillDescriptors(marketplace: IRemoteMarketplaceDefinition, label: string, marketplaceUrl: string, entry: IRemoteMarketplaceEntry): Promise<readonly IAIExtensionDescriptor[]> {
		const skills = entry.skills ?? [];
		if (!skills.length) {
			return [];
		}
		const descriptors = await Promise.all(skills.map(async skillPath => {
			const candidates = remoteSkillCandidates(marketplace, skillPath);
			const name = skillNameFromPath(skillPath);
			const description = entry.description || localize('aiExtensions.remoteSkill.description', "Skill from an accessible marketplace.");
			return {
				id: `marketplace.skill.${stableName(label)}.${stableName(name)}`,
				name,
				version: entry.version,
				source: marketplace.provider,
				sourceLabel: label,
				marketplaceUrl,
				author: entry.author?.name,
				category: entry.category,
				homepage: entry.homepage,
				iconUrl: resolveIconUrl(marketplace.repo, entry),
				downloadCount: readDownloadCount(entry),
				starCount: readStarCount(entry),
				type: 'skill',
				description,
				risk: localize('aiExtensions.remoteSkill.risk', "Skills provide instructions and resources; review the source before installing."),
				installable: candidates.length > 0,
				installState: candidates.length > 0 ? 'notInstalled' : 'viewOnly',
				installedByIde: false,
				enabled: false,
				installScope: 'profile',
				updateState: 'unknown',
				syncStatus: 'notSynced',
				needsRuntimeRefresh: false,
				detail: `${label} / ${entry.name ?? name} / ${skillPath}`,
				sourceMetadata: createRemoteSkillSourceMetadata(candidates),
				contributions: {},
			} satisfies IAIExtensionDescriptor;
		}));
		return descriptors;
	}

	private async fetchFirstSkillCandidate(urls: readonly string[]): Promise<{ readonly url?: string; readonly skill: { readonly name?: string; readonly description?: string; readonly content?: string } }> {
		for (const url of urls) {
			const skill = await this.fetchSkillFromUrl(url);
			if (skill.content) {
				return { url, skill };
			}
		}
		return { skill: {} };
	}

	private async fetchSkillFromUrl(url: string): Promise<{ readonly name?: string; readonly description?: string; readonly content?: string }> {
		try {
			const context = await this.fetchMarketplaceResource(url, 'aiExtensions.fetchSkill');
			if (context.res.statusCode !== 200) {
				return {};
			}
			const content = await asText(context) ?? '';
			return { ...parseSkillHeader(content), content };
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch skill ${url}`, err);
			return {};
		}
	}

	private async toRemotePluginDescriptor(marketplace: IRemoteMarketplaceDefinition, label: string, marketplaceUrl: string, entry: IRemoteMarketplaceEntry): Promise<IAIExtensionDescriptor | undefined> {
		if (!entry.name) {
			return undefined;
		}
		return {
			id: `marketplace.plugin.${stableName(label)}.${stableName(entry.name)}`,
			name: entry.name,
			version: entry.version,
			source: marketplace.provider,
			sourceLabel: label,
			marketplaceUrl,
			author: entry.author?.name,
			category: entry.category,
			homepage: entry.homepage,
			iconUrl: resolveIconUrl(marketplace.repo, entry),
			downloadCount: readDownloadCount(entry),
			starCount: readStarCount(entry),
			type: 'plugin',
			description: entry.description || localize('aiExtensions.plugin.description', "Plugin from an accessible marketplace."),
			risk: localize('aiExtensions.plugin.risk', "Plugins may execute code. Installed plugins stay disabled by default for now."),
			installable: true,
			installState: 'notInstalled',
			installedByIde: false,
			enabled: false,
			installScope: 'profile',
			updateState: 'unknown',
			syncStatus: 'notSynced',
			needsRuntimeRefresh: false,
			detail: sourceLabelFromRemoteEntry(entry) || label,
			sourceMetadata: {
				source: entry.source,
				marketplaceRepo: marketplace.repo,
			} satisfies IRemotePluginSourceMetadata,
			contributions: {
				plugins: [{ name: entry.name }],
			},
		};
	}

	private toDescriptor(item: IStoredAIExtension): IAIExtensionDescriptor {
		return {
			id: item.id,
			name: item.name,
			version: item.version,
			source: item.source,
			sourceLabel: item.sourceLabel,
			marketplaceUrl: item.marketplaceUrl,
			author: item.author,
			category: item.category,
			homepage: item.homepage,
			iconUrl: item.iconUrl,
			downloadCount: item.downloadCount,
			starCount: item.starCount,
			type: item.type,
			description: item.description,
			risk: item.risk,
			installable: true,
			installState: 'installed',
			installedByIde: true,
			enabled: item.enabled,
			trusted: item.trusted,
			installScope: 'profile',
			updateState: 'latest',
			syncStatus: item.syncState.status,
			syncError: item.syncState.error,
			lastSyncedAt: item.syncState.syncedAt,
			needsRuntimeRefresh: item.enabled && item.syncState.status === 'success',
			detail: item.detail,
			sourceMetadata: item.sourceMetadata,
			contributions: item.contributions,
		};
	}

	private extensionRootForItem(root: URI, item: IStoredAIExtension): URI {
		return joinPath(root, 'extensions', stableName(item.id));
	}

	private async resolveInstallDescriptor(item: IAIExtensionDescriptor): Promise<IAIExtensionDescriptor> {
		if (item.type === 'skill' && !hasLoadableContributions(item)) {
			const metadata = remoteSkillSourceMetadata(item.sourceMetadata);
			const raw = await this.fetchFirstSkillCandidate(metadata?.skillCandidates ?? []);
			if (!raw.skill.content) {
				return item;
			}
			const name = raw.skill.name || item.name;
			return {
				...item,
				name,
				description: raw.skill.description || item.description,
				detail: raw.url ? `${item.detail ?? item.sourceLabel} / ${raw.url}` : item.detail,
				contributions: {
					skills: [{
						name,
						content: raw.skill.content,
					}],
				},
			};
		}
		if (item.type !== 'plugin' || hasLoadableContributions(item)) {
			return item;
		}
		const bundle = await this.fetchClaudePluginBundle(item);
		if (!hasContributions(bundle)) {
			return item;
		}
		return {
			...item,
			contributions: bundle,
		};
	}

	private async fetchClaudePluginBundle(item: IAIExtensionDescriptor): Promise<IAIExtensionDescriptor['contributions']> {
		const metadata = remotePluginSourceMetadata(item.sourceMetadata);
		const source = metadata?.source;
		const repo = remotePluginGitHubRepo(source, item.homepage);
		if (!repo) {
			return {};
		}
		const ref = typeof source === 'object' ? source.sha || source.ref || 'HEAD' : 'HEAD';
		const skills = await this.fetchClaudePluginSkills(repo, ref, item.name);
		const mcp = await this.fetchClaudePluginMcp(repo, ref);
		return {
			...(skills.length ? { skills } : {}),
			...(mcp.servers.length ? { mcp: mcp.servers } : {}),
			...(mcp.files.length ? { files: mcp.files } : {}),
		};
	}

	private async fetchClaudePluginSkills(repo: string, ref: string, name: string): Promise<NonNullable<IAIExtensionDescriptor['contributions']['skills']>> {
		const candidates = claudePluginSkillCandidates(repo, ref, name);
		const raw = await this.fetchFirstSkillCandidate(candidates);
		if (!raw.skill.content) {
			return [];
		}
		return [{
			name: raw.skill.name || name,
			content: raw.skill.content,
		}];
	}

	private async fetchClaudePluginMcp(repo: string, ref: string): Promise<{
		readonly servers: NonNullable<IAIExtensionDescriptor['contributions']['mcp']>;
		readonly files: NonNullable<IAIExtensionDescriptor['contributions']['files']>;
	}> {
		const json = await this.fetchJsonFromUrl<IClaudePluginMcpJson>(`https://raw.githubusercontent.com/${repo}/${ref}/.mcp.json`);
		const servers: IAIExtensionMcpContribution[] = [];
		const files = new Map<string, string>();
		for (const [name, server] of Object.entries(json?.mcpServers ?? {})) {
			if (!server.command) {
				continue;
			}
			const args = (server.args ?? []).map(arg => normalizeClaudePluginRootPath(arg) ?? arg);
			const referenced = [
				normalizeClaudePluginRootPath(server.command),
				...args.map(arg => normalizeClaudePluginRootPath(arg)),
			].filter(isDefined);
			for (const path of referenced) {
				await this.fetchClaudePluginFile(repo, ref, path, files);
				const dirname = parentPath(path);
				if (dirname) {
					await this.fetchClaudePluginFile(repo, ref, `${dirname}/package.json`, files);
				}
			}
			servers.push({
				name,
				config: {
					type: McpServerType.LOCAL,
					command: normalizeClaudePluginRootPath(server.command) ?? server.command,
					args,
					env: server.env,
					cwd: '${AI_EXTENSION_ROOT}',
				},
			});
		}
		return { servers, files: [...files.entries()].map(([path, content]) => ({ path, content })) };
	}

	private async fetchClaudePluginFile(repo: string, ref: string, path: string, files: Map<string, string>): Promise<void> {
		const safePath = safeContributionPath(path);
		if (!safePath || files.has(safePath)) {
			return;
		}
		const content = await this.fetchTextFromUrl(`https://raw.githubusercontent.com/${repo}/${ref}/${safePath}`);
		if (content !== undefined) {
			files.set(safePath, content);
		}
	}

	private async fetchTextFromUrl(url: string): Promise<string | undefined> {
		try {
			const context = await this.fetchMarketplaceResource(url, 'aiExtensions.fetchText');
			if (context.res.statusCode !== 200) {
				return undefined;
			}
			return await asText(context) ?? '';
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch text ${url}`, err);
			return undefined;
		}
	}

	private async fetchJsonFromUrl<T>(url: string): Promise<T | undefined> {
		try {
			const context = await this.fetchMarketplaceResource(url, 'aiExtensions.fetchJson');
			if (context.res.statusCode !== 200) {
				return undefined;
			}
			return await asJson<T>(context) ?? undefined;
		} catch (err) {
			this.logService.debug(`[AIExtensions] Failed to fetch json ${url}`, err);
			return undefined;
		}
	}

	private installRoot(): URI {
		const profile = this.profileService.currentProfile;
		const root = profile.isDefault ? profile.agentPluginsHome : joinPath(profile.location, 'agent-plugins');
		return joinPath(root, 'ai-extensions-ide');
	}

	private async readInstalled(): Promise<readonly IStoredAIExtension[]> {
		const raw = await this.readText(joinPath(this.installRoot(), InstalledRegistryName)).catch(() => undefined);
		if (!raw) {
			return [];
		}
		try {
			const parsed = JSON.parse(raw) as Partial<IStoredRegistry>;
			if (parsed.version !== InstalledRegistryVersion || !Array.isArray(parsed.items)) {
				return [];
			}
			return parsed.items.filter(isStoredAIExtension).map(normalizeStoredAIExtension);
		} catch (err) {
			this.logService.warn('[AIExtensions] Failed to parse installed registry', err);
			return [];
		}
	}

	private async writeInstalled(items: readonly IStoredAIExtension[]): Promise<void> {
		await this.writeText(joinPath(this.installRoot(), InstalledRegistryName), JSON.stringify({
			version: InstalledRegistryVersion,
			items,
		}, null, 2));
	}

	private async writeSourceManifest(item: IStoredAIExtension): Promise<void> {
		await this.writeText(joinPath(this.installRoot(), 'sources', 'local', stableName(item.id), 'manifest.json'), JSON.stringify(item, null, 2));
	}

	private async deleteSource(id: string): Promise<void> {
		await this.fileService.del(joinPath(this.installRoot(), 'sources', 'local', stableName(id)), { recursive: true, useTrash: false }).catch(() => undefined);
	}

	private async writeSyncState(state: unknown): Promise<void> {
		await this.writeText(joinPath(this.installRoot(), StateFolderName, SyncStateName), JSON.stringify(state, null, 2));
	}

	private async replaceOverlay(tempConfigDir: URI, configDir: URI, tempConfigFile: URI, configFile: URI): Promise<void> {
		const backupConfigDir = joinPath(dirname(configDir), OverlayBackupSegment);
		const backupConfigFile = joinPath(dirname(configFile), ConfigBackupName);
		const hadConfigDir = await this.fileService.exists(configDir);
		const hadConfigFile = await this.fileService.exists(configFile);
		await this.fileService.del(backupConfigDir, { recursive: true, useTrash: false }).catch(() => undefined);
		await this.fileService.del(backupConfigFile, { useTrash: false }).catch(() => undefined);
		let backedUpConfigDir = false;
		let backedUpConfigFile = false;
		try {
			if (hadConfigDir) {
				await this.fileService.move(configDir, backupConfigDir, true);
				backedUpConfigDir = true;
			}
			if (hadConfigFile) {
				await this.fileService.move(configFile, backupConfigFile, true);
				backedUpConfigFile = true;
			}
			await this.fileService.move(tempConfigDir, configDir, true);
			await this.fileService.move(tempConfigFile, configFile, true);
			await this.fileService.del(backupConfigDir, { recursive: true, useTrash: false }).catch(() => undefined);
			await this.fileService.del(backupConfigFile, { useTrash: false }).catch(() => undefined);
		} catch (err) {
			await this.fileService.del(configDir, { recursive: true, useTrash: false }).catch(() => undefined);
			await this.fileService.del(configFile, { useTrash: false }).catch(() => undefined);
			if (backedUpConfigDir) {
				await this.fileService.move(backupConfigDir, configDir, true).catch(() => undefined);
			}
			if (backedUpConfigFile) {
				await this.fileService.move(backupConfigFile, configFile, true).catch(() => undefined);
			}
			throw err;
		}
	}

	private async readText(uri: URI): Promise<string> {
		const content = await this.fileService.readFile(uri);
		return content.value.toString();
	}

	private async writeText(uri: URI, text: string): Promise<void> {
		await this.ensureFolder(dirname(uri));
		await this.fileService.writeFile(uri, VSBuffer.fromString(text));
	}

	private async ensureFolder(uri: URI): Promise<void> {
		await this.fileService.createFolder(uri);
	}

	private assertUnique(names: Set<string>, key: string): void {
		if (names.has(key)) {
			throw new Error(localize('aiExtensions.sync.conflict', "AI extension overlay has a duplicate capability name: {0}", key));
		}
		names.add(key);
	}
}

registerSingleton(IAIExtensionsWorkbenchService, AIExtensionsWorkbenchService, InstantiationType.Delayed);

function compareDescriptors(a: IAIExtensionDescriptor, b: IAIExtensionDescriptor): number {
	const typeRank = typeWeight(a.type) - typeWeight(b.type);
	if (typeRank !== 0) {
		return typeRank;
	}
	const sourceRank = sourceWeight(a.source) - sourceWeight(b.source);
	if (sourceRank !== 0) {
		return sourceRank;
	}
	const popularityRank = popularityScore(b) - popularityScore(a);
	if (popularityRank !== 0) {
		return popularityRank;
	}
	return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
}

function typeWeight(type: IAIExtensionDescriptor['type']): number {
	switch (type) {
		case 'skill':
			return 0;
		case 'plugin':
			return 1;
		case 'mcp':
			return 2;
	}
}

function sourceWeight(source: AIExtensionSource): number {
	switch (source) {
		case 'codex':
			return 0;
		case 'claude':
			return 1;
		case 'opencode':
			return 2;
	}
}

function stableName(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
	return normalized || 'extension';
}

function popularityScore(item: IAIExtensionDescriptor): number {
	return item.downloadCount ?? item.starCount ?? 0;
}

function createSourceMetadata(item: IAIExtensionDescriptor): unknown {
	return {
		sourceUri: item.sourceUri?.toString(),
		sourceMetadata: item.sourceMetadata,
		detail: item.detail,
		marketplaceUrl: item.marketplaceUrl,
		author: item.author,
		category: item.category,
		homepage: item.homepage,
		iconUrl: item.iconUrl,
		downloadCount: item.downloadCount,
		starCount: item.starCount,
	};
}

function defaultEnablement(item: IAIExtensionDescriptor): boolean {
	if (item.type !== 'plugin') {
		return true;
	}
	return !hasRuntimePluginContribution(item) && hasLoadableContributions(item);
}

function hasRuntimePluginContribution(item: IAIExtensionDescriptor | IStoredAIExtension): boolean {
	return (item.contributions.plugins ?? []).some(plugin => !!plugin.content || !!plugin.npm);
}

function hasLoadableContributions(item: IAIExtensionDescriptor): boolean {
	return hasContributions(item.contributions);
}

function hasContributions(contributions: IAIExtensionDescriptor['contributions']): boolean {
	return !!(
		contributions.skills?.length
		|| contributions.mcp?.length
		|| contributions.files?.length
		|| contributions.plugins?.some(plugin => !!plugin.content || !!plugin.npm)
	);
}

function readDownloadCount(entry: IRemoteMarketplaceEntry): number | undefined {
	return readCount(entry.downloadCount)
		?? readCount(entry.downloads)
		?? readCount(entry.installCount)
		?? readCount(entry.installs);
}

function readStarCount(entry: IRemoteMarketplaceEntry): number | undefined {
	return readCount(entry.starCount)
		?? readCount(entry.stars)
		?? readCount(entry.stargazerCount)
		?? readCount(entry.stargazers);
}

function readCount(value: number | string | undefined): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.replace(/,/g, '').trim().toLowerCase();
	const suffix = normalized.endsWith('m') ? 1_000_000 : normalized.endsWith('k') ? 1_000 : 1;
	const parsed = Number(normalized.replace(/[km]$/, ''));
	return Number.isFinite(parsed) ? Math.round(parsed * suffix) : undefined;
}

function parseSkillHeader(content: string): { readonly name?: string; readonly description?: string } {
	const match = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/.exec(content);
	if (!match?.groups?.['body']) {
		return {};
	}
	const result: { name?: string; description?: string } = {};
	for (const line of match.groups['body'].split(/\r?\n/)) {
		const colon = line.indexOf(':');
		if (colon <= 0) {
			continue;
		}
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '');
		if (key === 'name') {
			result.name = value;
		}
		if (key === 'description') {
			result.description = value;
		}
	}
	return result;
}

function normalizeMarketplacePath(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/g, '');
}

function skillNameFromPath(value: string): string {
	const normalized = normalizeMarketplacePath(value);
	return normalized.split('/').filter(Boolean).at(-1) ?? 'skill';
}

function sourceLabelFromRemoteEntry(entry: IRemoteMarketplaceEntry): string | undefined {
	if (typeof entry.source === 'string') {
		return entry.source;
	}
	if (!entry.source) {
		return undefined;
	}
	if (entry.source.repo) {
		return entry.source.path ? `${entry.source.repo}/${entry.source.path}` : entry.source.repo;
	}
	if (entry.source.url) {
		return entry.source.path ? `${entry.source.url}/${entry.source.path}` : entry.source.url;
	}
	return entry.source.path;
}

function resolveIconUrl(fallbackRepo: string | undefined, entry: IRemoteMarketplaceEntry): string | undefined {
	const explicit = entry.icon ?? entry.logo;
	if (explicit?.startsWith('http://') || explicit?.startsWith('https://')) {
		return explicit;
	}
	const repo = remoteEntryGitHubRepo(entry) ?? fallbackRepo;
	return repo ? githubAvatarUrl(repo) : undefined;
}

function remoteEntryGitHubRepo(entry: IRemoteMarketplaceEntry): string | undefined {
	if (typeof entry.source !== 'string' && entry.source?.repo) {
		return entry.source.repo;
	}
	const url = typeof entry.source !== 'string' ? entry.source?.url : undefined;
	return githubRepoFromUrl(url) ?? githubRepoFromUrl(entry.homepage);
}

function remotePluginGitHubRepo(source: string | IRemoteMarketplaceSource | undefined, homepage: string | undefined): string | undefined {
	if (typeof source === 'string') {
		return githubRepoFromUrl(source) ?? githubRepoFromUrl(homepage);
	}
	return githubRepoFromUrl(source?.url) ?? source?.repo ?? githubRepoFromUrl(homepage);
}

function githubRawUrlFromTree(value: string, branchOverride: string | undefined, skillFilePath: string | undefined): string | undefined {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:\/(tree|blob)\/([^/#?]+)\/?([^#?]*))?/i.exec(value.replace(/\.git$/i, ''));
	if (!match) {
		return undefined;
	}
	const repo = `${match[1]}/${match[2]}`;
	const branch = branchOverride || match[4] || 'HEAD';
	const basePath = normalizeMarketplacePath(match[5] ?? '');
	const path = normalizeMarketplacePath(skillFilePath ?? 'SKILL.md');
	const fullPath = basePath.endsWith('/SKILL.md') || basePath === 'SKILL.md'
		? basePath
		: normalizeMarketplacePath(`${basePath}/${path}`);
	return fullPath ? `https://raw.githubusercontent.com/${repo}/${branch}/${fullPath}` : undefined;
}

function claudePluginSkillCandidates(repo: string, ref: string, name: string): readonly string[] {
	const candidates = new Set<string>();
	for (const path of [
		`skills/${name}/SKILL.md`,
		`skills/${stableName(name)}/SKILL.md`,
		`.claude/skills/${name}/SKILL.md`,
		`.claude/skills/${stableName(name)}/SKILL.md`,
	]) {
		candidates.add(`https://raw.githubusercontent.com/${repo}/${ref}/${normalizeMarketplacePath(path)}`);
	}
	return [...candidates];
}

function remoteSkillCandidates(marketplace: IRemoteMarketplaceDefinition, skillPath: string): readonly string[] {
	if (!marketplace.repo) {
		return [];
	}
	const normalized = normalizeMarketplacePath(skillPath);
	return normalized ? [`https://raw.githubusercontent.com/${marketplace.repo}/main/${normalized}/SKILL.md`] : [];
}

function skillsPubRawCandidates(repositoryUrl: string, skillName: string, skillId: string | undefined): readonly string[] {
	const repo = githubRepoFromUrl(repositoryUrl);
	if (!repo) {
		return [];
	}
	const candidates = new Set<string>();
	for (const path of skillsPubPathCandidates(skillName, skillId)) {
		candidates.add(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`);
	}
	return [...candidates];
}

function skilleryRawCandidates(repo: string, branch: string, skillPath: string): readonly string[] {
	const path = normalizeMarketplacePath(skillPath);
	const candidates = new Set<string>();
	candidates.add(`https://raw.githubusercontent.com/${repo}/${branch}/${path}`);
	if (branch !== 'HEAD') {
		candidates.add(`https://raw.githubusercontent.com/${repo}/HEAD/${path}`);
	}
	return [...candidates];
}

function agentSkillsRawCandidates(repo: string, slug: string): readonly string[] {
	const safeSlug = normalizeMarketplacePath(slug);
	return [
		`https://raw.githubusercontent.com/${repo}/main/skills/${safeSlug}/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/HEAD/skills/${safeSlug}/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/main/.agents/skills/${safeSlug}/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/HEAD/.agents/skills/${safeSlug}/SKILL.md`,
	];
}

function agentSkillsAuthor(entry: IAgentSkillsEntry): string | undefined {
	if (typeof entry.author === 'string') {
		return entry.author;
	}
	return entry.author?.name;
}

function parseSkillWikiXml(xml: string): readonly ISkillWikiEntry[] {
	if (!xml.trim()) {
		return [];
	}
	return [...xml.matchAll(/<skill>\s*([\s\S]*?)\s*<\/skill>/g)].map(match => ({
		name: textFromXmlBlock(match[1], 'name'),
		description: textFromXmlBlock(match[1], 'description'),
		domain: textFromXmlBlock(match[1], 'domain'),
		tags: textFromXmlBlock(match[1], 'tags'),
		location: textFromXmlBlock(match[1], 'location'),
	}));
}

function textFromXmlBlock(block: string, tagName: string): string | undefined {
	const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(block);
	const text = match?.[1] ? decodeXmlText(match[1]).trim() : undefined;
	return text || undefined;
}

function decodeXmlText(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, '\'')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function skillWikiPathFromLocation(location: string): string | undefined {
	const match = /\/skills\/([^?#]+)\/SKILL\.md$/i.exec(location);
	return match?.[1] ? normalizeMarketplacePath(match[1]) : undefined;
}

function skillsPubPathCandidates(skillName: string, skillId: string | undefined): readonly string[] {
	const paths = new Set<string>();
	const encodedPath = skillId?.split('::')[2];
	const inferred = encodedPath ? skillsPubEncodedPath(encodedPath) : undefined;
	if (inferred) {
		paths.add(inferred);
	}
	const safeName = normalizeMarketplacePath(skillName);
	paths.add(`skills/${safeName}/SKILL.md`);
	paths.add(`.claude/skills/${safeName}/SKILL.md`);
	paths.add(`.agents/skills/${safeName}/SKILL.md`);
	paths.add(`.cursor/skills/${safeName}/SKILL.md`);
	return [...paths];
}

function skillsPubEncodedPath(value: string): string | undefined {
	const normalized = value.replace(/^[-/]+/, '');
	const prefixes: readonly [string, string][] = [
		['claude-skills-', '.claude/skills/'],
		['agents-skills-', '.agents/skills/'],
		['cursor-skills-', '.cursor/skills/'],
		['skills-', 'skills/'],
	];
	for (const [prefix, pathPrefix] of prefixes) {
		if (normalized.startsWith(prefix)) {
			return `${pathPrefix}${normalized.slice(prefix.length)}/SKILL.md`;
		}
	}
	return undefined;
}

function githubRepoFromUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i.exec(value.replace(/\.git$/i, ''));
	if (!match) {
		return undefined;
	}
	return `${match[1]}/${match[2]}`;
}

function githubAvatarUrl(repo: string): string | undefined {
	const owner = repo.split('/')[0];
	return owner ? `https://github.com/${owner}.png?size=64` : undefined;
}

function isHttpsUrl(value: string | undefined): value is string {
	return typeof value === 'string' && /^https:\/\//i.test(value);
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}

function isNonEmptyString(value: string | undefined): value is string {
	return typeof value === 'string' && value.length > 0;
}

function toOpenCodeMcpConfig(server: IAIExtensionMcpContribution, extensionRoot?: string): unknown {
	if (server.config.type === McpServerType.LOCAL) {
		return {
			type: 'local',
			command: [
				resolveAIExtensionRoot(server.config.command, extensionRoot),
				...(server.config.args ?? []).map(arg => resolveAIExtensionRoot(arg, extensionRoot)),
			],
			...(server.config.env ? { environment: server.config.env } : {}),
			...(server.config.cwd ? { cwd: resolveAIExtensionRoot(server.config.cwd, extensionRoot) } : {}),
		};
	}
	return {
		type: 'remote',
		url: server.config.url,
		...(server.config.headers ? { headers: server.config.headers } : {}),
	};
}

function resolveAIExtensionRoot(value: string, extensionRoot: string | undefined): string {
	if (!extensionRoot) {
		return value;
	}
	return value.replace(/\$\{AI_EXTENSION_ROOT\}/g, extensionRoot);
}

function normalizeClaudePluginRootPath(value: string): string | undefined {
	const normalized = value.replace(/\\/g, '/');
	const marker = '${CLAUDE_PLUGIN_ROOT}/';
	if (!normalized.startsWith(marker)) {
		return undefined;
	}
	return safeContributionPath(normalized.slice(marker.length));
}

function safeContributionPath(value: string): string | undefined {
	const normalized = normalizeMarketplacePath(value);
	const parts = normalized.split('/').filter(Boolean);
	if (!parts.length || parts.some(part => part === '..' || part === '.')) {
		return undefined;
	}
	return parts.join('/');
}

function parentPath(value: string): string | undefined {
	const normalized = safeContributionPath(value);
	if (!normalized) {
		return undefined;
	}
	const index = normalized.lastIndexOf('/');
	return index > 0 ? normalized.slice(0, index) : undefined;
}

function isRemotePluginSourceMetadata(value: unknown): value is IRemotePluginSourceMetadata {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<IRemotePluginSourceMetadata>;
	return candidate.source !== undefined || typeof candidate.marketplaceRepo === 'string';
}

function createRemoteSkillSourceMetadata(skillCandidates: readonly string[]): IRemoteSkillSourceMetadata | undefined {
	return skillCandidates.length ? { skillCandidates } : undefined;
}

function isRemoteSkillSourceMetadata(value: unknown): value is IRemoteSkillSourceMetadata {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<IRemoteSkillSourceMetadata>;
	return candidate.skillCandidates === undefined
		|| (Array.isArray(candidate.skillCandidates) && candidate.skillCandidates.every(item => typeof item === 'string'));
}

function remoteSkillSourceMetadata(value: unknown): IRemoteSkillSourceMetadata | undefined {
	if (isRemoteSkillSourceMetadata(value) && value.skillCandidates) {
		return value;
	}
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const nested = (value as { readonly sourceMetadata?: unknown }).sourceMetadata;
	return isRemoteSkillSourceMetadata(nested) ? nested : undefined;
}

function remotePluginSourceMetadata(value: unknown): IRemotePluginSourceMetadata | undefined {
	if (isRemotePluginSourceMetadata(value)) {
		return value;
	}
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const nested = (value as { readonly sourceMetadata?: unknown }).sourceMetadata;
	return isRemotePluginSourceMetadata(nested) ? nested : undefined;
}

function getErrorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isStoredAIExtension(value: unknown): value is IStoredAIExtension {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const item = value as Partial<IStoredAIExtension>;
	return typeof item.id === 'string'
		&& typeof item.name === 'string'
		&& (item.type === 'skill' || item.type === 'plugin' || item.type === 'mcp')
		&& (item.source === 'codex' || item.source === 'claude' || item.source === 'opencode')
		&& typeof item.sourceLabel === 'string'
		&& typeof item.description === 'string'
		&& typeof item.risk === 'string'
		&& typeof item.enabled === 'boolean'
		&& (typeof item.trusted === 'boolean' || item.trusted === undefined)
		&& (isSyncState(item.syncState) || item.syncState === undefined)
		&& typeof item.installedAt === 'number'
		&& typeof item.updatedAt === 'number'
		&& !!item.contributions
		&& typeof item.contributions === 'object';
}

function isSyncState(value: unknown): value is IAIExtensionSyncState {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const state = value as Partial<IAIExtensionSyncState>;
	return (state.status === 'pending' || state.status === 'success' || state.status === 'failed')
		&& (state.syncedAt === undefined || typeof state.syncedAt === 'number')
		&& (state.error === undefined || typeof state.error === 'string');
}

function normalizeStoredAIExtension(item: IStoredAIExtension): IStoredAIExtension {
	return {
		...item,
		trusted: item.trusted ?? item.type === 'skill',
		syncState: item.syncState ?? { status: 'pending' },
	};
}
