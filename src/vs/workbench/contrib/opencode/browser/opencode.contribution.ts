/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { WebviewViewPane } from '../../webviewView/browser/webviewViewPane.js';
import { IViewContainersRegistry, IViewDescriptor, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainer, ViewContainerLocation, WindowEnablement } from '../../../common/views.js';
import {
	SessionsOpenCodeCommandSettingId,
	SessionsOpenCodeCwdSettingId,
	SessionsOpenCodeEnableGenerativeUiCspSettingId,
	SessionsOpenCodeUiPackageSettingId,
} from '../../../../platform/opencode/common/opencodeHost.js';
import { OpenCodeViewId } from './views/opencodeView.js';

const openCodeViewIcon = registerIcon('opencode-view-icon', Codicon.sparkle, localize('openCodeViewIcon', "Icon for OpenCode View"));
const OPENCODE_VIEW_TITLE = localize2('openCode.view.label', "OpenCode");
const OpenCodeContainerId = 'agentic.workbench.view.opencodeContainer';

const openCodeViewContainer: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: OpenCodeContainerId,
	title: OPENCODE_VIEW_TITLE,
	icon: openCodeViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [OpenCodeContainerId, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: OpenCodeContainerId,
	hideIfEmpty: true,
	order: 2,
	windowEnablement: WindowEnablement.Editor
}, ViewContainerLocation.AuxiliaryBar);

const openCodeViewDescriptor: IViewDescriptor = {
	id: OpenCodeViewId,
	containerIcon: openCodeViewIcon,
	containerTitle: OPENCODE_VIEW_TITLE.value,
	singleViewPaneContainerTitle: OPENCODE_VIEW_TITLE.value,
	name: OPENCODE_VIEW_TITLE,
	canToggleVisibility: true,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(WebviewViewPane),
	windowEnablement: WindowEnablement.Editor
};

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([openCodeViewDescriptor], openCodeViewContainer);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'sessions.openCode',
	properties: {
		[SessionsOpenCodeCommandSettingId]: {
			type: 'string',
			default: '',
			scope: ConfigurationScope.APPLICATION,
			description: localize('openCode.command', "Optional shell command used to start a local OpenCode server when the view opens.")
		},
		[SessionsOpenCodeCwdSettingId]: {
			type: 'string',
			default: '',
			scope: ConfigurationScope.APPLICATION,
			description: localize('openCode.cwd', "Optional working directory used to launch the OpenCode server command. When empty, ErgouziCode falls back to the current window workspace root.")
		},
		[SessionsOpenCodeUiPackageSettingId]: {
			type: 'string',
			default: 'app-ide',
			scope: ConfigurationScope.APPLICATION,
			description: localize('openCode.uiPackage', "Optional OpenCode web UI package name to inject via OPENCODE_UI_PACKAGE when launching the local runtime.")
		},
		[SessionsOpenCodeEnableGenerativeUiCspSettingId]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('openCode.enableGenerativeUiCsp', "When enabled, ErgouziCode injects OPENCODE_ENABLE_GENERATIVE_UI_CSP=1 for app-ide launches so generative widgets can use the IDE-specific CSP policy.")
		},
	}
});
