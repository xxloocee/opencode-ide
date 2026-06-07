/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Schemas } from '../../../../base/common/network.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAIExtensionDescriptor } from '../common/aiExtensions.js';

const AIExtensionEditorIcon = registerIcon('ai-extension-editor-icon', Codicon.sparkle, localize('aiExtensionEditorLabelIcon', 'Icon of the AI Extension editor.'));

export class AIExtensionEditorInput extends EditorInput {

	static readonly ID = 'workbench.aiExtension.input';

	override get typeId(): string {
		return AIExtensionEditorInput.ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton;
	}

	override get resource(): URI {
		return URI.from({
			scheme: Schemas.extension,
			path: `/aiExtension/${encodeURIComponent(this.item.id)}`
		});
	}

	constructor(readonly item: IAIExtensionDescriptor) {
		super();
	}

	override getName(): string {
		return localize('aiExtensionInputName', "AI Extension: {0}", this.item.name);
	}

	override getIcon(): ThemeIcon | undefined {
		return AIExtensionEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof AIExtensionEditorInput && this.item.id === other.item.id;
	}
}
