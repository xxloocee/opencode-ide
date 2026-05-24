/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from '../../../../base/common/actions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IStringDictionary } from '../../../../base/common/collections.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { constObservable, IObservable, IReader, observableValue } from '../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAgentNetworkFilterService } from '../../../../platform/networkFilter/common/networkFilterService.js';
import { IChatOutputItemRenderer, IChatOutputRendererService, RenderedOutputPart } from './chatOutputItemRenderer.js';
import { ChatViewPaneTarget, IChatWidget, IChatWidgetService } from './chat.js';
import { IAgentSession, IAgentSessionsModel } from './agentSessions/agentSessionsModel.js';
import { IAgentSessionsService } from './agentSessions/agentSessionsService.js';
import { ChatContextPickService, IChatContextPickService } from './attachments/chatContextPickService.js';
import { ChatRequestQueueKind, ChatSendResult, IChatCompleteResponse, IChatDetail, IChatFollowup, IChatModelReference, IChatProgress, IChatSendRequestOptions, IChatService, IChatSessionStartOptions, IChatUserActionEvent } from '../common/chatService/chatService.js';
import { IChatDebugService } from '../common/chatDebugService.js';
import { ChatDebugServiceImpl } from '../common/chatDebugServiceImpl.js';
import { ChatRequestToolReferenceEntry } from '../common/attachments/chatVariableEntries.js';
import { IVariableReference } from '../common/chatModes.js';
import { ICodeMapperProvider, ICodeMapperRequest, ICodeMapperResponse, ICodeMapperResult, ICodeMapperService } from '../common/editing/chatCodeMapperService.js';
import { ContributionEnablementState, IEnablementModel } from '../common/enablement.js';
import { IChatSessionsService, IChatInputCompletionsParams, IChatInputCompletionsResult, IChatNewSessionRequest, IChatSession, IChatSessionCommitEvent, IChatSessionContentProvider, IChatSessionCustomizationItemGroup, IChatSessionCustomizationsProvider, IChatSessionItem, IChatSessionItemController, IChatSessionItemsDelta, IChatSessionOptionsChangeEvent, IChatSessionProviderOptionGroup, IChatSessionProviderOptionItem, IChatSessionRequestHistoryItem, IChatSessionsExtensionPoint, ReadonlyChatSessionOptionsMap, ResolvedChatSessionsExtensionPoint, SessionType } from '../common/chatSessionsService.js';
import { ChatAgentLocation, ChatModeKind } from '../common/constants.js';
import { createVSCodeHarnessDescriptor, CustomizationHarnessServiceBase, ICustomizationHarnessService } from '../common/customizationHarnessService.js';
import { ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService } from '../common/ignoredFiles.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier, ILanguageModelChatProvider, ILanguageModelChatRequestOptions, ILanguageModelChatResponse, ILanguageModelChatSelector, ILanguageModelProviderDescriptor, ILanguageModelsGroup, ILanguageModelsService, IModelsControlManifest, IUserFriendlyLanguageModel, IChatMessage } from '../common/languageModels.js';
import { ILanguageModelsProviderGroup } from '../common/languageModelsConfiguration.js';
import { IChatRequestVariableData, IChatModel, IChatRequestModel, IExportableChatData, ISerializableChatData } from '../common/model/chatModel.js';
import { IChatModelReferenceDebugSnapshot } from '../common/model/chatModelStore.js';
import { IAgentPluginService } from '../common/plugins/agentPluginService.js';
import { IInstallPluginFromSourceOptions, IInstallPluginFromSourceResult, IPluginInstallService, IUpdateAllPluginsOptions, IUpdateAllPluginsResult } from '../common/plugins/pluginInstallService.js';
import { IMarketplacePlugin } from '../common/plugins/pluginMarketplaceService.js';
import { IPromptsService } from '../common/promptSyntax/service/promptsService.js';
import { PromptsService } from '../common/promptSyntax/service/promptsServiceImpl.js';
import { IParsedChatRequest } from '../common/requestParser/chatParserTypes.js';
import { IChatAgent, IChatAgentAttachmentCapabilities, IChatAgentCommand, IChatAgentCompletionItem, IChatAgentData, IChatAgentHistoryEntry, IChatAgentImplementation, IChatAgentInvocationEvent, IChatAgentMetadata, IChatAgentRequest, IChatAgentResult, IChatAgentService, IChatParticipantDetectionProvider, UserSelectedTools } from '../common/participants/chatAgents.js';
import { Target } from '../common/promptSyntax/promptTypes.js';
import { IChatArtifactsService, ChatArtifactsService } from '../common/tools/chatArtifactsService.js';
import { ChatTodoListService, IChatTodoListService } from '../common/tools/chatTodoListService.js';
import { CountTokensCallback, IBeginToolCallOptions, ILanguageModelToolsService, IToolAndToolSetEnablementMap, IToolData, IToolImpl, IToolInvocation, IToolInvokedEvent, IToolResult, IToolSet, ToolDataSource, ToolSet } from '../common/tools/languageModelToolsService.js';
import { IToolResultCompressor, IToolResultFilter } from '../common/tools/toolResultCompressor.js';

const unsupported = (method: string): Error => new Error(`${method} is not supported in the OpenCode clean build.`);

class NullChatService implements IChatService {
	declare readonly _serviceBrand: undefined;

	transferredSessionResource: URI | undefined = undefined;
	readonly onDidSubmitRequest: Event<{ readonly chatSessionResource: URI; readonly message?: IParsedChatRequest }> = Event.None;
	readonly onDidCreateModel: Event<IChatModel> = Event.None;
	readonly chatModels = observableValue<Iterable<IChatModel>>('opencodeCleanChatModels', []);
	readonly editingSessions = [];
	readonly onDidPerformUserAction: Event<IChatUserActionEvent> = Event.None;
	readonly onDidReceiveQuestionCarouselAnswer = Event.None;
	readonly onDidDisposeSession: Event<{ readonly sessionResources: readonly URI[]; readonly reason: 'cleared' }> = Event.None;
	readonly requestInProgressObs = observableValue('opencodeCleanChatRequestInProgress', false);

	isEnabled(_location: ChatAgentLocation): boolean {
		return false;
	}

	hasSessions(): boolean {
		return false;
	}

	startNewLocalSession(_location: ChatAgentLocation, _options?: IChatSessionStartOptions): IChatModelReference {
		throw unsupported('IChatService.startNewLocalSession');
	}

	getSession(_sessionResource: URI): IChatModel | undefined {
		return undefined;
	}

	acquireExistingSession(_sessionResource: URI, _debugOwner?: string): IChatModelReference | undefined {
		return undefined;
	}

	async acquireOrLoadSession(_sessionResource: URI, _location: ChatAgentLocation, _token: CancellationToken, _debugOwner?: string): Promise<IChatModelReference | undefined> {
		return undefined;
	}

	loadSessionFromData(_data: IExportableChatData | ISerializableChatData, _debugOwner?: string): IChatModelReference {
		throw unsupported('IChatService.loadSessionFromData');
	}

	getChatModelReferenceDebugInfo(): IChatModelReferenceDebugSnapshot {
		return { totalModels: 0, totalReferences: 0, models: [] };
	}

	async sendRequest(_sessionResource: URI, _message: string, _options?: IChatSendRequestOptions): Promise<ChatSendResult> {
		throw unsupported('IChatService.sendRequest');
	}

	getSessionTitle(_sessionResource: URI): string | undefined {
		return undefined;
	}

	setSessionTitle(_sessionResource: URI, _title: string): void { }
	appendProgress(_request: IChatRequestModel, _progress: IChatProgress): void { }

	async resendRequest(_request: IChatRequestModel, _options?: IChatSendRequestOptions): Promise<void> {
		throw unsupported('IChatService.resendRequest');
	}

	async adoptRequest(_sessionResource: URI, _request: IChatRequestModel): Promise<void> {
		throw unsupported('IChatService.adoptRequest');
	}

	async removeRequest(_sessionResource: URI, _requestId: string): Promise<void> { }
	async cancelCurrentRequestForSession(_sessionResource: URI, _source?: string): Promise<void> { }
	migrateRequests(_originalResource: URI, _targetResource: URI): void { }
	setYieldRequested(_sessionResource: URI): void { }
	removePendingRequest(_sessionResource: URI, _requestId: string): void { }
	setPendingRequests(_sessionResource: URI, _requests: readonly { requestId: string; kind: ChatRequestQueueKind }[]): void { }
	processPendingRequests(_sessionResource: URI): void { }
	addCompleteRequest(_sessionResource: URI, _message: IParsedChatRequest | string, _variableData: IChatRequestVariableData | undefined, _attempt: number | undefined, _response: IChatCompleteResponse): void { }
	setChatSessionTitle(_sessionResource: URI, _title: string): void { }

	async getLocalSessionHistory(): Promise<IChatDetail[]> {
		return [];
	}

	async clearAllHistoryEntries(): Promise<void> { }
	async removeHistoryEntry(_sessionResource: URI): Promise<void> { }

	getChatStorageFolder(): URI {
		return URI.file('/opencode-clean-chat');
	}

	logChatIndex(): void { }

	async getLiveSessionItems(): Promise<IChatDetail[]> {
		return [];
	}

	async getHistorySessionItems(): Promise<IChatDetail[]> {
		return [];
	}

	async getMetadataForSession(_sessionResource: URI): Promise<IChatDetail | undefined> {
		return undefined;
	}

	notifyUserAction(_event: IChatUserActionEvent): void { }
	notifyQuestionCarouselAnswer(_requestId: string, _resolveId: string, _answers: unknown): void { }
	async transferChatSession(_transferredSessionResource: URI, _toWorkspace: URI): Promise<void> { }
	async activateDefaultAgent(_location: ChatAgentLocation): Promise<void> { }
	setSaveModelsEnabled(_enabled: boolean): void { }
	async waitForModelDisposals(): Promise<void> { }
}

class NullChatAgentService implements IChatAgentService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeAgents: Event<IChatAgent | undefined> = Event.None;
	readonly onWillInvokeAgent: Event<IChatAgentInvocationEvent> = Event.None;
	readonly hasToolsAgent = false;

	registerAgent(_id: string, _data: IChatAgentData): IDisposable { return Disposable.None; }
	registerAgentImplementation(_id: string, _agent: IChatAgentImplementation): IDisposable { return Disposable.None; }
	registerDynamicAgent(_data: IChatAgentData, _agentImpl: IChatAgentImplementation): IDisposable { return Disposable.None; }
	registerAgentCompletionProvider(_id: string, _provider: (query: string, token: CancellationToken) => Promise<IChatAgentCompletionItem[]>): IDisposable { return Disposable.None; }
	async getAgentCompletionItems(_id: string, _query: string, _token: CancellationToken): Promise<IChatAgentCompletionItem[]> { return []; }
	registerChatParticipantDetectionProvider(_handle: number, _provider: IChatParticipantDetectionProvider): IDisposable { return Disposable.None; }
	async detectAgentOrCommand(_request: IChatAgentRequest, _history: IChatAgentHistoryEntry[], _options: { location: ChatAgentLocation }, _token: CancellationToken): Promise<{ agent: IChatAgentData; command?: IChatAgentCommand } | undefined> { return undefined; }
	hasChatParticipantDetectionProviders(): boolean { return false; }
	async invokeAgent(_agent: string, _request: IChatAgentRequest, _progress: (parts: IChatProgress[]) => void, _history: IChatAgentHistoryEntry[], _token: CancellationToken): Promise<IChatAgentResult> { throw unsupported('IChatAgentService.invokeAgent'); }
	setRequestTools(_agent: string, _requestId: string, _tools: UserSelectedTools): void { }
	setYieldRequested(_agent: string, _requestId: string, _value: boolean): void { }
	async getFollowups(_id: string, _request: IChatAgentRequest, _result: IChatAgentResult, _history: IChatAgentHistoryEntry[], _token: CancellationToken): Promise<IChatFollowup[]> { return []; }
	async getChatTitle(_id: string, _history: IChatAgentHistoryEntry[], _token: CancellationToken): Promise<string | undefined> { return undefined; }
	async getChatSummary(_id: string, _history: IChatAgentHistoryEntry[], _token: CancellationToken): Promise<string | undefined> { return undefined; }
	getAgent(_id: string, _includeDisabled?: boolean): IChatAgentData | undefined { return undefined; }
	getAgentByFullyQualifiedId(_id: string): IChatAgentData | undefined { return undefined; }
	getAgents(): IChatAgentData[] { return []; }
	getActivatedAgents(): IChatAgent[] { return []; }
	getAgentsByName(_name: string): IChatAgentData[] { return []; }
	agentHasDupeName(_id: string): boolean { return false; }
	getDefaultAgent(_location: ChatAgentLocation, _mode?: ChatModeKind): IChatAgent | undefined { return undefined; }
	getContributedDefaultAgent(_location: ChatAgentLocation): IChatAgentData | undefined { return undefined; }
	updateAgent(_id: string, _updateMetadata: IChatAgentMetadata): void { }
}

class NullChatWidgetService implements IChatWidgetService {
	declare readonly _serviceBrand: undefined;

	readonly lastFocusedWidget: IChatWidget | undefined = undefined;
	readonly onDidAddWidget: Event<IChatWidget> = Event.None;
	readonly onDidBackgroundSession: Event<URI> = Event.None;
	readonly onDidChangeFocusedWidget: Event<IChatWidget | undefined> = Event.None;
	readonly onDidChangeFocusedSession: Event<void> = Event.None;

	async reveal(_widget: IChatWidget, _preserveFocus?: boolean): Promise<boolean> { return false; }
	async revealWidget(_preserveFocus?: boolean): Promise<IChatWidget | undefined> { return undefined; }
	getAllWidgets(): ReadonlyArray<IChatWidget> { return []; }
	getWidgetByInputUri(_uri: URI): IChatWidget | undefined { return undefined; }
	async openSession(_sessionResource: URI, _target?: typeof ChatViewPaneTarget | unknown, _options?: unknown): Promise<IChatWidget | undefined> { return undefined; }
	getWidgetBySessionResource(_sessionResource: URI): IChatWidget | undefined { return undefined; }
	getWidgetsByLocations(_location: ChatAgentLocation): ReadonlyArray<IChatWidget> { return []; }
	register(_newWidget: IChatWidget): IDisposable { return Disposable.None; }
}

class NullChatSessionsService implements IChatSessionsService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeItemsProviders: Event<{ readonly chatSessionType: string }> = Event.None;
	readonly onDidChangeSessionItems: Event<IChatSessionItemsDelta> = Event.None;
	readonly onDidCommitSession: Event<IChatSessionCommitEvent> = Event.None;
	readonly onDidChangeAvailability: Event<void> = Event.None;
	readonly onDidChangeInProgress: Event<void> = Event.None;
	readonly onDidChangeContentProviderSchemes: Event<{ readonly added: string[]; readonly removed: string[] }> = Event.None;
	readonly onDidChangeSessionOptions: Event<IChatSessionOptionsChangeEvent> = Event.None;
	readonly onDidChangeOptionGroups: Event<string> = Event.None;
	readonly onDidChangeCustomizations: Event<{ readonly chatSessionType: string }> = Event.None;

	getChatSessionContribution(_chatSessionType: string): ResolvedChatSessionsExtensionPoint | undefined { return undefined; }
	getAllChatSessionContributions(): ResolvedChatSessionsExtensionPoint[] { return []; }
	registerChatSessionContribution(_contribution: IChatSessionsExtensionPoint): IDisposable { return Disposable.None; }
	registerChatSessionItemController(_chatSessionType: string, _controller: IChatSessionItemController): IDisposable { return Disposable.None; }
	getRegisteredChatSessionItemProviders(): readonly string[] { return []; }
	async activateChatSessionItemProvider(_chatSessionType: string): Promise<void> { }
	async *getChatSessionItems(_providerTypeFilter: readonly string[] | undefined, _token: CancellationToken): AsyncIterable<{ readonly chatSessionType: string; readonly items: readonly IChatSessionItem[] }> { }
	async refreshChatSessionItems(_providerTypeFilter: readonly string[] | undefined, _token: CancellationToken): Promise<void> { }
	getInProgress(): { chatSessionType: string; count: number }[] { return []; }
	async resolveChatSessionItem(_chatSessionType: string, _resource: URI, _token: CancellationToken): Promise<IChatSessionItem | undefined> { return undefined; }
	getContentProviderSchemes(): string[] { return []; }
	registerChatSessionContentProvider(_scheme: string, _provider: IChatSessionContentProvider): IDisposable { return Disposable.None; }
	async canResolveChatSession(_sessionType: string): Promise<boolean> { return false; }
	async getOrCreateChatSession(_sessionResource: URI, _token: CancellationToken): Promise<IChatSession> { throw unsupported('IChatSessionsService.getOrCreateChatSession'); }
	async provideChatInputCompletions(_sessionResource: URI, _params: IChatInputCompletionsParams, _token: CancellationToken): Promise<IChatInputCompletionsResult | undefined> { return undefined; }
	async getChatInputCompletionTriggerCharacters(_sessionType: string): Promise<readonly string[] | undefined> { return undefined; }
	getSessionOptions(_sessionResource: URI): ReadonlyChatSessionOptionsMap | undefined { return undefined; }
	getSessionOption(_sessionResource: URI, _optionId: string): string | IChatSessionProviderOptionItem | undefined { return undefined; }
	setSessionOption(_sessionResource: URI, _optionId: string, _value: string | IChatSessionProviderOptionItem): boolean { return false; }
	updateSessionOptions(_sessionResource: URI, _updates: ReadonlyChatSessionOptionsMap): boolean { return false; }
	getCapabilitiesForSessionType(_chatSessionType: string): IChatAgentAttachmentCapabilities | undefined { return undefined; }
	getCustomAgentTargetForSessionType(_chatSessionType: string): Target { return Target.Undefined; }
	requiresCustomModelsForSessionType(_chatSessionType: string): boolean { return false; }
	supportsDelegationForSessionType(_chatSessionType: string): boolean { return false; }
	sessionSupportsFork(_sessionResource: URI): boolean { return false; }
	async forkChatSession(_sessionResource: URI, _request: IChatSessionRequestHistoryItem | undefined, _token: CancellationToken): Promise<IChatSessionItem> { throw unsupported('IChatSessionsService.forkChatSession'); }
	getOptionGroupsForSessionType(_chatSessionType: string): IChatSessionProviderOptionGroup[] | undefined { return undefined; }
	setOptionGroupsForSessionType(_chatSessionType: string, _handle: number, _optionGroups?: readonly IChatSessionProviderOptionGroup[]): void { }
	async getNewChatSessionInputState(_chatSessionType: string, _sessionResource: URI): Promise<readonly IChatSessionProviderOptionGroup[] | undefined> { return undefined; }
	async createNewChatSessionItem(_chatSessionType: string, _request: IChatNewSessionRequest, _token: CancellationToken): Promise<IChatSessionItem | undefined> { return undefined; }
	registerSessionResourceAlias(_untitledResource: URI, _realResource: URI): void { }
	fireSessionCommitted(_original: URI, _committed: URI): void { }
	registerCustomizationsProvider(_chatSessionType: string, _provider: IChatSessionCustomizationsProvider): IDisposable { return Disposable.None; }
	hasCustomizationsProvider(_chatSessionType: string): boolean { return false; }
	async getCustomizations(_chatSessionType: string, _token: CancellationToken): Promise<IChatSessionCustomizationItemGroup[] | undefined> { return undefined; }
}

class NullAgentSessionsModel implements IAgentSessionsModel {
	readonly onWillResolve: Event<string> = Event.None;
	readonly onDidResolve: Event<string> = Event.None;
	readonly onDidChangeSessions: Event<void> = Event.None;
	readonly onDidChangeSessionArchivedState: Event<IAgentSession> = Event.None;
	readonly resolved = true;
	readonly sessions: IAgentSession[] = [];

	getSession(_resource: URI): IAgentSession | undefined { return undefined; }
	observeSession(_resource: URI): IObservable<IAgentSession | undefined> { return constObservable(undefined); }
	async resolve(_provider: string | string[] | undefined): Promise<void> { }
}

class NullAgentSessionsService implements IAgentSessionsService {
	declare readonly _serviceBrand: undefined;

	readonly model = new NullAgentSessionsModel();
	readonly onDidChangeSessionArchivedState: Event<IAgentSession> = Event.None;

	getSession(_resource: URI): IAgentSession | undefined { return undefined; }
}

class NullLanguageModelsService implements ILanguageModelsService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeLanguageModelVendors: Event<readonly string[]> = Event.None;
	readonly onDidChangeLanguageModels: Event<string> = Event.None;
	readonly onDidChangeModelsControlManifest: Event<IModelsControlManifest> = Event.None;
	readonly restrictedChatParticipants = observableValue<{ [name: string]: string[] }>('opencodeCleanRestrictedChatParticipants', Object.create(null));

	getLanguageModelIds(): string[] { return []; }
	getVendors(): ILanguageModelProviderDescriptor[] { return []; }
	lookupLanguageModel(_modelId: string): ILanguageModelChatMetadata | undefined { return undefined; }
	lookupLanguageModelByQualifiedName(_qualifiedName: string): ILanguageModelChatMetadataAndIdentifier | undefined { return undefined; }
	getLanguageModelGroups(_vendor: string): ILanguageModelsGroup[] { return []; }
	hasResolvedVendor(_vendor: string): boolean { return false; }
	async selectLanguageModels(_selector: ILanguageModelChatSelector): Promise<string[]> { return []; }
	registerLanguageModelProvider(_vendor: string, _provider: ILanguageModelChatProvider): IDisposable { return Disposable.None; }
	deltaLanguageModelChatProviderDescriptors(_added: IUserFriendlyLanguageModel[], _removed: IUserFriendlyLanguageModel[]): void { }
	async sendChatRequest(_modelId: string, _from: ExtensionIdentifier | undefined, _messages: IChatMessage[], _options: ILanguageModelChatRequestOptions, _token: CancellationToken): Promise<ILanguageModelChatResponse> { throw unsupported('ILanguageModelsService.sendChatRequest'); }
	async computeTokenLength(_modelId: string, _message: string | IChatMessage, _token: CancellationToken): Promise<number> { return 0; }
	getModelConfiguration(_modelId: string): IStringDictionary<unknown> | undefined { return undefined; }
	async setModelConfiguration(_modelId: string, _values: IStringDictionary<unknown>): Promise<void> { }
	getModelConfigurationActions(_modelId: string): IAction[] { return []; }
	async addLanguageModelsProviderGroup(_name: string, _vendorId: string, _configuration: IStringDictionary<unknown> | undefined): Promise<void> { }
	async removeLanguageModelsProviderGroup(_vendorId: string, _providerGroupName: string): Promise<void> { }
	async configureLanguageModelsProviderGroup(_vendorId: string, _name?: string): Promise<void> { }
	async configureModel(_modelId: string): Promise<void> { }
	async migrateLanguageModelsProviderGroup(_languageModelsProviderGroup: ILanguageModelsProviderGroup): Promise<void> { }
	getRecentlyUsedModelIds(): string[] { return []; }
	addToRecentlyUsedList(_modelIdentifier: string): void { }
	clearRecentlyUsedList(): void { }
	getModelsControlManifest(): IModelsControlManifest { return { free: {}, paid: {} }; }
}

class NullLanguageModelToolsService implements ILanguageModelToolsService {
	declare readonly _serviceBrand: undefined;

	readonly vscodeToolSet: ToolSet;
	readonly executeToolSet: ToolSet;
	readonly readToolSet: ToolSet;
	readonly agentToolSet: ToolSet;
	readonly onDidChangeTools: Event<void> = Event.None;
	readonly onDidPrepareToolCallBecomeUnresponsive: Event<{ readonly sessionResource: URI; readonly toolData: IToolData }> = Event.None;
	readonly onDidInvokeTool: Event<IToolInvokedEvent> = Event.None;
	readonly toolSets: IObservable<Iterable<IToolSet>> = constObservable([]);

	constructor(@IContextKeyService private readonly contextKeyService: IContextKeyService) {
		this.vscodeToolSet = new ToolSet('vscode', 'vscode', ThemeIcon.fromId(Codicon.code.id), ToolDataSource.Internal, undefined, undefined, this.contextKeyService);
		this.executeToolSet = new ToolSet('execute', 'execute', ThemeIcon.fromId(Codicon.terminal.id), ToolDataSource.Internal, undefined, undefined, this.contextKeyService);
		this.readToolSet = new ToolSet('read', 'read', ThemeIcon.fromId(Codicon.book.id), ToolDataSource.Internal, undefined, undefined, this.contextKeyService);
		this.agentToolSet = new ToolSet('agent', 'agent', ThemeIcon.fromId(Codicon.agent.id), ToolDataSource.Internal, undefined, undefined, this.contextKeyService);
	}

	registerToolData(_toolData: IToolData): IDisposable { return Disposable.None; }
	registerToolImplementation(_id: string, _tool: IToolImpl): IDisposable { return Disposable.None; }
	registerTool(_toolData: IToolData, _tool: IToolImpl): IDisposable { return Disposable.None; }
	getTools(_model: ILanguageModelChatMetadata | undefined): Iterable<IToolData> { return []; }
	observeTools(_model: ILanguageModelChatMetadata | undefined): IObservable<readonly IToolData[]> { return constObservable([]); }
	getAllToolsIncludingDisabled(): Iterable<IToolData> { return []; }
	getTool(_id: string): IToolData | undefined { return undefined; }
	getToolByName(_name: string): IToolData | undefined { return undefined; }
	beginToolCall(_options: IBeginToolCallOptions) { return undefined; }
	async updateToolStream(_toolCallId: string, _partialInput: unknown, _token: CancellationToken): Promise<void> { }
	async invokeTool(_invocation: IToolInvocation, _countTokens: CountTokensCallback, _token: CancellationToken): Promise<IToolResult> { throw unsupported('ILanguageModelToolsService.invokeTool'); }
	cancelToolCallsForRequest(_requestId: string): void { }
	flushToolUpdates(): void { }
	getToolSetsForModel(_model: ILanguageModelChatMetadata | undefined, _reader?: IReader): Iterable<IToolSet> { return []; }
	getToolSet(_id: string): IToolSet | undefined { return undefined; }
	getToolSetByName(_name: string): IToolSet | undefined { return undefined; }
	createToolSet(source: ToolDataSource, id: string, referenceName: string, options?: { icon?: ThemeIcon; description?: string; legacyFullNames?: string[] }): ToolSet & IDisposable {
		const toolSet = new ToolSet(id, referenceName, options?.icon ?? ThemeIcon.fromId(Codicon.tools.id), source, options?.description, options?.legacyFullNames, this.contextKeyService);
		return Object.assign(toolSet, { dispose: () => { } });
	}
	getFullReferenceNames(): Iterable<string> { return []; }
	getFullReferenceName(_tool: IToolData, _toolSet?: IToolSet): string { return ''; }
	getToolByFullReferenceName(_fullReferenceName: string): IToolData | IToolSet | undefined { return undefined; }
	getDeprecatedFullReferenceNames(): Map<string, Set<string>> { return new Map(); }
	toToolAndToolSetEnablementMap(_fullReferenceNames: readonly string[], _model: ILanguageModelChatMetadata | undefined): IToolAndToolSetEnablementMap { return new Map(); }
	toFullReferenceNames(_map: IToolAndToolSetEnablementMap): string[] { return []; }
	toToolReferences(_variableReferences: readonly IVariableReference[]): ChatRequestToolReferenceEntry[] { return []; }
}

class NullAgentNetworkFilterService implements IAgentNetworkFilterService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void> = Event.None;

	isUriAllowed(_uri: URI, _toolName?: string): boolean { return true; }
	formatError(uri: URI): string { return `Network access is disabled for ${uri.toString()} in the OpenCode clean build.`; }
}

class CleanCustomizationHarnessService extends CustomizationHarnessServiceBase {
	constructor(@IPromptsService promptsService: IPromptsService) {
		super([createVSCodeHarnessDescriptor([])], SessionType.Local, promptsService);
	}
}

class NullToolResultCompressor implements IToolResultCompressor {
	declare readonly _serviceBrand: undefined;

	registerFilter(_filter: IToolResultFilter): void { }
	maybeCompress(_toolId: string, _input: unknown, _result: IToolResult): IToolResult | undefined { return undefined; }
}

class NullCodeMapperService implements ICodeMapperService {
	declare readonly _serviceBrand: undefined;
	readonly providers: ICodeMapperProvider[] = [];

	registerCodeMapperProvider(_handle: number, _provider: ICodeMapperProvider): IDisposable { return Disposable.None; }
	async mapCode(_request: ICodeMapperRequest, _response: ICodeMapperResponse, _token: CancellationToken): Promise<ICodeMapperResult | undefined> { return undefined; }
}

class NullAgentPluginService implements IAgentPluginService {
	declare readonly _serviceBrand: undefined;
	readonly plugins = constObservable([]);
	readonly enablementModel: IEnablementModel = {
		readEnabled: (_key: string, _reader?: IReader) => ContributionEnablementState.DisabledProfile,
		setEnabled: (_key: string, _state: ContributionEnablementState) => { },
		remove: (_key: string) => { },
	};
}

class NullPluginInstallService implements IPluginInstallService {
	declare readonly _serviceBrand: undefined;

	async installPlugin(_plugin: IMarketplacePlugin): Promise<void> { throw unsupported('IPluginInstallService.installPlugin'); }
	async installPluginFromSource(_source: string, _options?: IInstallPluginFromSourceOptions): Promise<void> { throw unsupported('IPluginInstallService.installPluginFromSource'); }
	validatePluginSource(_source: string): string | undefined { return undefined; }
	async installPluginFromValidatedSource(_source: string, _options?: IInstallPluginFromSourceOptions): Promise<IInstallPluginFromSourceResult> { return { success: false, message: 'Plugin installation is not supported in the OpenCode clean build.' }; }
	async updatePlugin(_plugin: IMarketplacePlugin): Promise<boolean> { return false; }
	async updateAllPlugins(_options: IUpdateAllPluginsOptions, _token: CancellationToken): Promise<IUpdateAllPluginsResult> { return { updatedNames: [], failedNames: [] }; }
	getPluginInstallUri(_plugin: IMarketplacePlugin): URI { return URI.file('/opencode-clean-plugin'); }
}

class NullChatOutputRendererService implements IChatOutputRendererService {
	declare readonly _serviceBrand: undefined;

	registerRenderer(_mime: string, _renderer: IChatOutputItemRenderer, _options: unknown): IDisposable { return Disposable.None; }
	async renderOutputPart(_mime: string, _data: Uint8Array, _parent: HTMLElement, _webviewOptions: unknown, _token: CancellationToken): Promise<RenderedOutputPart> { throw unsupported('IChatOutputRendererService.renderOutputPart'); }
}

registerSingleton(IChatService, NullChatService, InstantiationType.Delayed);
registerSingleton(IChatWidgetService, NullChatWidgetService, InstantiationType.Delayed);
registerSingleton(IChatAgentService, NullChatAgentService, InstantiationType.Delayed);
registerSingleton(IChatSessionsService, NullChatSessionsService, InstantiationType.Delayed);
registerSingleton(ILanguageModelsService, NullLanguageModelsService, InstantiationType.Delayed);
registerSingleton(ILanguageModelToolsService, NullLanguageModelToolsService, InstantiationType.Delayed);
registerSingleton(IToolResultCompressor, NullToolResultCompressor, InstantiationType.Delayed);
registerSingleton(IAgentNetworkFilterService, NullAgentNetworkFilterService, InstantiationType.Delayed);
registerSingleton(ILanguageModelIgnoredFilesService, LanguageModelIgnoredFilesService, InstantiationType.Delayed);
registerSingleton(ICodeMapperService, NullCodeMapperService, InstantiationType.Delayed);
registerSingleton(IChatDebugService, ChatDebugServiceImpl, InstantiationType.Delayed);
registerSingleton(IAgentSessionsService, NullAgentSessionsService, InstantiationType.Delayed);
registerSingleton(IAgentPluginService, NullAgentPluginService, InstantiationType.Delayed);
registerSingleton(IPluginInstallService, NullPluginInstallService, InstantiationType.Delayed);
registerSingleton(IChatOutputRendererService, NullChatOutputRendererService, InstantiationType.Delayed);
registerSingleton(IChatContextPickService, ChatContextPickService, InstantiationType.Delayed);
registerSingleton(IPromptsService, PromptsService, InstantiationType.Delayed);
registerSingleton(IChatTodoListService, ChatTodoListService, InstantiationType.Delayed);
registerSingleton(IChatArtifactsService, ChatArtifactsService, InstantiationType.Delayed);
registerSingleton(ICustomizationHarnessService, CleanCustomizationHarnessService, InstantiationType.Delayed);
