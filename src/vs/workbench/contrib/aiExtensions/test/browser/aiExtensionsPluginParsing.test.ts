/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { claudePluginDeclaredSkillPaths, claudePluginMcpServers, githubDirectoryPaths, githubRepositorySlug } from '../../browser/aiExtensionsPluginParsing.js';

suite('AI Extensions plugin parsing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads skill directories from GitHub embedded tree data', () => {
		const html = `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
			payload: {
				codeViewTreeRoute: {
					tree: {
						items: [
							{ path: 'plugins/example/skills/first', contentType: 'directory' },
							{ path: 'plugins/example/skills/README.md', contentType: 'file' },
							{ path: 'plugins/example/skills/second', contentType: 'directory' },
						],
					},
				},
			},
		})}</script>`;

		assert.deepStrictEqual(githubDirectoryPaths(html), [
			'plugins/example/skills/first',
			'plugins/example/skills/second',
		]);
	});

	test('supports nested and direct Claude MCP configurations', () => {
		assert.deepStrictEqual(claudePluginMcpServers({
			mcpServers: {
				remote: { type: 'http', url: 'https://example.com/mcp' },
				local: { command: 'node', args: ['server.js'] },
			},
		}), {
			remote: { type: 'http', url: 'https://example.com/mcp' },
			local: { command: 'node', args: ['server.js'] },
		});

		assert.deepStrictEqual(claudePluginMcpServers({
			airtable: { type: 'http', url: 'https://mcp.airtable.com/mcp' },
			metadata: { description: 'ignored' },
		}), {
			airtable: { type: 'http', url: 'https://mcp.airtable.com/mcp' },
		});
	});

	test('rejects malformed Claude MCP configurations', () => {
		assert.deepStrictEqual(claudePluginMcpServers({
			badArgs: { command: 'node', args: 'server.js' },
			badEnv: { command: 'node', env: { TOKEN: 42 } },
			badHeaders: { url: 'https://example.com/mcp', headers: { Authorization: true } },
			ambiguous: { command: 'node', url: 'https://example.com/mcp' },
			emptyName: { command: '' },
			valid: { command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'value' } },
		}), {
			valid: { command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'value' } },
		});
	});

	test('accepts GitHub URLs and owner/repository slugs', () => {
		assert.strictEqual(githubRepositorySlug('https://github.com/42Crunch-AI/claude-plugins.git'), '42Crunch-AI/claude-plugins');
		assert.strictEqual(githubRepositorySlug('42Crunch-AI/claude-plugins'), '42Crunch-AI/claude-plugins');
		assert.strictEqual(githubRepositorySlug('gitlab.com/owner/repo'), undefined);
	});

	test('resolves declared skills relative to a source path that is already the skills root', () => {
		assert.deepStrictEqual(claudePluginDeclaredSkillPaths('packages/agent-skills', [
			'./netsuite-ai-connector-instructions',
			'./netsuite-sdf-roles-and-permissions/SKILL.md',
		]), [
			'packages/agent-skills/netsuite-ai-connector-instructions/SKILL.md',
			'packages/agent-skills/netsuite-sdf-roles-and-permissions/SKILL.md',
		]);
	});
});
