/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IClaudePluginMcpServer {
	readonly type?: string;
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Record<string, string>;
	readonly cwd?: string;
	readonly url?: string;
	readonly headers?: Record<string, string>;
}

export function githubDirectoryPaths(html: string): readonly string[] {
	const embedded = /<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/.exec(html)?.[1];
	if (!embedded) {
		return [];
	}
	try {
		const parsed = JSON.parse(embedded) as {
			readonly payload?: {
				readonly codeViewTreeRoute?: {
					readonly tree?: {
						readonly items?: readonly { readonly path?: string; readonly contentType?: string }[];
					};
				};
			};
		};
		return (parsed.payload?.codeViewTreeRoute?.tree?.items ?? [])
			.filter((item): item is { readonly path: string; readonly contentType?: string } => item.contentType === 'directory' && !!item.path)
			.map(item => normalizeMarketplacePath(item.path));
	} catch {
		return [];
	}
}

export function claudePluginMcpServers(value: unknown): Record<string, IClaudePluginMcpServer> {
	if (!value || typeof value !== 'object') {
		return {};
	}
	const record = value as Record<string, unknown>;
	const nested = record['mcpServers'];
	const candidates = nested && typeof nested === 'object' ? nested as Record<string, unknown> : record;
	const result: Record<string, IClaudePluginMcpServer> = {};
	for (const [name, value] of Object.entries(candidates)) {
		const server = normalizeClaudePluginMcpServer(value);
		if (name.trim() && server) {
			result[name] = server;
		}
	}
	return result;
}

export function githubRepositorySlug(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.trim().replace(/\.git$/i, '');
	const url = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#].*)?$/i.exec(normalized);
	if (url) {
		return `${url[1]}/${url[2]}`;
	}
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : undefined;
}

export function claudePluginDeclaredSkillPaths(rootPath: string, declaredSkills: readonly string[]): readonly string[] {
	const result = new Set<string>();
	for (const declared of declaredSkills) {
		const normalizedRoot = normalizeMarketplacePath(rootPath);
		const normalizedDeclared = normalizeMarketplacePath(declared);
		const path = [normalizedRoot, normalizedDeclared].filter(Boolean).join('/');
		const parts = path.split('/').filter(Boolean);
		if (!parts.length || parts.some(part => part === '.' || part === '..')) {
			continue;
		}
		result.add(path.endsWith('/SKILL.md') || path === 'SKILL.md' ? path : `${path}/SKILL.md`);
	}
	return [...result];
}

function normalizeClaudePluginMcpServer(value: unknown): IClaudePluginMcpServer | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const server = value as Record<string, unknown>;
	const command = nonEmptyString(server['command']);
	const url = nonEmptyString(server['url']);
	if (!!command === !!url) {
		return undefined;
	}
	const args = stringArray(server['args']);
	const env = stringRecord(server['env']);
	const headers = stringRecord(server['headers']);
	if ((server['args'] !== undefined && !args)
		|| (server['env'] !== undefined && !env)
		|| (server['headers'] !== undefined && !headers)
		|| (server['cwd'] !== undefined && !nonEmptyString(server['cwd']))) {
		return undefined;
	}
	return {
		...(typeof server['type'] === 'string' ? { type: server['type'] } : {}),
		...(command ? { command } : {}),
		...(args ? { args } : {}),
		...(env ? { env } : {}),
		...(nonEmptyString(server['cwd']) ? { cwd: nonEmptyString(server['cwd']) } : {}),
		...(url ? { url } : {}),
		...(headers ? { headers } : {}),
	};
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
	return value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'string')) ? value as readonly string[] | undefined : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return Object.values(value).every(item => typeof item === 'string') ? value as Record<string, string> : undefined;
}

function normalizeMarketplacePath(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/g, '');
}
