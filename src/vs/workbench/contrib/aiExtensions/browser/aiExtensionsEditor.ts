/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IAIExtensionDescriptor, IAIExtensionsWorkbenchService } from '../common/aiExtensions.js';
import { contributionLines, enablementLabel, installStateLabel, syncStateLabel, typeLabel } from './aiExtensionsLabels.js';
import { AIExtensionEditorInput } from './aiExtensionsEditorInput.js';

interface IAIExtensionEditorTemplate {
	readonly root: HTMLElement;
}

export class AIExtensionEditor extends EditorPane {

	static readonly ID = 'workbench.editor.aiExtension';

	private template: IAIExtensionEditorTemplate | undefined;
	private dimension: Dimension | undefined;
	private actionButtons: HTMLButtonElement[] = [];
	private busy = false;
	private actionInProgress = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IAIExtensionsWorkbenchService private readonly aiExtensionsService: IAIExtensionsWorkbenchService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(AIExtensionEditor.ID, group, telemetryService, themeService, storageService);
		this._register(this.aiExtensionsService.onDidChange(() => {
			if (!this.actionInProgress) {
				void this.refreshCurrentInput();
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		const root = dom.append(parent, dom.$('.ai-extension-editor'));
		root.tabIndex = 0;
		root.setAttribute('role', 'document');
		this.template = { root };
	}

	override async setInput(input: AIExtensionEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this.render(input.item);
	}

	override focus(): void {
		super.focus();
		this.template?.root.focus();
	}

	layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.template?.root.classList.toggle('narrow', dimension.width < 640);
	}

	private async refreshCurrentInput(): Promise<void> {
		const input = this.input;
		if (!(input instanceof AIExtensionEditorInput)) {
			return;
		}
		const item = (await this.aiExtensionsService.list()).find(candidate => candidate.id === input.item.id) ?? input.item;
		if (this.input !== input) {
			return;
		}
		await this.render(item);
	}

	private async render(item: IAIExtensionDescriptor): Promise<void> {
		if (!this.template) {
			return;
		}
		const root = this.template.root;
		this.actionButtons = [];
		dom.clearNode(root);
		root.classList.toggle('narrow', this.dimension !== undefined && this.dimension.width < 640);
		root.setAttribute('aria-busy', String(this.busy));

		const header = dom.append(root, dom.$('.ai-extension-editor-header'));
		this.renderExtensionIcon(header, item);

		const details = dom.append(header, dom.$('.ai-extension-editor-title-area'));
		const title = dom.append(details, dom.$('h1.ai-extension-editor-title'));
		title.textContent = item.name;

		const meta = dom.append(details, dom.$('.ai-extension-editor-meta'));
		const metaParts = [
			typeLabel(item.type),
			item.sourceLabel,
			item.author,
		].filter(isNonEmptyString);
		meta.textContent = metaParts.join(' / ');

		const actions = dom.append(details, dom.$('.ai-extension-editor-actions'));
		this.renderActions(actions, item);

		const body = dom.append(root, dom.$('.ai-extension-editor-body'));
		const overview = dom.append(body, dom.$('.ai-extension-editor-overview'));
		this.renderStatus(overview, localize('aiExtensions.meta.install', "Install"), installStateLabel(item));
		this.renderStatus(overview, localize('aiExtensions.meta.enablement', "Enablement"), enablementLabel(item));
		this.renderStatus(overview, localize('aiExtensions.meta.scope', "Scope"), item.installScope === 'profile' ? localize('aiExtensions.scope.profile', "Current Profile") : localize('aiExtensions.scope.external', "Marketplace Source"));
		this.renderStatus(overview, localize('aiExtensions.meta.sync', "Apply State"), syncStateLabel(item));

		this.renderSection(body, localize('aiExtensions.detail.descriptionSummary', "Summary"), descriptionSummary(item), 'highlight');
		this.renderSection(body, localize('aiExtensions.detail.originalDescription', "Original Description"), item.description);
		this.renderSection(body, localize('aiExtensions.detail.risk', "Permissions and Install Notes"), item.syncError ?? item.risk);
		this.renderMetadataGrid(body, localize('aiExtensions.detail.sourceInfo', "Source Information"), metadataEntries(item));

		const contributions = contributionLines(item);
		if (contributions.length) {
			this.renderSection(body, localize('aiExtensions.detail.contributions', "Contributions"), contributions.join('\n'));
		}

		if (item.needsRuntimeRefresh) {
			const refresh = dom.append(body, dom.$('.ai-extension-editor-runtime-refresh'));
			refresh.textContent = localize('aiExtensions.runtimeRefresh', "The OpenCode runtime may need to refresh or reopen before this capability is loaded.");
		}
	}

	private renderExtensionIcon(container: HTMLElement, item: IAIExtensionDescriptor): void {
		const icon = dom.append(container, dom.$('.ai-extension-editor-icon'));
		if (item.iconUrl) {
			const image = dom.append(icon, dom.$('img.ai-extension-editor-icon-image')) as HTMLImageElement;
			image.src = item.iconUrl;
			image.alt = '';
			image.referrerPolicy = 'no-referrer';
			return;
		}
		icon.classList.add('codicon');
		icon.classList.add(iconClass(item));
	}

	private renderStatus(container: HTMLElement, label: string, value: string): void {
		const item = dom.append(container, dom.$('.ai-extension-editor-status-item'));
		const labelElement = dom.append(item, dom.$('.ai-extension-editor-status-label'));
		labelElement.textContent = label;
		const valueElement = dom.append(item, dom.$('.ai-extension-editor-status-value'));
		valueElement.textContent = value;
	}

	private renderSection(container: HTMLElement, label: string, text: string, variant?: 'highlight'): void {
		const section = dom.append(container, dom.$('section.ai-extension-editor-section'));
		section.classList.toggle('highlight', variant === 'highlight');
		const title = dom.append(section, dom.$('h2.ai-extension-editor-section-title'));
		title.textContent = label;
		const body = dom.append(section, dom.$('.ai-extension-editor-section-body'));
		body.textContent = text;
	}

	private renderMetadataGrid(container: HTMLElement, label: string, entries: readonly (readonly [string, string])[]): void {
		const section = dom.append(container, dom.$('section.ai-extension-editor-section.ai-extension-editor-source-info'));
		const title = dom.append(section, dom.$('h2.ai-extension-editor-section-title'));
		title.textContent = label;
		const grid = dom.append(section, dom.$('.ai-extension-editor-metadata-grid'));
		for (const [key, value] of entries) {
			const item = dom.append(grid, dom.$('.ai-extension-editor-metadata-item'));
			const keyElement = dom.append(item, dom.$('.ai-extension-editor-metadata-key'));
			keyElement.textContent = key;
			const valueElement = dom.append(item, dom.$('.ai-extension-editor-metadata-value'));
			valueElement.textContent = value;
		}
	}

	private renderActions(container: HTMLElement, item: IAIExtensionDescriptor): void {
		if (!item.installedByIde && item.installable) {
			this.renderAction(container, item.id, 'install', localize('aiExtensions.action.install', "Install"));
		}
		if (item.installedByIde) {
			if (!item.trusted) {
				this.renderAction(container, item.id, 'trust', localize('aiExtensions.action.trust', "Trust Source"));
			} else if (item.type === 'plugin' && hasRuntimePluginContribution(item)) {
				const unsupported = dom.append(container, dom.$('span.ai-extension-editor-action-note'));
				unsupported.textContent = localize('aiExtensions.action.pluginRuntimeDeferred', "Plugin runtime support is pending");
			} else {
				this.renderAction(container, item.id, item.enabled ? 'disable' : 'enable', item.enabled ? localize('aiExtensions.action.disable', "Disable") : localize('aiExtensions.action.enable', "Enable"));
			}
			this.renderAction(container, item.id, 'update', localize('aiExtensions.action.update', "Update"));
			this.renderAction(container, item.id, 'sync', localize('aiExtensions.action.sync', "Apply Again"));
			this.renderAction(container, item.id, 'uninstall', localize('aiExtensions.action.uninstall', "Uninstall"), true);
		}
		if (!item.installable) {
			const unsupported = dom.append(container, dom.$('span.ai-extension-editor-action-note'));
			unsupported.textContent = item.installState === 'unsupported' ? localize('aiExtensions.action.unsupported', "Pending Support") : localize('aiExtensions.action.viewOnly', "View Only");
		}
	}

	private renderAction(container: HTMLElement, id: string, action: string, label: string, secondary = false): void {
		const button = dom.append(container, dom.$('button.ai-extension-editor-action')) as HTMLButtonElement;
		button.type = 'button';
		button.dataset.action = action;
		button.dataset.id = id;
		button.disabled = this.busy;
		button.classList.toggle('secondary', secondary);
		button.textContent = label;
		this.actionButtons.push(button);
		dom.addDisposableListener(button, dom.EventType.CLICK, () => this.runAction(action, id));
	}

	private async runAction(action: string, id: string): Promise<void> {
		if (this.busy) {
			return;
		}
		this.busy = true;
		this.actionInProgress = true;
		this.setActionBusy(true);
		try {
			switch (action) {
				case 'install':
					await this.aiExtensionsService.install(id);
					break;
				case 'uninstall':
					await this.aiExtensionsService.uninstall(id);
					break;
				case 'enable':
					await this.aiExtensionsService.enable(id);
					break;
				case 'disable':
					await this.aiExtensionsService.disable(id);
					break;
				case 'trust':
					await this.aiExtensionsService.trust(id);
					break;
				case 'update':
					await this.aiExtensionsService.update(id);
					break;
				case 'sync':
					await this.aiExtensionsService.sync();
					break;
			}
		} catch (err) {
			this.notificationService.error(err);
		} finally {
			this.busy = false;
			this.actionInProgress = false;
			this.setActionBusy(false);
			await this.refreshCurrentInput();
		}
	}

	private setActionBusy(busy: boolean): void {
		const root = this.template?.root;
		if (!root) {
			return;
		}
		root.setAttribute('aria-busy', String(busy));
		for (const button of this.actionButtons) {
			button.disabled = busy;
		}
	}
}

function iconClass(item: IAIExtensionDescriptor): string {
	switch (item.type) {
		case 'skill':
			return 'codicon-symbol-method';
		case 'plugin':
			return 'codicon-extensions';
		case 'mcp':
			return 'codicon-server-process';
	}
}

function descriptionSummary(item: IAIExtensionDescriptor): string {
	const lines = [
		localize('aiExtensions.descriptionSummary.identity', "{0} is a {2} from {1}.", item.name, item.sourceLabel, typeLabel(item.type)),
		item.category ? localize('aiExtensions.descriptionSummary.category', "Category: {0}.", item.category) : undefined,
		item.author ? localize('aiExtensions.descriptionSummary.author', "Author or maintainer: {0}.", item.author) : undefined,
		capabilitySummary(item),
		originalSummary(item.description),
		item.installable
			? localize('aiExtensions.descriptionSummary.installable', "This item can be installed into the current profile. After install, apply it again to make the runtime pick it up.")
			: localize('aiExtensions.descriptionSummary.viewOnly', "This item is view-only and cannot be installed directly yet."),
	];
	return lines.filter(isNonEmptyString).join('\n');
}

function capabilitySummary(item: IAIExtensionDescriptor): string {
	switch (item.type) {
		case 'skill':
			return localize('aiExtensions.capability.skill', "Capability: provides task-specific instructions, workflows, and resources for the model.");
		case 'plugin':
			return localize('aiExtensions.capability.plugin', "Capability: provides installable plugin behavior that may affect runtime execution.");
		case 'mcp':
			return localize('aiExtensions.capability.mcp', "Capability: connects external tools, services, or local commands through MCP.");
	}
}

function originalSummary(description: string): string {
	const firstSentence = firstSentenceOf(description);
	if (!firstSentence) {
		return '';
	}
	return localize('aiExtensions.descriptionSummary.original', "Original description: {0}", firstSentence);
}

function firstSentenceOf(value: string): string {
	const trimmed = value.trim();
	const end = trimmed.search(/[.!?](\s|$)/);
	if (end >= 0) {
		return trimmed.slice(0, end + 1);
	}
	return trimmed.length > 180 ? `${trimmed.slice(0, 180)}...` : trimmed;
}

function sourceFallback(item: IAIExtensionDescriptor): string {
	switch (item.source) {
		case 'codex':
			return localize('aiExtensions.source.codexFallback', "Codex items prioritize skills and MCP compatibility. Plugin runtime compatibility still needs item-level validation.");
		case 'claude':
			return localize('aiExtensions.source.claudeFallback', "Claude items are read from Claude Code plugin marketplace, skill, or MCP metadata before being converted into OpenCode-loadable content.");
		case 'opencode':
			return localize('aiExtensions.source.opencodeFallback', "OpenCode items are converted into the IDE-managed OpenCode overlay.");
	}
}

function marketplaceText(item: IAIExtensionDescriptor): string {
	if (item.marketplaceUrl) {
		return item.marketplaceUrl;
	}
	switch (item.source) {
		case 'codex':
			return localize('aiExtensions.marketplace.codex', "Codex supports plugin directories and marketplace.json. Repo marketplaces live at $REPO_ROOT/.agents/plugins/marketplace.json, personal marketplaces live at ~/.agents/plugins/marketplace.json, and the curated Plugin Directory is also supported. No public REST marketplace API is confirmed yet.");
		case 'claude':
			return localize('aiExtensions.marketplace.claude', "Claude Code supports plugin marketplaces through repository references that expose .claude-plugin/marketplace.json. Anthropic's official marketplace repository is anthropics/claude-plugins-official.");
		case 'opencode':
			return localize('aiExtensions.marketplace.opencode', "OpenCode plugins can come from local directories, URLs, or npm packages. No public JSON marketplace API is confirmed yet, so integration starts from official plugin, skill, MCP docs, and configurable repository marketplaces.");
	}
}

function metadataEntries(item: IAIExtensionDescriptor): readonly (readonly [string, string])[] {
	const entries: readonly (readonly [string, string | undefined])[] = [
		[localize('aiExtensions.metadata.type', "Type"), typeLabel(item.type)],
		[localize('aiExtensions.metadata.source', "Source"), item.sourceLabel],
		[localize('aiExtensions.metadata.sourceDetail', "Source Notes"), item.detail ?? sourceFallback(item)],
		[localize('aiExtensions.metadata.marketplace', "Marketplace URL"), marketplaceText(item)],
		[localize('aiExtensions.metadata.author', "Author"), item.author],
		[localize('aiExtensions.metadata.category', "Category"), item.category],
		[localize('aiExtensions.metadata.version', "Version"), item.version],
		[localize('aiExtensions.metadata.downloads', "Downloads"), item.downloadCount === undefined ? undefined : formatCount(item.downloadCount)],
		[localize('aiExtensions.metadata.stars', "Star"), item.starCount === undefined ? undefined : formatCount(item.starCount)],
		[localize('aiExtensions.metadata.homepage', "Homepage"), item.homepage],
		[localize('aiExtensions.metadata.icon', "Icon"), item.iconUrl],
	];
	return entries.filter((entry): entry is readonly [string, string] => isNonEmptyString(entry[1]));
}

function formatCount(value: number): string {
	if (value >= 1_000_000) {
		return `${trimMetric(value / 1_000_000)}M`;
	}
	if (value >= 1_000) {
		return `${trimMetric(value / 1_000)}K`;
	}
	return String(value);
}

function trimMetric(value: number): string {
	return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
}

function isNonEmptyString(value: string | undefined): value is string {
	return typeof value === 'string' && value.length > 0;
}

function hasRuntimePluginContribution(item: IAIExtensionDescriptor): boolean {
	return (item.contributions.plugins ?? []).some(plugin => !!plugin.content || !!plugin.npm);
}
