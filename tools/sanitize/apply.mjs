import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { applyOverlays } from './lib/overlays.mjs';
import { applyPatchSets } from './lib/patches.mjs';

const defaultRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const root = path.resolve(readArg('root') ?? defaultRoot);
const profile = readArg('profile') ?? 'clean-lite';
const configPath = path.join(root, 'config', 'sanitize', `${profile}.json`);

if (!fs.existsSync(configPath)) {
	throw new Error(`Missing sanitize config: ${configPath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
console.log(`[sanitize] profile=${profile}`);
console.log(`[sanitize] steps=${(config.steps || []).length}`);

for (const step of config.steps || []) {
	if (step === 'rewrite-product') {
		rewriteProduct();
	} else if (step === 'rewrite-package') {
		rewritePackageJson();
	} else if (step === 'rewrite-build-copilot') {
		rewriteBuildForCopilotRemoval();
	} else if (step === 'rewrite-build-auth') {
		rewriteBuildForAuthRemoval();
	} else if (step === 'rewrite-telemetry-defaults') {
		rewriteTelemetryDefaults();
	} else if (step === 'rewrite-branding-text') {
		rewriteBrandingText();
	} else if (step === 'rewrite-welcome-startup-defaults') {
		rewriteWelcomeStartupDefaults();
	} else if (step === 'rewrite-product-icons') {
		rewriteProductIcons();
	} else if (step === 'apply-overlays') {
		applyConfiguredOverlays();
	} else if (step === 'apply-patches') {
		applyConfiguredPatches();
	} else if (step === 'rewrite-packaging') {
		rewritePackaging();
	} else if (step === 'verify') {
		runVerify();
	} else {
		throw new Error(`Unknown sanitize step: ${step}`);
	}
}

function rewriteProduct() {
	const file = path.join(root, 'product.json');
	const product = JSON.parse(fs.readFileSync(file, 'utf8'));

	product.nameShort = 'OpenCode IDE';
	product.nameLong = 'OpenCode IDE';
	product.applicationName = 'opencode-ide';
	product.dataFolderName = '.opencode-ide';
	product.sharedDataFolderName = '.opencode-ide-shared';
	product.win32MutexName = 'opencodeide';
	product.serverApplicationName = 'opencode-ide-server';
	product.serverDataFolderName = '.opencode-ide-server';
	product.tunnelApplicationName = 'opencode-ide-tunnel';
	product.win32DirName = 'OpenCode IDE';
	product.win32NameVersion = 'OpenCode IDE';
	product.win32RegValueName = 'OpenCodeIDE';
	product.win32AppUserModelId = 'OpenCode.IDE';
	product.win32ShellNameShort = 'Open&Code IDE';
	product.win32TunnelServiceMutex = 'opencodeide-tunnelservice';
	product.win32TunnelMutex = 'opencodeide-tunnel';
	product.darwinBundleIdentifier = 'com.opencode.ide';
	product.linuxIconName = 'opencode-ide';
	product.urlProtocol = 'opencode-ide';
	delete product.webviewContentExternalBaseUrlTemplate;

	product.defaultChatAgent = {
		extensionId: 'opencode.ide-placeholder',
		chatExtensionId: 'opencode.ide-placeholder-chat',
		chatExtensionOutputId: '',
		chatExtensionOutputExtensionStateCommand: '',
		documentationUrl: '',
		skusDocumentationUrl: '',
		publicCodeMatchesUrl: '',
		manageSettingsUrl: '',
		managePlanUrl: '',
		manageOverageUrl: '',
		upgradePlanUrl: '',
		signUpUrl: '',
		termsStatementUrl: '',
		privacyStatementUrl: '',
		provider: {
			default: { id: 'opencode', name: 'OpenCode' },
			enterprise: { id: 'opencode-enterprise', name: 'OpenCode Enterprise' },
			google: { id: 'google', name: 'Google' },
			apple: { id: 'apple', name: 'Apple' }
		},
		providerExtensionId: '',
		providerUriSetting: '',
		providerScopes: [],
		entitlementUrl: '',
		entitlementSignupLimitedUrl: '',
		tokenEntitlementUrl: '',
		mcpRegistryDataUrl: '',
		chatQuotaExceededContext: '',
		completionsQuotaExceededContext: '',
		walkthroughCommand: '',
		completionsMenuCommand: '',
		chatRefreshTokenCommand: '',
		generateCommitMessageCommand: '',
		resolveMergeConflictsCommand: '',
		completionsAdvancedSetting: '',
		completionsEnablementSetting: '',
		nextEditSuggestionsSetting: ''
	};
	delete product.trustedExtensionAuthAccess;

	if (Array.isArray(product.builtInExtensionsEnabledWithAutoUpdates)) {
		product.builtInExtensionsEnabledWithAutoUpdates = product.builtInExtensionsEnabledWithAutoUpdates.filter(id => id !== 'GitHub.copilot-chat');
	}

	if (Array.isArray(product.onboardingKeymaps)) {
		product.onboardingKeymaps = product.onboardingKeymaps.map(item =>
			item.id === 'vscode' ? { ...item, label: 'OpenCode IDE' } : item
		);
	}

	if (Array.isArray(product.builtInExtensions)) {
		product.builtInExtensions = product.builtInExtensions.map(item => ({
			...item,
			metadata: item.metadata ? {
				...item.metadata,
				publisherId: item.metadata.publisherId ? {
					...item.metadata.publisherId,
					displayName: 'OpenCode IDE',
					flags: ''
				} : item.metadata.publisherId,
				publisherDisplayName: 'OpenCode IDE'
			} : item.metadata
		}));
	}

	product.reportIssueUrl = 'https://github.com/xxloocee/opencode-ide/issues/new';
	product.licenseUrl = 'https://github.com/xxloocee/opencode-ide/blob/main/LICENSE.txt';
	product.serverLicenseUrl = 'https://github.com/xxloocee/opencode-ide/blob/main/LICENSE.txt';

	fs.writeFileSync(file, JSON.stringify(product, null, '\t') + '\n');
	console.log('[sanitize] rewrite-product');
}

function rewritePackageJson() {
	const file = path.join(root, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

	delete pkg.scripts['watch-copilot'];
	delete pkg.scripts['watch-copilotd'];
	delete pkg.scripts['kill-watch-copilotd'];
	delete pkg.scripts['copilot:setup'];
	delete pkg.scripts['copilot:get_token'];

	if (pkg.scripts.watch && typeof pkg.scripts.watch === 'string') {
		pkg.scripts.watch = pkg.scripts.watch.replace(/\s*watch-copilot/, '');
	}

	pkg.scripts = insertScriptsAfter(pkg.scripts, 'mixin-telemetry-docs', {
		'sanitize:scan': 'node tools/sanitize/scan.mjs',
		'sanitize:apply': 'node tools/sanitize/apply.mjs',
		'sanitize:verify': 'node tools/sanitize/verify.mjs',
	});

	delete pkg.dependencies['@github/copilot'];
	delete pkg.dependencies['@github/copilot-sdk'];
	delete pkg.dependencies['@vscode/copilot-api'];

	fs.writeFileSync(file, JSON.stringify(pkg, null, '  ') + '\n');
	console.log('[sanitize] rewrite-package');
}

function rewriteBuildForCopilotRemoval() {
	rewriteTextFile(path.join(root, 'build', 'gulpfile.vscode.ts'), text => text
		.replace(', compileCopilotExtensionBuildTask', '')
		.replace("import { getCopilotExcludeFilter, getCopilotRuntimePrebuildFiles, getRipgrepExcludeFilter, prepareBuiltInCopilotRipgrepShim } from './lib/copilot.ts';\n", "import { getRipgrepExcludeFilter } from './lib/copilot.ts';\n")
		.replace(/\t\tconst copilotRuntimePrebuilds = gulp\.src\(getCopilotRuntimePrebuildFiles\(platform, arch\), \{ base: '\.', dot: true, allowEmpty: true \}\);\r?\n/, '')
		.replace(/\t\tconst deps = es\.merge\(cleanedDeps, copilotRuntimePrebuilds\)\r?\n/, '\t\tconst deps = cleanedDeps\n')
		.replace("\t\t\t.pipe(filter(getCopilotExcludeFilter(platform, arch)))\n", '')
		.replace("\t\t\t\t'**/@github/copilot-*/**',\n", '')
		.replace(/\t\tconst builtInCopilotExtensionDir = path\.join\(appBase, 'extensions', 'copilot'\);\r?\n/, '')
		.replace(/\r?\n\t\tprepareBuiltInCopilotRipgrepShim\(platform, arch, builtInCopilotExtensionDir, appNodeModulesDir\);\r?\n/, '\n\t\tvoid appNodeModulesDir;\n')
		.replace(/(\t\tconst appNodeModulesDir = path\.join\(appBase, 'node_modules'\);\r?\n)\r?\n(\t\tvoid appNodeModulesDir;)/, '$1$2')
		.replace(/\t\t\t\tcompileCopilotExtensionBuildTask,\r?\n/g, '')
	);

	rewriteTextFile(path.join(root, 'build', 'gulpfile.reh.ts'), text => text
		.replace(', compileCopilotExtensionBuildTask', '')
		.replace("import { getCopilotExcludeFilter, getCopilotRuntimePrebuildFiles, getRipgrepExcludeFilter, prepareBuiltInCopilotRipgrepShim } from './lib/copilot.ts';\n", "import { getRipgrepExcludeFilter } from './lib/copilot.ts';\n")
		.replace(/\t\tconst copilotRuntimePrebuilds = gulp\.src\(getCopilotRuntimePrebuildFiles\(platform, arch, 'remote\/node_modules'\), \{ base: 'remote', dot: true, allowEmpty: true \}\);\r?\n/, '')
		.replace(/\t\tconst deps = es\.merge\(cleanedDeps, copilotRuntimePrebuilds\)\r?\n/, '\t\tconst deps = cleanedDeps\n')
		.replace("\t\t\t.pipe(filter(getCopilotExcludeFilter(platform, arch)))\n", '')
		.replace(/\t\tconst builtInCopilotExtensionDir = path\.join\(outputDir, 'extensions', 'copilot'\);\r?\n/, '')
		.replace(/\r?\n\t\tprepareBuiltInCopilotRipgrepShim\(platform, arch, builtInCopilotExtensionDir, nodeModulesDir\);\r?\n/, '\n\t\tvoid platform;\n\t\tvoid arch;\n\t\tvoid destinationFolderName;\n\t\tvoid outputDir;\n\t\tvoid nodeModulesDir;\n')
		.replace(/(\t\tconst nodeModulesDir = path\.join\(outputDir, 'node_modules'\);\r?\n)\r?\n(\t\tvoid platform;)/, '$1$2')
		.replace(/\t\t\t\tcompileCopilotExtensionBuildTask,\r?\n/g, '')
	);

	rewriteTextFile(path.join(root, 'build', 'gulpfile.extensions.ts'), text => text
		.replace(/\/\*\*\r?\n \* Compiles the built-in copilot extension for the build\.\r?\n \* Used by non-CI local builds where copilot is not downloaded as a VSIX\.\r?\n \*\/\r?\nexport const compileCopilotExtensionBuildTask = task\.define\('compile-copilot-extension-build', \(\) => ext\.packageCopilotExtensionStream\(false\)\.pipe\(gulp\.dest\('\.build'\)\)\);\r?\n(?:gulp|task)\.task\(compileCopilotExtensionBuildTask\);\r?\n\r?\n/, '')
	);

	rewriteTextFile(path.join(root, 'build', 'npm', 'dirs.ts'), text => text
		.replace("\t'extensions/copilot',\n", '')
	);

	console.log('[sanitize] rewrite-build-copilot');
}

function rewriteBuildForAuthRemoval() {
	rewriteTextFile(path.join(root, 'build', 'gulpfile.extensions.ts'), text => text
		.replace("\t'extensions/github-authentication/tsconfig.json',\n", '')
		.replace("\t'extensions/microsoft-authentication/tsconfig.json',\n", '')
	);

	rewriteTextFile(path.join(root, 'build', 'npm', 'dirs.ts'), text => text
		.replace("\t'extensions/github-authentication',\n", '')
		.replace("\t'extensions/microsoft-authentication',\n", '')
	);

	rewriteTextFile(path.join(root, 'build', 'lib', 'extensions.ts'), text => text
		.replace(
			/const excludedExtensions = \[\n([\s\S]*?)\n\];/,
			(match, body) => {
				const lines = body
					.split('\n')
					.map(line => line.trim())
					.filter(Boolean);
				const values = lines.map(line => line.replace(/,$/, '').replace(/^'/, '').replace(/'$/, ''));
				for (const value of ['microsoft-authentication', 'github-authentication']) {
					if (!values.includes(value)) {
						values.splice(1, 0, value);
					}
				}
				const rendered = values.map(value => `\t'${value}',`).join('\n');
				return `const excludedExtensions = [\n${rendered}\n];`;
			}
		)
	);

	console.log('[sanitize] rewrite-build-auth');
}

function rewriteTelemetryDefaults() {
	rewriteTextFile(path.join(root, 'src', 'vs', 'platform', 'telemetry', 'common', 'telemetryService.ts'), text => text
		.replace("'default': TelemetryConfiguration.ON,", "'default': TelemetryConfiguration.OFF,")
		.replace("'default': true,", "'default': false,")
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'browser', 'workbench.contribution.ts'), text => text
		.replace(/('workbench\.commandPalette\.experimental\.enableNaturalLanguageSearch': \{[\s\S]*?'default': )true(\s*[\r\n]\s*\})/, '$1false$2')
		.replace(/('workbench\.quickOpen\.closeOnFocusLost': \{[\s\S]*?'default': )true(\s*[\r\n]\s*\})/, '$1false$2')
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'editTelemetry', 'browser', 'editTelemetry.contribution.ts'), text => text
		.replace('default: true,', 'default: false,')
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'preferences', 'common', 'preferencesContribution.ts'), text => text
		.replace(/('workbench\.settings\.enableNaturalLanguageSearch': \{[\s\S]*?'default': )true,/, "$1false,")
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'electron-browser', 'desktop.contribution.ts'), text => text
		.replace(/('keyboard\.touchbar\.enabled': \{[\s\S]*?'default': )true,/, '$1false,')
		.replace(/('telemetry\.enableCrashReporter': \{[\s\S]*?'default': )true,/, '$1false,')
		.replace(/('security\.promptForLocalFileProtocolHandling': \{[\s\S]*?'default': )true,/, '$1false,')
		.replace(/('security\.promptForRemoteFileProtocolHandling': \{[\s\S]*?'default': )true,/, '$1false,')
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'services', 'assignment', 'common', 'assignmentService.ts'), text => text
		.replace(/('workbench\.enableExperiments': \{[\s\S]*?'default': )true,/, "$1false,")
	);

	console.log('[sanitize] rewrite-telemetry-defaults');
}

function rewriteBrandingText() {
	for (const localeFile of fs.readdirSync(path.join(root, 'build', 'win32', 'i18n'))) {
		if (!localeFile.endsWith('.isl')) {
			continue;
		}
		rewriteTextFile(path.join(root, 'build', 'win32', 'i18n', localeFile), text => text
			.replace(/(UpdatingVisualStudioCode=.*)Visual Studio Code(.*)/, '$1OpenCode IDE$2')
			.replace(/UpdatingVisualStudioCode=A OpenCode IDE frissítése\.\.\./, 'UpdatingVisualStudioCode=Az OpenCode IDE frissítése...')
			.replace(/\r?\n?$/, '\n')
		);
	}

	rewriteTextFile(path.join(root, 'resources', 'linux', 'snap', 'snapcraft.yaml'), text => text
		.replace(/  Visual Studio Code is a new choice of tool that combines the\r?\n  simplicity of a code editor with what developers need for the core\r?\n  edit-build-debug cycle\./, '  OpenCode IDE is a code editor distribution that combines the\n  simplicity of a code editor with the integrated OpenCode assistant\n  and a sanitized default distribution.')
	);

	for (const [rel, replacements] of Object.entries({
		'src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts': [
			['When enabled, VS Code installs only newly added extensions from the extension pack VSIX. This option is considered only when installing VSIX.', 'When enabled, OpenCode IDE installs only newly added extensions from the extension pack VSIX. This option is considered only when installing VSIX.'],
			['When enabled, VS Code installs only newly added extensions from the extension pack VSIX. This option is considered only while installing a VSIX.', 'When enabled, OpenCode IDE installs only newly added extensions from the extension pack VSIX. This option is considered only while installing a VSIX.'],
			['When enabled, VS Code installs the pre-release version of the extension if available.', 'When enabled, OpenCode IDE installs the pre-release version of the extension if available.'],
			['When enabled, VS Code do not sync this extension when Settings Sync is on.', 'When enabled, OpenCode IDE does not sync this extension when Settings Sync is on.'],
			['Please reload Visual Studio Code to enable them.', 'Please reload OpenCode IDE to enable them.'],
			['Please reload Visual Studio Code to enable it.', 'Please reload OpenCode IDE to enable it.'],
		],
		'src/vs/workbench/contrib/extensions/browser/extensionsActions.ts': [
			['This extension is deprecated as this functionality is now built-in to VS Code.', 'This extension is deprecated as this functionality is now built-in to OpenCode IDE.'],
			['Please reload Visual Studio Code to complete the uninstallation of the extension {0}.', 'Please reload OpenCode IDE to complete the uninstallation of the extension {0}.'],
		],
		'src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts': [
			['**Notice:** This extension is bundled with Visual Studio Code. It can be disabled but not uninstalled.', '**Notice:** This extension is bundled with OpenCode IDE. It can be disabled but not uninstalled.'],
			['Please check the [VS Code Release Notes]', 'Please check the [OpenCode IDE Release Notes]'],
		],
		'src/vs/workbench/contrib/extensions/common/extensionsFileTemplate.ts': [
			['List of extensions recommended by VS Code that should not be recommended for users of this workspace.', 'List of extensions recommended by OpenCode IDE that should not be recommended for users of this workspace.'],
		],
		'src/vs/workbench/contrib/extensions/common/installExtensionsTool.ts': [
			['This is a tool for installing extensions in Visual Studio Code.', 'This is a tool for installing extensions in OpenCode IDE.'],
		],
		'src/vs/workbench/contrib/extensions/common/searchExtensionsTool.ts': [
			['This is a tool for browsing Visual Studio Code Extensions Marketplace.', 'This is a tool for browsing the OpenCode IDE extensions marketplace.'],
			['Search for VS Code extensions', 'Search for OpenCode IDE extensions'],
		],
		'src/vs/workbench/contrib/extensions/electron-browser/extensionsSlowActions.ts': [
			['VS Code version:', 'OpenCode IDE version:'],
		],
		'src/vs/workbench/contrib/issue/browser/baseIssueReporterService.ts': [
			['E.g Workbench is missing problems panel', 'E.g OpenCode IDE is missing the problems panel'],
			['Visual Studio Code', 'OpenCode IDE'],
			['A VS Code extension', 'An OpenCode IDE extension'],
			['This extension handles issues outside of VS Code', 'This extension handles issues outside of OpenCode IDE'],
		],
		'src/vs/workbench/contrib/issue/browser/issueReporterModel.ts': [
			['VS Code version:', 'OpenCode IDE version:'],
		],
		'src/vs/workbench/contrib/issue/browser/issueReporterPage.ts': [
			['I acknowledge that my VS Code version is not updated and this issue may be closed.', 'I acknowledge that my OpenCode IDE version is not updated and this issue may be closed.'],
		],
		'src/vs/workbench/contrib/opencode/browser/opencode.contribution.ts': [
			['QuantCode falls back to the current window workspace root.', 'OpenCode IDE falls back to the current window workspace root.'],
			['QuantCode injects OPENCODE_ENABLE_GENERATIVE_UI_CSP=1', 'OpenCode IDE injects OPENCODE_ENABLE_GENERATIVE_UI_CSP=1'],
		],
		'src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts': [
			['Welcome to Visual Studio Code', 'Welcome to OpenCode IDE'],
			['Welcome to VS Code', 'Welcome to OpenCode IDE'],
			['VS Code', 'OpenCode IDE'],
			['GitHub Copilot', 'OpenCode'],
			['Copilot CLI', 'OpenCode CLI'],
			['Tailor Copilot', 'Tailor OpenCode'],
		],
		'src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts': [
			['Visual Studio Code', 'OpenCode IDE'],
			['VS Code', 'OpenCode IDE'],
			['Copilot', 'OpenCode'],
		],
	})) {
		rewriteTextFile(path.join(root, rel), text => {
			let next = text;
			for (const [from, to] of replacements) {
				next = next.replaceAll(from, to);
			}
			return next;
		});
	}

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeOnboarding', 'browser', 'onboardingVariationA.ts'), text => text
		.replace(/import \{ assertDefined \} from '..\/..\/..\/..\/base\/common\/types\.js';\r?\n/, '')
		.replace(/assertDefined\(product\.defaultChatAgent, 'Onboarding requires a default chat agent product configuration\.'\);\r?\nconst defaultChat = product\.defaultChatAgent;/, 'const defaultChat = product.defaultChatAgent;')
		.replace(/private readonly steps = .*ONBOARDING_STEPS.*;/, 'private readonly steps = ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);')
		.replace('if (!this._footerSignInBtn && !this._userSignedIn) {', 'if (false) {')
		.replace('this._footerSignInBtn.textContent = localize(\'onboarding.sessions.signInNudge\', "Sign in for AI Powered Features");', 'this._footerSignInBtn.textContent = \'\';')
		.replace(/\r?\n\t\t\/\/ Tutorial link at bottom of content, above footer\r?\n\t\tconst docsRow = append\(wrapper, \$\('\.onboarding-a-sessions-docs'\)\);\r?\n\t\tthis\._createDocLink\(docsRow, localize\('onboarding\.sessions\.agentsTutorial', "Agents tutorial"\), 'https:\/\/code\.visualstudio\.com\/docs\/copilot\/agents\/agents-tutorial', 'agentsTutorial'\);\r?\n/, '\n')
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeOnboarding', 'common', 'onboardingTypes.ts'), text => text
		.replace(/\tOnboardingStepId\.SignIn,\r?\n/, '')
	);

	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeGettingStarted', 'common', 'gettingStartedContent.ts'), text => text
		.replace(/[\t ]*create(?:Copilot|OpenCode)SetupStep\('(?:Copilot|OpenCode)Setup(?:Anonymous|SignedOut|Complete|SignedIn)'[^\n]*\r?\n/g, '')
		.replace(/\r?\n\t\t\t\t\{\r?\n\t\t\t\t\tid: 'videoTutorial',[\s\S]*?\r?\n\t\t\t\t\}\r?\n/, '\n')
		.replace("'https://aka.ms/vscode-install-git'", "'command:workbench.view.scm'")
		.replace("'https://code.visualstudio.com/docs/editor/workspace-trust'", "'command:toSide:workbench.trust.manage'")
	);

	console.log('[sanitize] rewrite-branding-text');
}

function rewriteWelcomeStartupDefaults() {
	rewriteTextFile(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeGettingStarted', 'browser', 'gettingStarted.contribution.ts'), text => text
		.replace(/('workbench\.startupEditor': \{[\s\S]*?'default': )'welcomePage'(,)/, "$1'none'$2")
	);

	console.log('[sanitize] rewrite-welcome-startup-defaults');
}

function rewritePackaging() {
	rewriteTextFile(path.join(root, 'resources', 'linux', 'code.desktop'), text => text
		.replace('Keywords=vscode;', 'Keywords=opencode;ide;')
	);

	rewriteTextFile(path.join(root, 'resources', 'linux', 'code.appdata.xml'), text => text
		.replace('<url type="homepage">https://code.visualstudio.com</url>', '<url type="homepage">https://github.com/xxloocee/opencode-ide</url>')
		.replace('<summary>Visual Studio Code. Code editing. Redefined.</summary>', '<summary>OpenCode IDE. Code editing with an integrated OpenCode assistant.</summary>')
		.replace('<p>Visual Studio Code is a new choice of tool that combines the simplicity of a code editor with what developers need for the core edit-build-debug cycle. See https://code.visualstudio.com/docs/setup/linux for installation instructions and FAQ.</p>', '<p>OpenCode IDE combines a familiar code editing workflow with the integrated OpenCode assistant. This distribution is packaged without Microsoft product branding, official account sign-in defaults, or Copilot chat defaults.</p>')
		.replace('<image>https://code.visualstudio.com/home/home-screenshot-linux-lg.png</image>', '<image>https://raw.githubusercontent.com/xxloocee/opencode-ide/main/.github/assets/opencode-ide-screenshot-linux.png</image>')
	);

	rewriteTextFile(path.join(root, 'resources', 'linux', 'debian', 'control.template'), text => text
		.replace('Maintainer: Microsoft Corporation <vscode-linux@microsoft.com>', 'Maintainer: OpenCode IDE Maintainers <noreply@opencode-ide.local>')
		.replace('Homepage: https://code.visualstudio.com/', 'Homepage: https://github.com/xxloocee/opencode-ide')
		.replace(/Description: Code editing\. Redefined\.\r?\n Visual Studio Code is a new choice of tool that combines the simplicity of\r?\n a code editor with what developers need for the core edit-build-debug cycle\.\r?\n See https:\/\/code\.visualstudio\.com\/docs\/setup\/linux for installation\r?\n instructions and FAQ\./, 'Description: OpenCode IDE\n OpenCode IDE combines a familiar code editing workflow with the integrated\n OpenCode assistant and a sanitized default distribution.')
	);

	rewriteTextFile(path.join(root, 'resources', 'linux', 'debian', 'templates.template'), text => text
		.replace('Template: @@NAME@@/add-microsoft-repo', 'Template: @@NAME@@/configure-external-repo')
		.replace('Default: true', 'Default: false')
		.replace(/Description: Add Microsoft apt repository for Visual Studio Code\?\r?\n The installer would like to add the Microsoft repository and signing\r?\n key to update VS Code through apt\./, 'Description: Configure an external apt repository for OpenCode IDE?\n OpenCode IDE packages do not configure any Microsoft apt repository by default.')
	);

	rewriteTextFile(path.join(root, 'resources', 'linux', 'debian', 'postinst.template'), text => {
		if (!text.includes('packages.microsoft.com/repos/code')) {
			return text;
		}
		const marker = 'if [ "@@NAME@@" != "code-oss" ]; then';
		const start = text.indexOf(marker);
		if (start === -1) {
			return text;
		}
		const replacement = '# OpenCode IDE packages do not configure any external apt repository.\n# Remove the legacy bin command only for compatibility with historical layouts.\nif [ "@@NAME@@" = "code" ]; then\n\trm -f /usr/local/bin/code\nfi\n';
		return text.slice(0, start) + replacement;
	});

	rewriteTextFile(path.join(root, 'resources', 'linux', 'rpm', 'code.spec.template'), text => text
		.replace('Vendor:   Microsoft Corporation', 'Vendor:   OpenCode IDE')
		.replace('Packager: Visual Studio Code Team <vscode-linux@microsoft.com>', 'Packager: OpenCode IDE Maintainers <noreply@opencode-ide.local>')
		.replace('URL:      https://code.visualstudio.com/', 'URL:      https://github.com/xxloocee/opencode-ide')
		.replace('Visual Studio Code is a new choice of tool that combines the simplicity of a code editor with what developers need for the core edit-build-debug cycle. See https://code.visualstudio.com/docs/setup/linux for installation instructions and FAQ.', 'OpenCode IDE combines a familiar code editing workflow with the integrated OpenCode assistant and a sanitized default distribution.')
	);

	rewriteTextFile(path.join(root, 'build', 'win32', 'code.iss'), text => text
		.replace('AppPublisher=Microsoft Corporation', 'AppPublisher=OpenCode IDE')
		.replace('AppPublisherURL=https://code.visualstudio.com/', 'AppPublisherURL=https://github.com/xxloocee/opencode-ide')
		.replace('AppSupportURL=https://code.visualstudio.com/', 'AppSupportURL=https://github.com/xxloocee/opencode-ide')
		.replace('AppUpdatesURL=https://code.visualstudio.com/', 'AppUpdatesURL=https://github.com/xxloocee/opencode-ide')
		.replace('This User Installer is not meant to be run as an Administrator. If you would like to install VS Code for all users in this system, download the System Installer instead from https://code.visualstudio.com. Are you sure you want to continue?', 'This User Installer is not meant to be run as an Administrator. If you would like to install OpenCode IDE for all users in this system, use the System Installer instead. Are you sure you want to continue?')
	);

	console.log('[sanitize] rewrite-packaging');
}

function rewriteProductIcons() {
	const iconRoot = path.join(defaultRoot, 'config', 'sanitize', 'assets', 'product-icons');
	const icons = [
		['code.ico', 'resources/win32/code.ico'],
		['code_70x70.png', 'resources/win32/code_70x70.png'],
		['code_150x150.png', 'resources/win32/code_150x150.png'],
		['code.icns', 'resources/darwin/code.icns'],
		['code.png', 'resources/linux/code.png'],
		['favicon.ico', 'resources/server/favicon.ico'],
		['code-192.png', 'resources/server/code-192.png'],
		['code-512.png', 'resources/server/code-512.png'],
	];

	for (const [sourceName, targetRel] of icons) {
		const source = path.join(iconRoot, sourceName);
		if (!fs.existsSync(source)) {
			throw new Error(`Missing product icon asset: ${source}`);
		}
		fs.copyFileSync(source, path.join(root, targetRel));
	}

	console.log('[sanitize] rewrite-product-icons');
}

function rewriteTextFile(file, transform) {
	const before = fs.readFileSync(file, 'utf8');
	const after = transform(before);
	fs.writeFileSync(file, after);
}

function runVerify() {
	const verifyScript = path.join(defaultRoot, 'tools', 'sanitize', 'verify.mjs');
	const result = spawnSync(process.execPath, [verifyScript, `--root=${root}`, `--profile=${profile}`], {
		cwd: root,
		stdio: 'inherit'
	});

	if (result.status !== 0) {
		throw new Error(`[sanitize] verify failed for profile=${profile}`);
	}
}

function applyConfiguredOverlays() {
	const overlayRoot = resolveConfiguredRoot(config.overlayRoot, path.join(defaultRoot, 'tools', 'sanitize', 'overlays'));
	const overlays = config.overlays ?? [profile];
	applyOverlays({ root, overlayRoot, overlays });
}

function applyConfiguredPatches() {
	const patchRoot = resolveConfiguredRoot(config.patchRoot, path.join(defaultRoot, 'patches'));
	const patchSets = config.patchSets ?? [];
	applyPatchSets({ root, patchRoot, patchSets });
}

function resolveConfiguredRoot(configuredRoot, fallbackRoot) {
	if (!configuredRoot) {
		return fallbackRoot;
	}

	return path.isAbsolute(configuredRoot) ? configuredRoot : path.join(root, configuredRoot);
}

function readArg(name) {
	const prefix = `--${name}=`;
	return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function insertScriptsAfter(scripts, afterKey, entries) {
	const next = {};
	const entryKeys = new Set(Object.keys(entries));
	let inserted = false;
	for (const [key, value] of Object.entries(scripts || {})) {
		if (!entryKeys.has(key)) {
			next[key] = value;
		}
		if (key === afterKey) {
			Object.assign(next, entries);
			inserted = true;
		}
	}
	if (!inserted) {
		Object.assign(next, entries);
	}
	return next;
}
