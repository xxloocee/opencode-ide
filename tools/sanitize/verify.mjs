import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const defaultRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const root = path.resolve(readArg('root') ?? defaultRoot);
const profile = readArg('profile') ?? 'clean-full';
const configPath = path.join(root, 'config', 'sanitize', `${profile}.json`);

if (!fs.existsSync(configPath)) {
	throw new Error(`Missing sanitize config: ${configPath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const activeSteps = new Set([...(config.steps || []), ...(config.verifyChecks || [])]);
const verifiesWorkbenchEntries =
	activeSteps.has('rewrite-workbench-chat-entries')
	|| activeSteps.has('rewrite-workbench-account-entries');
const verifiesDefaultAccountEntries = activeSteps.has('rewrite-default-account-entries');
const verifiesAccountsActivityDefault = activeSteps.has('rewrite-accounts-activity-default');
const verifiesSessionsOfficialEntries = activeSteps.has('rewrite-sessions-official-entries');
const verifiesProductFallbackDefaults = activeSteps.has('rewrite-product-fallback-defaults');
const verifiesCopilotUiReferences = activeSteps.has('rewrite-copilot-ui-references');
const verifiesOnboardingSignInDefaults = activeSteps.has('rewrite-onboarding-signin-defaults');
const verifiesWelcomeStartupDefaults = activeSteps.has('rewrite-welcome-startup-defaults');
const verifiesOpenCodeDevLauncher = activeSteps.has('rewrite-opencode-dev-launcher');
const verifiesOpenCodeBridge = activeSteps.has('verify-opencode-bridge');
const verifiesBrandingText = activeSteps.has('rewrite-branding-text');
const verifiesProductIcons = activeSteps.has('rewrite-product-icons');

let failed = false;

const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
// product.json may preserve legacy keys with undefined-like falsy values after
// repeated rewrites in some branches, so verify by presence rather than truthy check.
const productKeys = new Set(Object.keys(product));
if (productKeys.has('trustedExtensionAuthAccess')) {
	console.error('[sanitize] failed: product.trustedExtensionAuthAccess');
	failed = true;
}
if ((product.builtInExtensionsEnabledWithAutoUpdates || []).includes('GitHub.copilot-chat')) {
	console.error('[sanitize] failed: product.builtInExtensionsEnabledWithAutoUpdates');
	failed = true;
}
if (productKeys.has('webviewContentExternalBaseUrlTemplate')) {
	console.error('[sanitize] failed: product.webviewContentExternalBaseUrlTemplate');
	failed = true;
}

const productIdentityChecks = [
	['nameShort', 'OpenCode IDE'],
	['nameLong', 'OpenCode IDE'],
	['applicationName', 'opencode-ide'],
	['dataFolderName', '.opencode-ide'],
	['sharedDataFolderName', '.opencode-ide-shared'],
	['serverApplicationName', 'opencode-ide-server'],
	['serverDataFolderName', '.opencode-ide-server'],
	['tunnelApplicationName', 'opencode-ide-tunnel'],
	['win32DirName', 'OpenCode IDE'],
	['win32NameVersion', 'OpenCode IDE'],
	['win32RegValueName', 'OpenCodeIDE'],
	['win32AppUserModelId', 'OpenCode.IDE'],
	['win32ShellNameShort', 'Open&Code IDE'],
	['darwinBundleIdentifier', 'com.opencode.ide'],
	['linuxIconName', 'opencode-ide'],
	['urlProtocol', 'opencode-ide'],
];

for (const [key, value] of productIdentityChecks) {
	if (product[key] !== value) {
		console.error(`[sanitize] failed: product.${key}`);
		failed = true;
	}
}
if (product.defaultChatAgent?.extensionId !== 'opencode.ide-placeholder' || product.defaultChatAgent?.chatExtensionId !== 'opencode.ide-placeholder-chat') {
	console.error('[sanitize] failed: product.defaultChatAgent.placeholder');
	failed = true;
}

for (const item of product.builtInExtensions || []) {
	if (item?.metadata?.publisherDisplayName !== 'OpenCode IDE') {
		console.error('[sanitize] failed: product.builtInExtensions.publisherDisplayName');
		failed = true;
	}
	if (item?.metadata?.publisherId?.displayName !== 'OpenCode IDE') {
		console.error('[sanitize] failed: product.builtInExtensions.publisherId.displayName');
		failed = true;
	}
	if (item?.metadata?.publisherId?.flags !== '') {
		console.error('[sanitize] failed: product.builtInExtensions.publisherId.flags');
		failed = true;
	}
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scriptKeys = new Set(Object.keys(pkg.scripts || {}));
for (const scriptName of ['watch-copilot', 'watch-copilotd', 'kill-watch-copilotd', 'copilot:setup', 'copilot:get_token']) {
	if (scriptKeys.has(scriptName)) {
		console.error(`[sanitize] failed: package.scripts.${scriptName}`);
		failed = true;
	}
}
for (const [scriptName, expected] of [
	['sanitize:scan', 'node tools/sanitize/scan.mjs'],
	['sanitize:apply', 'node tools/sanitize/apply.mjs'],
	['sanitize:verify', 'node tools/sanitize/verify.mjs'],
]) {
	if (pkg.scripts?.[scriptName] !== expected) {
		console.error(`[sanitize] failed: package.scripts.${scriptName}`);
		failed = true;
	}
}

const dependencyKeys = new Set(Object.keys(pkg.dependencies || {}));
for (const depName of ['@github/copilot', '@github/copilot-sdk', '@vscode/copilot-api']) {
	if (dependencyKeys.has(depName)) {
		console.error(`[sanitize] failed: package.dependencies.${depName}`);
		failed = true;
	}
}

const buildChecks = [
	['build/gulpfile.vscode.ts', /compileCopilotExtensionBuildTask|getCopilotExcludeFilter|prepareBuiltInCopilotRipgrepShim/],
	['build/gulpfile.reh.ts', /compileCopilotExtensionBuildTask|getCopilotExcludeFilter|prepareBuiltInCopilotRipgrepShim/],
	['build/gulpfile.extensions.ts', /compile-copilot-extension-build|packageCopilotExtensionStream/],
	['build/npm/dirs.ts', /'extensions\/copilot'/],
];

for (const [rel, pattern] of buildChecks) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (pattern.test(text)) {
		console.error(`[sanitize] failed: ${rel}`);
		failed = true;
	}
}

const authBuildChecks = [
	['build/gulpfile.extensions.ts', /extensions\/github-authentication\/tsconfig\.json|extensions\/microsoft-authentication\/tsconfig\.json/],
	['build/npm/dirs.ts', /'extensions\/github-authentication'|'extensions\/microsoft-authentication'/],
	['build/lib/extensions.ts', /excludedExtensions = \[[\s\S]*'copilot',\s*'vscode-api-tests'/],
];

for (const [rel, pattern] of authBuildChecks) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (pattern.test(text)) {
		console.error(`[sanitize] failed: ${rel}`);
		failed = true;
	}
}

const telemetryMustInclude = [
	['src/vs/platform/telemetry/common/telemetryService.ts', "'default': TelemetryConfiguration.OFF,"],
	['src/vs/platform/telemetry/common/telemetryService.ts', "'default': false,"],
	['src/vs/workbench/contrib/editTelemetry/browser/editTelemetry.contribution.ts', 'default: false,'],
	['src/vs/workbench/contrib/preferences/common/preferencesContribution.ts', "'workbench.settings.enableNaturalLanguageSearch': {"],
	['src/vs/workbench/contrib/preferences/common/preferencesContribution.ts', "'default': false,"],
	['src/vs/workbench/services/assignment/common/assignmentService.ts', "'workbench.enableExperiments': {"],
	['src/vs/workbench/services/assignment/common/assignmentService.ts', "'default': false,"],
];

for (const [rel, snippet] of telemetryMustInclude) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (!text.includes(snippet)) {
		console.error(`[sanitize] failed: ${rel}`);
		failed = true;
	}
}

const telemetryPatternChecks = [
	['src/vs/workbench/browser/workbench.contribution.ts', /'workbench\.commandPalette\.experimental\.enableNaturalLanguageSearch': \{[\s\S]*?'default': false/],
	['src/vs/workbench/browser/workbench.contribution.ts', /'workbench\.quickOpen\.closeOnFocusLost': \{[\s\S]*?'default': false/],
	['src/vs/workbench/electron-browser/desktop.contribution.ts', /'keyboard\.touchbar\.enabled': \{[\s\S]*?'default': false,/],
	['src/vs/workbench/electron-browser/desktop.contribution.ts', /'telemetry\.enableCrashReporter': \{[\s\S]*?'default': false,/],
	['src/vs/workbench/electron-browser/desktop.contribution.ts', /'security\.promptForLocalFileProtocolHandling': \{[\s\S]*?'default': false,/],
	['src/vs/workbench/electron-browser/desktop.contribution.ts', /'security\.promptForRemoteFileProtocolHandling': \{[\s\S]*?'default': false,/],
];

for (const [rel, pattern] of telemetryPatternChecks) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (!pattern.test(text)) {
		console.error(`[sanitize] failed: ${rel}.telemetryDefault`);
		failed = true;
	}
}

if (verifiesBrandingText) {
	const brandingChecks = [
		['build/win32/i18n/messages.en.isl', /Updating Visual Studio Code/],
		['resources/linux/snap/snapcraft.yaml', /Visual Studio Code is a new choice of tool/],
		['src/vs/workbench/contrib/extensions/browser/extensionsActions.ts', /built-in to VS Code|Visual Studio Code to complete/],
		['src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts', /bundled with Visual Studio Code|VS Code Release Notes/],
		['src/vs/workbench/contrib/extensions/common/extensionsFileTemplate.ts', /recommended by VS Code/],
		['src/vs/workbench/contrib/extensions/common/installExtensionsTool.ts', /Visual Studio Code/],
		['src/vs/workbench/contrib/extensions/common/searchExtensionsTool.ts', /Visual Studio Code Extensions Marketplace|VS Code extensions/],
		['src/vs/workbench/contrib/extensions/electron-browser/extensionsSlowActions.ts', /VS Code version/],
		['src/vs/workbench/contrib/issue/browser/baseIssueReporterService.ts', /Visual Studio Code|A VS Code extension|outside of VS Code/],
		['src/vs/workbench/contrib/issue/browser/issueReporterModel.ts', /VS Code version/],
		['src/vs/workbench/contrib/issue/browser/issueReporterPage.ts', /my VS Code version/],
		['src/vs/workbench/contrib/opencode/browser/opencode.contribution.ts', /QuantCode/],
		['src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts', /assertDefined\(product\.defaultChatAgent|Welcome to Visual Studio Code|Welcome to VS Code|Sign in for AI Powered Features|Agents tutorial|code\.visualstudio\.com\/docs\/copilot|Copilot CLI|Tailor Copilot/],
		['src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts', /Visual Studio Code|VS Code|create(?:Copilot|OpenCode)SetupStep\('(?:Copilot|OpenCode)Setup|aka\.ms\/vscode|code\.visualstudio\.com/],
	];

	for (const [rel, pattern] of brandingChecks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (pattern.test(text)) {
			console.error(`[sanitize] failed: ${rel}.brandingText`);
			failed = true;
		}
	}
}

if (verifiesWorkbenchEntries) {
	const workbenchEntryChecks = [
		['src/vs/workbench/workbench.common.main.ts', /contrib\/chat\/browser\/chat\.contribution|contrib\/chat\/browser\/chat\.view\.contribution|contrib\/inlineChat\/browser\/inlineChat\.contribution|contrib\/chat\/browser\/chatSessions\/chatSessions\.contribution|contrib\/chat\/browser\/contextContrib\/chatContext\.contribution/],
		['src/vs/workbench/workbench.desktop.main.ts', /contrib\/chat\/electron-browser\/chat\.contribution/],
		['src/vs/workbench/workbench.common.main.ts', /contrib\/authentication\/browser\/authentication\.contribution|contrib\/userDataSync\/browser\/userDataSync\.contribution/],
		['src/vs/workbench/workbench.desktop.main.ts', /contrib\/userDataSync\/electron-browser\/userDataSync\.contribution/],
	];

	for (const [rel, pattern] of workbenchEntryChecks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (pattern.test(text)) {
			console.error(`[sanitize] failed: ${rel}`);
			failed = true;
		}
	}

	const workbenchCommonMain = fs.readFileSync(path.join(root, 'src/vs/workbench/workbench.common.main.ts'), 'utf8');
	if (!/contrib\/chat\/browser\/chat\.core\.contribution/.test(workbenchCommonMain)) {
		console.error('[sanitize] failed: src/vs/workbench/workbench.common.main.ts.chatCore');
		failed = true;
	}

	const chatCoreContribution = path.join(root, 'src/vs/workbench/contrib/chat/browser/chat.core.contribution.ts');
	if (!fs.existsSync(chatCoreContribution)) {
		console.error('[sanitize] failed: src/vs/workbench/contrib/chat/browser/chat.core.contribution.ts');
		failed = true;
	}
}

if (verifiesDefaultAccountEntries) {
	const defaultAccountChecks = [
		['src/vs/platform/defaultAccount/common/defaultAccount.ts', /^(?![\s\S]*class NullDefaultAccountService)[\s\S]*$/],
		['src/vs/workbench/workbench.common.main.ts', /services\/accounts\/browser\/defaultAccount|services\/policies\/browser\/accountPolicyGate\.contribution/],
		['src/vs/workbench/electron-browser/desktop.main.ts', /new DefaultAccountService|services\/accounts\/browser\/defaultAccount/],
		['src/vs/workbench/browser/web.main.ts', /new DefaultAccountService|services\/accounts\/browser\/defaultAccount/],
		['src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts', /services\/accounts\/browser\/defaultAccount/],
		['src/vs/workbench/contrib/extensions/browser/extensionsViewlet.ts', /services\/accounts\/browser\/defaultAccount/],
	];

	for (const [rel, pattern] of defaultAccountChecks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (pattern.test(text)) {
			const suffix = rel.includes('contrib/extensions/browser') ? 'defaultAccountSideEffect' : 'defaultAccount';
			console.error(`[sanitize] failed: ${rel}.${suffix}`);
			failed = true;
		}
	}
}

if (verifiesAccountsActivityDefault) {
	const rel = 'src/vs/workbench/browser/parts/globalCompositeBar.ts';
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (/getBoolean\(AccountsActivityActionViewItem\.ACCOUNTS_VISIBILITY_PREFERENCE_KEY,\s*StorageScope\.PROFILE,\s*true\)/.test(text)) {
		console.error(`[sanitize] failed: ${rel}.accountsActivity`);
		failed = true;
	}
	if (!/getBoolean\(AccountsActivityActionViewItem\.ACCOUNTS_VISIBILITY_PREFERENCE_KEY,\s*StorageScope\.PROFILE,\s*false\)/.test(text)) {
		console.error(`[sanitize] failed: ${rel}.accountsActivity`);
		failed = true;
	}
}

if (verifiesSessionsOfficialEntries) {
	const sessionsChecks = [
		['src/vs/sessions/sessions.common.main.ts', /workbench\/services\/accounts\/browser\/defaultAccount|workbench\/contrib\/chat\/browser\/chat\.contribution|workbench\/contrib\/chat\/browser\/chatSessions\/chatSessions\.contribution|workbench\/contrib\/chat\/browser\/contextContrib\/chatContext\.contribution|workbench\/contrib\/authentication\/browser\/authentication\.contribution|contrib\/accountMenu\/browser\/account\.contribution|contrib\/copilotChatSessions\/browser\/copilotChatSessions\.contribution/],
		['src/vs/sessions/electron-browser/sessions.main.ts', /new DefaultAccountService|workbench\/services\/accounts\/browser\/defaultAccount/],
	];

	for (const [rel, pattern] of sessionsChecks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (pattern.test(text)) {
			console.error(`[sanitize] failed: ${rel}`);
			failed = true;
		}
	}
}

if (verifiesProductFallbackDefaults) {
	const rel = 'src/vs/platform/product/common/product.ts';
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (/GitHub\.copilot|GitHub\.copilot-chat|github-enterprise|https:\/\/github\.com\/microsoft\/vscode|Code - OSS Dev|applicationName: 'code-oss'|dataFolderName: '\.vscode-oss'|urlProtocol: 'code-oss'/.test(text)) {
		console.error(`[sanitize] failed: ${rel}.fallback`);
		failed = true;
	}
	if (!/chatExtensionId: 'opencode\.ide-placeholder-chat'/.test(text)) {
		console.error(`[sanitize] failed: ${rel}.fallback`);
		failed = true;
	}
}

if (verifiesCopilotUiReferences) {
	const checks = [
		['src/vs/workbench/contrib/preferences/browser/settingsLayout.ts', /GitHub\.copilot-chat\.manageExtension/],
		['src/vs/workbench/contrib/editTelemetry/browser/telemetry/editSourceTrackingFeature.ts', /GitHub\.copilot|GitHub\.copilot-chat|getExtensionInfoObs|copilotInstalled|copilotChatInstalled|IExtensionService/],
	];

	for (const [rel, pattern] of checks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (pattern.test(text)) {
			console.error(`[sanitize] failed: ${rel}.copilotUi`);
			failed = true;
		}
	}
}

if (verifiesOnboardingSignInDefaults) {
	const checks = [
		['src/vs/workbench/contrib/welcomeOnboarding/common/onboardingTypes.ts', /ONBOARDING_STEPS[\s\S]*OnboardingStepId\.SignIn/],
		['src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts', /private readonly steps = (?:defaultChat \? )?ONBOARDING_STEPS;/],
		['src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts', /private readonly steps = defaultChat \? ONBOARDING_STEPS/],
	];

	for (const [rel, pattern] of checks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (pattern.test(text)) {
			console.error(`[sanitize] failed: ${rel}.onboardingSignIn`);
			failed = true;
		}
	}

	const variation = fs.readFileSync(path.join(root, 'src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts'), 'utf8');
	if (!/private readonly steps = ONBOARDING_STEPS\.filter\(step => step !== OnboardingStepId\.SignIn\);/.test(variation)) {
		console.error('[sanitize] failed: src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts.onboardingSignIn');
		failed = true;
	}
}

if (verifiesWelcomeStartupDefaults) {
	const rel = 'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts';
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (/'workbench\.startupEditor': \{[\s\S]*?'default': 'welcomePage'/.test(text)) {
		console.error(`[sanitize] failed: ${rel}.startupEditorDefault`);
		failed = true;
	}
	if (!/'workbench\.startupEditor': \{[\s\S]*?'default': 'none'/.test(text)) {
		console.error(`[sanitize] failed: ${rel}.startupEditorDefault`);
		failed = true;
	}
}

if (verifiesOpenCodeDevLauncher) {
	const rel = 'scripts/code-opencode-dev.ps1';
	const file = path.join(root, rel);
	if (fs.existsSync(file)) {
		const text = fs.readFileSync(file, 'utf8');
		for (const snippet of [
			'--disable-extension=GitHub.copilot-chat',
			'--disable-extension=vscode.github-authentication',
			'--disable-extension=vscode.microsoft-authentication',
			'@cleanDisabledExtensionArgs @CodeArgs'
		]) {
			if (!text.includes(snippet)) {
				console.error(`[sanitize] failed: ${rel}.disabledOfficialExtensions`);
				failed = true;
				break;
			}
		}
	}
}

if (verifiesOpenCodeBridge) {
	const bridgeChecks = [
		['src/vs/workbench/workbench.desktop.main.ts', /contrib\/opencode\/electron-browser\/opencodeHostService/],
		['src/vs/workbench/workbench.desktop.main.ts', /contrib\/opencode\/browser\/opencode\.contribution/],
		['src/vs/workbench/workbench.desktop.main.ts', /contrib\/opencode\/browser\/opencodeWebview\.contribution/],
		['src/vs/workbench/contrib/opencode/browser/opencodeWebview.contribution.ts', /webviews\.register\(OpenCodeViewId/],
		['src/vs/workbench/contrib/opencode/browser/opencodeWebview.contribution.ts', /InputFocusedContext/],
		['src/vs/workbench/contrib/opencode/browser/opencodeWebview.contribution.ts', /when:\s*ContextKeyExpr\.or\(\s*EditorContextKeys\.editorTextFocus,\s*InputFocusedContext\.toNegated\(\)\s*\)/],
		['src/vs/workbench/contrib/opencode/browser/opencodeWebview.contribution.ts', /evt\.data\?\.source === 'opencode-bridge'[\s\S]*vscode\.postMessage\(evt\.data\)/],
		['src/vs/workbench/contrib/opencode/browser/opencodeWebview.contribution.ts', /evt\.data\?\.source === 'opencode-host'[\s\S]*postToApp\(evt\.data\)/],
		['src/vs/workbench/contrib/opencode/browser/opencodeWebview.contribution.ts', /evt\.data\?\.source === 'opencode-host-event'[\s\S]*postToApp\(evt\.data\)/],
		['src/vs/workbench/contrib/opencode/browser/opencodeProtocol.ts', /method: 'context\.get'/],
		['src/vs/workbench/contrib/opencode/browser/opencodeProtocol.ts', /method: 'editor\.open'/],
		['src/vs/workbench/contrib/opencode/browser/opencodeProtocol.ts', /method: 'terminal\.last\.get'/],
		['src/vs/workbench/contrib/opencode/browser/opencodeProtocol.ts', /method: 'diagnostics\.workspace\.get'/],
	];

	for (const [rel, pattern] of bridgeChecks) {
		const text = fs.readFileSync(path.join(root, rel), 'utf8');
		if (!pattern.test(text)) {
			console.error(`[sanitize] failed: ${rel}.opencodeBridge`);
			failed = true;
		}
	}
}

const packagingMustInclude = [
	['resources/linux/code.desktop', 'Keywords=opencode;ide;'],
	['resources/linux/code.appdata.xml', 'https://github.com/xxloocee/opencode-ide'],
	['resources/linux/debian/control.template', 'Maintainer: OpenCode IDE Maintainers <noreply@opencode-ide.local>'],
	['resources/linux/debian/templates.template', 'Template: @@NAME@@/configure-external-repo'],
	['resources/linux/debian/postinst.template', 'OpenCode IDE packages do not configure any external apt repository.'],
	['resources/linux/rpm/code.spec.template', 'Vendor:   OpenCode IDE'],
	['build/win32/code.iss', 'AppPublisher=OpenCode IDE'],
	['build/win32/code.iss', 'Source: "tools\\*"; DestDir: "{app}\\{#VersionedResourcesFolder}\\tools"; Flags: ignoreversion skipifsourcedoesntexist'],
];

for (const [rel, snippet] of packagingMustInclude) {
	const text = fs.readFileSync(path.join(root, rel), 'utf8');
	if (!text.includes(snippet)) {
		console.error(`[sanitize] failed: ${rel}`);
		failed = true;
	}
}

if (verifiesProductIcons) {
	const iconChecks = [
		['code.ico', 'resources/win32/code.ico'],
		['code_70x70.png', 'resources/win32/code_70x70.png'],
		['code_150x150.png', 'resources/win32/code_150x150.png'],
		['code.icns', 'resources/darwin/code.icns'],
		['code.png', 'resources/linux/code.png'],
		['code.xpm', 'resources/linux/rpm/code.xpm'],
		['favicon.ico', 'resources/server/favicon.ico'],
		['code-192.png', 'resources/server/code-192.png'],
		['code-512.png', 'resources/server/code-512.png'],
		['code-icon.svg', 'src/vs/workbench/browser/media/code-icon.svg'],
		['code-icon.svg', 'src/vs/sessions/browser/media/vscode-icon.svg'],
		['code-icon.svg', 'extensions/github-authentication/media/code-icon.svg'],
		['favicon.ico', 'extensions/github-authentication/media/favicon.ico'],
		['favicon.ico', 'extensions/microsoft-authentication/media/favicon.ico'],
	];

	for (const [sourceName, targetRel] of iconChecks) {
		const source = path.join(defaultRoot, 'config', 'sanitize', 'assets', 'product-icons', sourceName);
		const target = path.join(root, targetRel);
		if (!fs.existsSync(source) || !fs.existsSync(target)) {
			console.error(`[sanitize] failed: ${targetRel}.productIconExists`);
			failed = true;
			continue;
		}
		if (!fs.readFileSync(source).equals(fs.readFileSync(target))) {
			console.error(`[sanitize] failed: ${targetRel}.productIcon`);
			failed = true;
		}
	}

	const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'server', 'manifest.json'), 'utf8'));
	if (manifest.name !== 'OpenCode IDE' || manifest.short_name !== 'OpenCode IDE') {
		console.error('[sanitize] failed: resources/server/manifest.json.productIconBranding');
		failed = true;
	}
}

if (failed) {
	process.exitCode = 1;
} else {
	console.log('[sanitize] verify ok');
}

function readArg(name) {
	const prefix = `--${name}=`;
	return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}
