/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IAIExtensionDescriptor, IAIExtensionsWorkbenchService } from '../common/aiExtensions.js';
import { AIExtensionEditor } from './aiExtensionsEditor.js';
import { AIExtensionEditorInput } from './aiExtensionsEditorInput.js';
import { typeLabel } from './aiExtensionsLabels.js';
import './aiExtensionsWorkbenchService.js';
import './media/aiExtensions.css';

const AIExtensionsViewId = 'workbench.views.aiExtensions';
const AIExtensionsContainerId = 'workbench.view.aiExtensions';
const AIExtensionsViewTitle = localize2('aiExtensions.view.name', "AI Extensions");
const aiExtensionsViewIcon = registerIcon('ai-extensions-view-icon', Codicon.sparkle, localize('aiExtensions.view.icon', "Icon for AI Extensions View"));

type TypeFilter = IAIExtensionDescriptor['type'];
type SourceFilter = string;
type SourceEntry = { readonly id: SourceFilter; readonly label: string; readonly count: number; readonly loadedCount: number };

const TypeEntries: readonly { readonly id: TypeFilter; readonly label: string; readonly icon: string }[] = [
	{ id: 'skill', label: localize('aiExtensions.filter.skills', "Skills"), icon: 'codicon-symbol-method' },
	{ id: 'plugin', label: localize('aiExtensions.filter.plugins', "Plugins"), icon: 'codicon-extensions' },
	{ id: 'mcp', label: 'MCP', icon: 'codicon-server-process' },
];

const InitialVisibleItems = 40;

class AIExtensionsViewPane extends ViewPane {

	private bodyContainer: HTMLElement | undefined;
	private typeFilter: TypeFilter = 'skill';
	private sourceFilter: SourceFilter | undefined;
	private readonly expandedTypes = new Set<TypeFilter>(['skill']);
	private readonly expandedSources = new Set<string>();
	private selectedId: string | undefined;
	private listActionBusyId: string | undefined;
	private listActionInProgress = false;
	private searchQuery = '';
	private readonly visibleCounts = new Map<string, number>();
	private busy = false;
	private items: readonly IAIExtensionDescriptor[] = [];

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IAIExtensionsWorkbenchService private readonly aiExtensionsService: IAIExtensionsWorkbenchService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.aiExtensionsService.onDidChange(() => {
			if (!this.listActionInProgress) {
				void this.refresh();
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.classList.add('ai-extensions-view');
		this.bodyContainer = dom.append(container, dom.$('.ai-extensions-view-body'));
		this._register(dom.addDisposableListener(this.bodyContainer, dom.EventType.CLICK, event => this.onClick(event)));
		this._register(dom.addDisposableListener(this.bodyContainer, dom.EventType.INPUT, event => this.onInput(event)));
		this._register(dom.addDisposableListener(this.bodyContainer, dom.EventType.KEY_DOWN, event => this.onKeyDown(event)));
		void this.refresh();
	}

	private async refresh(): Promise<void> {
		if (!this.bodyContainer) {
			return;
		}
		const showLoading = this.items.length === 0;
		this.busy = true;
		if (showLoading) {
			this.renderContent();
		}
		try {
			this.items = await this.aiExtensionsService.list();
			this.ensureExpandedSource();
			this.ensureSelection();
		} catch (err) {
			this.notificationService.error(err);
			this.items = [];
			this.selectedId = undefined;
		} finally {
			this.busy = false;
			this.renderContent();
		}
	}

	private renderContent(searchFocus?: { readonly start: number | null; readonly end: number | null }): void {
		if (!this.bodyContainer) {
			return;
		}
		dom.clearNode(this.bodyContainer);

		const header = dom.append(this.bodyContainer, dom.$('.ai-extensions-header'));
		const summary = dom.append(header, dom.$('.ai-extensions-summary'));
		summary.textContent = localize('aiExtensions.header.summary', "Browse by type and source. Select an item to view details in a tab.");
		const refresh = dom.append(header, dom.$('button.ai-extensions-refresh')) as HTMLButtonElement;
		refresh.type = 'button';
		refresh.dataset.refresh = 'true';
		refresh.disabled = this.busy;
		refresh.textContent = localize('aiExtensions.refresh', "Refresh");

		const search = dom.append(this.bodyContainer, dom.$('input.ai-extensions-search')) as HTMLInputElement;
		search.type = 'search';
		search.dataset.search = 'true';
		search.placeholder = localize('aiExtensions.search.placeholder', "Search skills, plugins, MCP, sources, or authors");
		search.value = this.searchQuery;
		if (searchFocus) {
			search.focus();
			if (searchFocus.start !== null && searchFocus.end !== null) {
				search.setSelectionRange(searchFocus.start, searchFocus.end);
			}
		}

		if (this.busy) {
			const loading = dom.append(this.bodyContainer, dom.$('.ai-extensions-empty'));
			loading.textContent = localize('aiExtensions.loading', "Loading AI extensions...");
			return;
		}

		if (this.searchQuery.trim() && this.searchFilteredItems().length === 0) {
			const empty = dom.append(this.bodyContainer, dom.$('.ai-extensions-empty'));
			empty.textContent = localize('aiExtensions.search.empty', "No matching AI extensions.");
			return;
		}

		this.ensureSelection();
		const tree = dom.append(this.bodyContainer, dom.$('.ai-extensions-tree'));

		for (const type of TypeEntries) {
			this.renderTypeNode(tree, type);
		}
	}

	private renderTypeNode(container: HTMLElement, type: (typeof TypeEntries)[number]): void {
		const node = dom.append(container, dom.$('.ai-extensions-tree-node'));
		const isExpanded = this.expandedTypes.has(type.id);
		const row = dom.append(node, dom.$('button.ai-extensions-tree-row.ai-extensions-type-row')) as HTMLButtonElement;
		row.type = 'button';
		row.dataset.filterKind = 'type';
		row.dataset.filterValue = type.id;
		row.setAttribute('aria-expanded', String(isExpanded));
		row.classList.toggle('expanded', isExpanded);

		dom.append(row, dom.$(`span.codicon.codicon-chevron-right.ai-extensions-chevron`));
		dom.append(row, dom.$(`span.codicon.${type.icon}.ai-extensions-tree-icon`));
		const label = dom.append(row, dom.$('span.ai-extensions-tree-label'));
		label.textContent = type.label;
		const count = dom.append(row, dom.$('span.ai-extensions-tree-count'));
		count.textContent = formatCount(this.countForType(type.id));

		if (!isExpanded) {
			return;
		}

		const sourceGroup = dom.append(node, dom.$('.ai-extensions-source-group'));
		sourceGroup.setAttribute('role', 'group');
		for (const source of this.sourceEntriesFor(type.id)) {
			this.renderSourceNode(sourceGroup, type.id, source);
		}
	}

	private renderSourceNode(container: HTMLElement, type: TypeFilter, source: SourceEntry): void {
		const node = dom.append(container, dom.$('.ai-extensions-tree-node'));
		const isExpanded = this.expandedSources.has(this.sourceExpansionKey(type, source.id));
		const sourceItems = this.sortItemsForList(this.searchFilteredItems().filter(item => item.type === type && item.sourceLabel === source.id));
		const row = dom.append(node, dom.$('button.ai-extensions-tree-row.ai-extensions-source-row')) as HTMLButtonElement;
		row.type = 'button';
		row.dataset.filterKind = 'source';
		row.dataset.filterValue = source.id;
		row.dataset.typeValue = type;
		row.setAttribute('aria-expanded', String(isExpanded));
		row.classList.toggle('expanded', isExpanded);

		dom.append(row, dom.$('span.codicon.codicon-chevron-right.ai-extensions-chevron'));
		const label = dom.append(row, dom.$('span.ai-extensions-tree-label'));
		label.textContent = source.label;
		const count = dom.append(row, dom.$('span.ai-extensions-tree-count'));
		count.textContent = formatCount(source.count);

		if (!isExpanded) {
			return;
		}

		const list = dom.append(node, dom.$('.ai-extensions-list'));
		if (!sourceItems.length) {
			const empty = dom.append(list, dom.$('.ai-extensions-empty'));
			empty.textContent = localize('aiExtensions.empty', "This marketplace category has no items to show yet.");
			return;
		}
		const visibleKey = this.visibleKey(type, source.id);
		const visibleCount = this.visibleCounts.get(visibleKey) ?? InitialVisibleItems;
		for (const item of sourceItems.slice(0, visibleCount)) {
			this.renderListItem(list, item);
		}
		if (sourceItems.length > visibleCount) {
			const loadMore = dom.append(list, dom.$('button.ai-extensions-load-more')) as HTMLButtonElement;
			loadMore.type = 'button';
			loadMore.dataset.loadMore = visibleKey;
			loadMore.textContent = localize('aiExtensions.loadMore', "Load {0} more", Math.min(InitialVisibleItems, sourceItems.length - visibleCount));
		}
	}

	private renderListItem(container: HTMLElement, item: IAIExtensionDescriptor): void {
		const root = dom.append(container, dom.$('.ai-extensions-list-item'));
		root.tabIndex = 0;
		root.dataset.selectId = item.id;
		root.classList.toggle('selected', item.id === this.selectedId);
		root.setAttribute('aria-current', String(item.id === this.selectedId));

		this.renderExtensionIcon(root, item);

		const content = dom.append(root, dom.$('.ai-extensions-list-content'));
		const titleRow = dom.append(content, dom.$('.ai-extensions-list-title-row'));
		const title = dom.append(titleRow, dom.$('.ai-extensions-list-item-title'));
		title.textContent = item.name;
		this.renderPopularity(titleRow, item);

		const description = dom.append(content, dom.$('.ai-extensions-list-description'));
		description.textContent = item.description;

		const footer = dom.append(content, dom.$('.ai-extensions-list-footer'));
		const source = dom.append(footer, dom.$('.ai-extensions-list-source'));
		source.textContent = [
			item.sourceLabel,
			item.author,
			item.category,
		].filter(isNonEmptyString).join(' / ');
		const action = listAction(item);
		if (action) {
			const button = dom.append(footer, dom.$('button.ai-extensions-list-action')) as HTMLButtonElement;
			button.type = 'button';
			button.dataset.listAction = action.id;
			button.dataset.id = item.id;
			button.disabled = this.listActionBusyId === item.id;
			button.textContent = action.label;
		}
	}

	private renderExtensionIcon(container: HTMLElement, item: IAIExtensionDescriptor): void {
		const icon = dom.append(container, dom.$('span.ai-extensions-list-icon'));
		if (item.iconUrl) {
			const image = dom.append(icon, dom.$('img.ai-extensions-list-icon-image')) as HTMLImageElement;
			image.src = item.iconUrl;
			image.alt = '';
			image.referrerPolicy = 'no-referrer';
			return;
		}
		icon.classList.add('codicon');
		icon.classList.add(item.type === 'skill' ? 'codicon-symbol-method' : item.type === 'plugin' ? 'codicon-extensions' : 'codicon-server-process');
	}

	private searchFilteredItems(): readonly IAIExtensionDescriptor[] {
		const query = this.searchQuery.trim().toLowerCase();
		if (!query) {
			return this.items;
		}
		return this.items.filter(item => [
			item.name,
			item.description,
			item.sourceLabel,
			item.author,
			item.category,
			item.homepage,
			item.marketplaceUrl,
			item.version,
			typeLabel(item.type),
		].some(value => value?.toLowerCase().includes(query)));
	}

	private sortItemsForList(items: readonly IAIExtensionDescriptor[]): readonly IAIExtensionDescriptor[] {
		return [...items].sort((a, b) => {
			const popularityRank = popularityScore(b) - popularityScore(a);
			if (popularityRank !== 0) {
				return popularityRank;
			}
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
		});
	}

	private renderPopularity(container: HTMLElement, item: IAIExtensionDescriptor): void {
		const stat = popularityStat(item);
		if (!stat) {
			return;
		}
		const root = dom.append(container, dom.$('.ai-extensions-list-stat'));
		root.classList.add(stat.kind);
		dom.append(root, dom.$(`span.codicon.${stat.icon}`));
		const label = dom.append(root, dom.$('span.ai-extensions-list-stat-label'));
		label.textContent = stat.label;
	}

	private sourceEntriesFor(type: TypeFilter): readonly SourceEntry[] {
		const counts = new Map<string, number>();
		const sourceTotals = new Map<string, number>();
		for (const item of this.searchFilteredItems()) {
			if (item.type !== type) {
				continue;
			}
			counts.set(item.sourceLabel, (counts.get(item.sourceLabel) ?? 0) + 1);
			if (!this.searchQuery.trim() && item.sourceTotalCount !== undefined) {
				sourceTotals.set(item.sourceLabel, Math.max(sourceTotals.get(item.sourceLabel) ?? 0, item.sourceTotalCount));
			}
		}
		return [...counts.entries()]
			.map(([label, count]) => ({ id: label, label, loadedCount: count, count: sourceTotals.get(label) ?? count }))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
	}

	private countForType(type: TypeFilter): number {
		return this.searchFilteredItems().filter(item => item.type === type).length;
	}

	private ensureExpandedSource(): void {
		let sources = this.sourceEntriesFor(this.typeFilter);
		if (!sources.length) {
			const fallbackType = TypeEntries.find(type => this.sourceEntriesFor(type.id).length)?.id;
			if (fallbackType) {
				this.typeFilter = fallbackType;
				this.expandedTypes.add(fallbackType);
				sources = this.sourceEntriesFor(fallbackType);
			}
		}
		if (!sources.some(source => source.id === this.sourceFilter)) {
			this.sourceFilter = sources[0]?.id;
		}
		for (const type of TypeEntries) {
			if (this.expandedTypes.has(type.id) && !this.sourceEntriesFor(type.id).length) {
				this.expandedTypes.delete(type.id);
			}
		}
		if (!this.expandedTypes.size && sources.length) {
			this.expandedTypes.add(this.typeFilter);
		}
		for (const key of this.expandedSources) {
			const [type, source] = this.parseSourceExpansionKey(key);
			if (!this.sourceEntriesFor(type).some(candidate => candidate.id === source)) {
				this.expandedSources.delete(key);
			}
		}
	}

	private filteredItems(): readonly IAIExtensionDescriptor[] {
		if (!this.sourceFilter) {
			return [];
		}
		return this.searchFilteredItems().filter(item =>
			item.type === this.typeFilter
			&& item.sourceLabel === this.sourceFilter
		);
	}

	private ensureSelection(items = this.filteredItems()): void {
		if (items.some(item => item.id === this.selectedId)) {
			return;
		}
		this.selectedId = items[0]?.id;
	}

	private onClick(event: MouseEvent): void {
		const target = event.target;
		if (!dom.isHTMLElement(target)) {
			return;
		}
		const loadMore = target.closest<HTMLButtonElement>('button[data-load-more]');
		if (loadMore?.dataset.loadMore) {
			const key = loadMore.dataset.loadMore;
			this.visibleCounts.set(key, (this.visibleCounts.get(key) ?? InitialVisibleItems) + InitialVisibleItems);
			this.renderContent();
			return;
		}

		const listAction = target.closest<HTMLButtonElement>('button[data-list-action]');
		if (listAction?.dataset.id && listAction.dataset.listAction) {
			event.preventDefault();
			event.stopPropagation();
			void this.runListAction(listAction.dataset.listAction, listAction.dataset.id);
			return;
		}

		const refresh = target.closest<HTMLButtonElement>('button[data-refresh]');
		if (refresh) {
			void this.refreshMarketplace();
			return;
		}

		const filter = target.closest<HTMLButtonElement>('button[data-filter-kind]');
		if (filter) {
			const kind = filter.dataset.filterKind;
			const value = filter.dataset.filterValue;
			if (kind === 'type') {
				const nextType = (value as TypeFilter) ?? 'skill';
				this.typeFilter = nextType;
				if (this.expandedTypes.has(nextType)) {
					this.expandedTypes.delete(nextType);
				} else {
					this.expandedTypes.add(nextType);
					const sources = this.sourceEntriesFor(nextType);
					if (!sources.some(source => source.id === this.sourceFilter)) {
						this.sourceFilter = sources[0]?.id;
					}
				}
			}
			if (kind === 'source') {
				const nextType = (filter.dataset.typeValue as TypeFilter) ?? this.typeFilter;
				const nextSource = value as SourceFilter;
				this.typeFilter = nextType;
				this.sourceFilter = nextSource;
				this.expandedTypes.add(nextType);
				const key = this.sourceExpansionKey(nextType, nextSource);
				if (this.expandedSources.has(key)) {
					this.expandedSources.delete(key);
				} else {
					this.expandedSources.add(key);
				}
			}
			this.selectedId = undefined;
			this.ensureSelection();
			this.renderContent();
			return;
		}

		const selectable = target.closest<HTMLElement>('[data-select-id]');
		if (selectable?.dataset.selectId) {
			this.selectedId = selectable.dataset.selectId;
			this.renderContent();
			const item = this.items.find(candidate => candidate.id === this.selectedId);
			if (item) {
				void this.editorService.openEditor(new AIExtensionEditorInput(item), { pinned: true });
			}
		}
	}

	private onInput(event: Event): void {
		const target = event.target;
		if (!dom.isHTMLElement(target) || !target.matches('input[data-search]')) {
			return;
		}
		const search = target as HTMLInputElement;
		this.searchQuery = search.value;
		this.visibleCounts.clear();
		this.ensureExpandedSource();
		this.selectedId = undefined;
		this.ensureSelection();
		this.renderContent({ start: search.selectionStart, end: search.selectionEnd });
	}

	private visibleKey(type: TypeFilter, source: SourceFilter): string {
		return `${type}:${source}:${this.searchQuery.trim().toLowerCase()}`;
	}

	private sourceExpansionKey(type: TypeFilter, source: SourceFilter): string {
		return `${type}\u0000${source}`;
	}

	private parseSourceExpansionKey(key: string): readonly [TypeFilter, SourceFilter] {
		const [type, source = ''] = key.split('\u0000', 2);
		return [(type as TypeFilter) ?? 'skill', source];
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		const target = event.target;
		if (!dom.isHTMLElement(target) || !target.matches('[data-select-id]')) {
			return;
		}
		event.preventDefault();
		const item = this.items.find(candidate => candidate.id === target.dataset.selectId);
		if (!item) {
			return;
		}
		this.selectedId = item.id;
		this.renderContent();
		void this.editorService.openEditor(new AIExtensionEditorInput(item), { pinned: true });
	}

	private async runListAction(action: string, id: string): Promise<void> {
		this.listActionBusyId = id;
		this.listActionInProgress = true;
		this.renderContent();
		try {
			let updatedItem: IAIExtensionDescriptor | undefined;
			if (action === 'install') {
				updatedItem = await this.aiExtensionsService.install(id);
			}
			if (action === 'uninstall') {
				await this.aiExtensionsService.uninstall(id);
				updatedItem = (await this.aiExtensionsService.list()).find(candidate => candidate.id === id);
			}
			if (updatedItem) {
				this.items = this.items.map(candidate => candidate.id === id ? updatedItem : candidate);
			}
		} catch (err) {
			this.notificationService.error(err);
		} finally {
			this.listActionInProgress = false;
			this.listActionBusyId = undefined;
			this.renderContent();
		}
	}

	private async refreshMarketplace(): Promise<void> {
		if (!this.bodyContainer) {
			return;
		}
		this.busy = true;
		this.renderContent();
		try {
			this.items = await this.aiExtensionsService.refresh();
			this.ensureExpandedSource();
			this.ensureSelection();
		} catch (err) {
			this.notificationService.error(err);
		} finally {
			this.busy = false;
			this.renderContent();
		}
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		AIExtensionEditor,
		AIExtensionEditor.ID,
		localize('aiExtensionEditor', "AI Extension")
	),
	[new SyncDescriptor(AIExtensionEditorInput)]
);

const aiExtensionsViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: AIExtensionsContainerId,
	title: AIExtensionsViewTitle,
	icon: aiExtensionsViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [AIExtensionsContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: AIExtensionsContainerId,
	hideIfEmpty: true,
	order: 3,
}, ViewContainerLocation.Sidebar);

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: AIExtensionsViewId,
	name: AIExtensionsViewTitle,
	ctorDescriptor: new SyncDescriptor(AIExtensionsViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	collapsed: false,
	order: 10,
	weight: 20,
	containerIcon: aiExtensionsViewIcon,
	containerTitle: AIExtensionsViewTitle.value,
	singleViewPaneContainerTitle: AIExtensionsViewTitle.value,
}], aiExtensionsViewContainer);

function isNonEmptyString(value: string | undefined): value is string {
	return typeof value === 'string' && value.length > 0;
}

function listAction(item: IAIExtensionDescriptor): { readonly id: 'install' | 'uninstall'; readonly label: string } | undefined {
	if (item.installedByIde) {
		return { id: 'uninstall', label: localize('aiExtensions.list.uninstall', "Uninstall") };
	}
	if (item.installable) {
		return { id: 'install', label: localize('aiExtensions.list.install', "Install") };
	}
	return undefined;
}

function popularityScore(item: IAIExtensionDescriptor): number {
	return item.downloadCount ?? item.starCount ?? 0;
}

function popularityStat(item: IAIExtensionDescriptor): { readonly kind: string; readonly icon: string; readonly label: string } | undefined {
	if (item.downloadCount !== undefined) {
		return { kind: 'downloads', icon: 'codicon-cloud-download', label: formatCount(item.downloadCount) };
	}
	if (item.starCount !== undefined) {
		return { kind: 'stars', icon: 'codicon-star-full', label: formatCount(item.starCount) };
	}
	return undefined;
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
