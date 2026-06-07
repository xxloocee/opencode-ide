/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IAIExtensionDescriptor } from '../common/aiExtensions.js';

export function typeLabel(type: IAIExtensionDescriptor['type']): string {
	switch (type) {
		case 'skill':
			return localize('aiExtensions.type.skill', "Skill");
		case 'plugin':
			return localize('aiExtensions.type.plugin', "Plugin");
		case 'mcp':
			return 'MCP';
	}
}

export function installStateLabel(item: IAIExtensionDescriptor): string {
	if (item.installedByIde) {
		return localize('aiExtensions.installState.installed', "Installed");
	}
	if (item.installState === 'viewOnly') {
		return localize('aiExtensions.installState.viewOnly', "View Only");
	}
	if (item.installState === 'unsupported') {
		return localize('aiExtensions.installState.unsupported', "Pending Support");
	}
	return localize('aiExtensions.installState.notInstalled', "Not Installed");
}

export function enablementLabel(item: IAIExtensionDescriptor): string {
	return item.enabled ? localize('aiExtensions.enabled', "Enabled") : localize('aiExtensions.disabled', "Disabled");
}

export function syncStateLabel(item: IAIExtensionDescriptor): string {
	switch (item.syncStatus) {
		case 'success':
			return localize('aiExtensions.syncState.success', "Applied");
		case 'failed':
			return localize('aiExtensions.syncState.failed', "Apply Failed");
		case 'pending':
			return localize('aiExtensions.syncState.pending', "Pending Apply");
		case 'notSynced':
			return localize('aiExtensions.syncState.notSynced', "Not Applied");
	}
}

export function updateStateLabel(item: IAIExtensionDescriptor): string {
	switch (item.updateState) {
		case 'available':
			return localize('aiExtensions.updateState.available', "Update Available");
		case 'latest':
			return localize('aiExtensions.updateState.latest', "Latest");
		case 'unknown':
			return localize('aiExtensions.updateState.unknown', "Unknown");
	}
}

export function contributionLines(item: IAIExtensionDescriptor): string[] {
	const lines: string[] = [];
	for (const skill of item.contributions.skills ?? []) {
		lines.push(`${localize('aiExtensions.type.skill', "Skill")}: ${skill.name}`);
	}
	for (const plugin of item.contributions.plugins ?? []) {
		lines.push(`${localize('aiExtensions.type.plugin', "Plugin")}: ${plugin.npm ?? plugin.name}`);
	}
	for (const server of item.contributions.mcp ?? []) {
		lines.push(`MCP: ${server.name}`);
	}
	return lines;
}
