import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const applyScript = path.join(repoRoot, 'tools', 'sanitize', 'apply.mjs');
const verifyScript = path.join(repoRoot, 'tools', 'sanitize', 'verify.mjs');

test('apply rejects unknown sanitize steps', () => {
	const root = makeFixtureRoot();
	writeJson(path.join(root, 'config', 'sanitize', 'bad-profile.json'), {
		name: 'bad-profile',
		steps: ['rewrite-product', 'does-not-exist']
	});

	const result = runNode(applyScript, `--root=${root}`, '--profile=bad-profile');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /Unknown sanitize step: does-not-exist/);
});

test('apply runs verify steps and propagates verification failures', () => {
	const root = makeFixtureRoot();
	const productPath = path.join(root, 'product.json');
	const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
	product.trustedExtensionAuthAccess = [];
	writeJson(productPath, product);

	const result = runNode(applyScript, `--root=${root}`, '--profile=verify-only');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /product\.trustedExtensionAuthAccess/);
});

test('apply patch sets applies patches once and skips already-applied patches', () => {
	const root = makeFixtureRoot();
	writeJson(path.join(root, 'config', 'sanitize', 'patch-only.json'), {
		name: 'patch-only',
		steps: ['apply-patches'],
		patchRoot: 'patches',
		patchSets: ['demo']
	});
	writeText(path.join(root, 'sample.txt'), 'before\n');
	writeText(path.join(root, 'patches', 'demo', '10-sample.patch'), [
		'diff --git a/sample.txt b/sample.txt',
		'--- a/sample.txt',
		'+++ b/sample.txt',
		'@@ -1 +1 @@',
		'-before',
		'+after',
		''
	].join('\n'));

	const first = runNode(applyScript, `--root=${root}`, '--profile=patch-only');
	assert.equal(first.status, 0, first.stderr + first.stdout);
	assert.equal(normalizeLineEndings(fs.readFileSync(path.join(root, 'sample.txt'), 'utf8')), 'after\n');

	const second = runNode(applyScript, `--root=${root}`, '--profile=patch-only');
	assert.equal(second.status, 0, second.stderr + second.stdout);
	assert.match(second.stdout, /patch already applied/);
});

test('verify clean-lite allows full-only workbench entries to remain', () => {
	const root = makeFixtureRoot({ includeFullOnlyWorkbenchEntries: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-lite');

	assert.equal(result.status, 0, result.stderr + result.stdout);
	assert.match(result.stdout, /\[sanitize\] verify ok/);
});

test('verify honors explicit verifyChecks independent of rewrite steps', () => {
	const root = makeFixtureRoot({ includeFullOnlyWorkbenchEntries: true });
	writeJson(path.join(root, 'config', 'sanitize', 'check-only.json'), {
		name: 'check-only',
		steps: ['verify'],
		verifyChecks: ['rewrite-workbench-chat-entries']
	});

	const result = runNode(verifyScript, `--root=${root}`, '--profile=check-only');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /workbench\.common\.main\.ts/);
});

test('verify clean-full preserves core chat services while rejecting official chat and account workbench entries', () => {
	const root = makeFixtureRoot({ includeFullOnlyWorkbenchEntries: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /workbench\.common\.main\.ts/);

	const coreOnlyRoot = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
	const coreOnlyResult = runNode(verifyScript, `--root=${coreOnlyRoot}`, '--profile=clean-full');

	assert.equal(coreOnlyResult.status, 0, coreOnlyResult.stderr + coreOnlyResult.stdout);
});

test('verify clean-full rejects default account sign-in registrations', () => {
	const root = makeFixtureRoot();
	writeText(path.join(root, 'src', 'vs', 'workbench', 'workbench.common.main.ts'), "import './services/accounts/browser/defaultAccount.js';\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'electron-browser', 'desktop.main.ts'), "import { DefaultAccountService } from '../services/accounts/browser/defaultAccount.js';\nconst defaultAccountService = this._register(new DefaultAccountService(productService));\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'browser', 'web.main.ts'), "import { DefaultAccountService } from '../services/accounts/browser/defaultAccount.js';\nconst defaultAccountService = this._register(new DefaultAccountService(productService));\n");

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /defaultAccount/);
});

test('verify clean-full rejects default account side-effect imports from extension UI', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true, includeDefaultAccountSideEffectImports: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /defaultAccountSideEffect/);
});

test('verify clean-full rejects visible-by-default accounts activity', () => {
	const root = makeFixtureRoot({ accountsActivityDefaultVisible: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /globalCompositeBar\.ts\.accountsActivity/);
});

test('verify clean-full rejects sessions official account and Copilot entries', () => {
	const root = makeFixtureRoot({ includeSessionsOfficialEntries: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /sessions\.(common\.main|main)\.ts/);
});

test('verify clean-full rejects product fallback Copilot defaults', () => {
	const root = makeFixtureRoot({ includeProductFallbackCopilotDefaults: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /product\.ts\.fallback/);
});

test('verify clean-full rejects Copilot UI references', () => {
	const root = makeFixtureRoot({ includeCopilotUiReferences: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /copilotUi/);
});

test('verify clean-full rejects onboarding sign-in defaults', () => {
	const root = makeFixtureRoot({ includeOnboardingSignInDefault: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /onboardingSignIn/);
});

test('verify clean-full rejects official welcome links and sign-in nudges', () => {
	const root = makeFixtureRoot({ includeOfficialWelcomeDefaults: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /brandingText/);
});

test('apply clean-full defaults startup editor to none', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true, includeStartupWelcomeDefault: true });

	const result = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

	assert.equal(result.status, 0, result.stderr + result.stdout);
	const text = fs.readFileSync(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeGettingStarted', 'browser', 'gettingStarted.contribution.ts'), 'utf8');
	assert.match(text, /'workbench\.startupEditor': \{[\s\S]*?'default': 'none'/);
	assert.doesNotMatch(text, /'workbench\.startupEditor': \{[\s\S]*?'default': 'welcomePage'/);
});

test('apply clean-full makes Windows packaging tools source optional', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
	const codeIssPath = path.join(root, 'build', 'win32', 'code.iss');
	writeText(codeIssPath, 'AppPublisher=OpenCode IDE\nSource: "tools\\*"; DestDir: "{app}\\{#VersionedResourcesFolder}\\tools"; Flags: ignoreversion\n');

	const first = runNode(applyScript, `--root=${root}`, '--profile=clean-full');
	const second = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

	assert.equal(first.status, 0, first.stderr + first.stdout);
	assert.equal(second.status, 0, second.stderr + second.stdout);
	const text = fs.readFileSync(codeIssPath, 'utf8');
	assert.match(text, /Source: "tools\\\*"; DestDir: "\{app\}\\\{#VersionedResourcesFolder\}\\tools"; Flags: ignoreversion skipifsourcedoesntexist/);
	assert.doesNotMatch(text, /skipifsourcedoesntexist skipifsourcedoesntexist/);
});

test('verify clean-full rejects welcome page as startup editor default', () => {
	const root = makeFixtureRoot({ includeStartupWelcomeDefault: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /startupEditorDefault/);
});

test('apply clean-full rewrites product icons used by packaging and workbench UI', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true, includeUpstreamProductIcons: true });

	const result = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

	assert.equal(result.status, 0, result.stderr + result.stdout);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'resources', 'server', 'manifest.json'), 'utf8')), {
		name: 'OpenCode IDE',
		short_name: 'OpenCode IDE',
		icons: []
	});
	assertProductIconEquals(root, 'code-icon.svg', 'src/vs/workbench/browser/media/code-icon.svg');
	assertProductIconEquals(root, 'code-icon.svg', 'src/vs/sessions/browser/media/vscode-icon.svg');
	assertProductIconEquals(root, 'code.xpm', 'resources/linux/rpm/code.xpm');
	assertProductIconEquals(root, 'favicon.ico', 'extensions/github-authentication/media/favicon.ico');
	assertProductIconEquals(root, 'favicon.ico', 'extensions/microsoft-authentication/media/favicon.ico');
});

test('verify clean-full rejects upstream product icons and PWA branding', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true, includeUpstreamProductIcons: true });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /productIcon/);
});

test('verify clean-full rejects OpenCode dev launcher without official extension disables', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true, includeOfficialExtensionLauncherDisables: false });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /code-opencode-dev\.ps1\.disabledOfficialExtensions/);
});

test('verify clean-full rejects missing OpenCode bridge wiring', () => {
	const root = makeFixtureRoot({ includeOpenCodeBridge: false });

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /opencodeBridge/);
});

function runNode(script, ...args) {
	return spawnSync(process.execPath, [script, ...args], {
		cwd: repoRoot,
		encoding: 'utf8'
	});
}

function makeFixtureRoot(options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-sanitize-'));

	writeJson(path.join(root, 'config', 'sanitize', 'clean-lite.json'), {
		name: 'clean-lite',
		steps: ['rewrite-product', 'verify']
	});
	writeJson(path.join(root, 'config', 'sanitize', 'clean-full.json'), {
		name: 'clean-full',
		steps: ['rewrite-product', 'rewrite-package', 'rewrite-build-copilot', 'rewrite-build-auth', 'rewrite-telemetry-defaults', 'apply-overlays', 'apply-patches', 'rewrite-branding-text', 'rewrite-welcome-startup-defaults', 'rewrite-product-icons', 'rewrite-packaging', 'verify'],
		verifyChecks: [
			'rewrite-workbench-chat-entries',
			'rewrite-workbench-account-entries',
			'rewrite-default-account-entries',
			'rewrite-accounts-activity-default',
			'rewrite-sessions-official-entries',
			'rewrite-product-fallback-defaults',
			'rewrite-copilot-ui-references',
			'rewrite-onboarding-signin-defaults',
			'rewrite-welcome-startup-defaults',
			'rewrite-opencode-dev-launcher',
			'verify-opencode-bridge'
		],
		overlays: ['clean-full'],
		patchSets: []
	});
	writeJson(path.join(root, 'config', 'sanitize', 'verify-only.json'), {
		name: 'verify-only',
		steps: ['verify']
	});

	writeJson(path.join(root, 'product.json'), {
		nameShort: 'OpenCode IDE',
		nameLong: 'OpenCode IDE',
		applicationName: 'opencode-ide',
		dataFolderName: '.opencode-ide',
		sharedDataFolderName: '.opencode-ide-shared',
		serverApplicationName: 'opencode-ide-server',
		serverDataFolderName: '.opencode-ide-server',
		tunnelApplicationName: 'opencode-ide-tunnel',
		win32DirName: 'OpenCode IDE',
		win32NameVersion: 'OpenCode IDE',
		win32RegValueName: 'OpenCodeIDE',
		win32AppUserModelId: 'OpenCode.IDE',
		win32ShellNameShort: 'Open&Code IDE',
		darwinBundleIdentifier: 'com.opencode.ide',
		linuxIconName: 'opencode-ide',
		urlProtocol: 'opencode-ide',
		defaultChatAgent: {
			extensionId: 'opencode.ide-placeholder',
			chatExtensionId: 'opencode.ide-placeholder-chat'
		},
		builtInExtensionsEnabledWithAutoUpdates: [],
		builtInExtensions: []
	});

	writeJson(path.join(root, 'package.json'), {
		scripts: {
			'sanitize:scan': 'node tools/sanitize/scan.mjs',
			'sanitize:apply': 'node tools/sanitize/apply.mjs',
			'sanitize:verify': 'node tools/sanitize/verify.mjs',
		},
		dependencies: {}
	});

	writeText(path.join(root, 'build', 'gulpfile.vscode.ts'), '');
	writeText(path.join(root, 'build', 'gulpfile.reh.ts'), '');
	writeText(path.join(root, 'build', 'gulpfile.extensions.ts'), '');
	writeText(path.join(root, 'build', 'npm', 'dirs.ts'), 'export const dirs = [];\n');
	writeText(path.join(root, 'build', 'lib', 'extensions.ts'), 'const excludedExtensions = [];\n');

	writeText(path.join(root, 'src', 'vs', 'platform', 'telemetry', 'common', 'telemetryService.ts'), "'default': TelemetryConfiguration.OFF,\n'default': false,\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'browser', 'workbench.contribution.ts'), [
		"'workbench.commandPalette.experimental.enableNaturalLanguageSearch': {",
		"'default': false",
		"}",
		"'workbench.quickOpen.closeOnFocusLost': {",
		"'default': false",
		"}",
		""
	].join('\n'));
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'editTelemetry', 'browser', 'editTelemetry.contribution.ts'), 'default: false,\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'preferences', 'common', 'preferencesContribution.ts'), "'workbench.settings.enableNaturalLanguageSearch': {\n'default': false,\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'electron-browser', 'desktop.contribution.ts'), [
		"'keyboard.touchbar.enabled': {",
		"'default': false,",
		"}",
		"'telemetry.enableCrashReporter': {",
		"'default': false,",
		"}",
		"'security.promptForLocalFileProtocolHandling': {",
		"'default': false,",
		"}",
		"'security.promptForRemoteFileProtocolHandling': {",
		"'default': false,",
		"}",
		""
	].join('\n'));
	writeText(path.join(root, 'src', 'vs', 'workbench', 'services', 'assignment', 'common', 'assignmentService.ts'), "'workbench.enableExperiments': {\n'default': false,\n");

	const fullOnlyEntries = options.includeFullOnlyWorkbenchEntries ? [
		"import './contrib/chat/browser/chat.contribution.js';",
		"import './contrib/chat/browser/chat.view.contribution.js';",
		"import './contrib/inlineChat/browser/inlineChat.contribution.js';",
		"import './contrib/chat/browser/chatSessions/chatSessions.contribution.js';",
		"import './contrib/chat/browser/contextContrib/chatContext.contribution.js';",
		"import './contrib/authentication/browser/authentication.contribution.js';",
		"import './contrib/userDataSync/browser/userDataSync.contribution.js';"
	].join('\n') : options.includeCoreWorkbenchChatEntry ? "import './contrib/chat/browser/chat.core.contribution.js';\n" : '';
	writeText(path.join(root, 'src', 'vs', 'workbench', 'workbench.common.main.ts'), fullOnlyEntries);
	if (options.includeCoreWorkbenchChatEntry) {
		writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'chat', 'browser', 'chat.core.contribution.ts'), 'class NullChatService {}\n');
	}
	writeText(path.join(root, 'src', 'vs', 'workbench', 'workbench.desktop.main.ts'), options.includeFullOnlyWorkbenchEntries ? "import './contrib/userDataSync/electron-browser/userDataSync.contribution.js';\n" : '');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'electron-browser', 'desktop.main.ts'), "import { NullDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';\nconst defaultAccountService = this._register(new NullDefaultAccountService());\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'browser', 'web.main.ts'), "import { NullDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';\nconst defaultAccountService = this._register(new NullDefaultAccountService());\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'browser', 'parts', 'globalCompositeBar.ts'), `export function isAccountsActionVisible(storageService) {
	return storageService.getBoolean(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, StorageScope.PROFILE, ${options.accountsActivityDefaultVisible ? 'true' : 'false'});
}
`);
	writeText(path.join(root, 'src', 'vs', 'platform', 'defaultAccount', 'common', 'defaultAccount.ts'), "export class NullDefaultAccountService {}\n");
	writeText(path.join(root, 'src', 'vs', 'sessions', 'sessions.common.main.ts'), options.includeSessionsOfficialEntries ? [
		"import '../workbench/services/accounts/browser/defaultAccount.js';",
		"import '../workbench/contrib/chat/browser/chat.contribution.js';",
		"import '../workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.js';",
		"import '../workbench/contrib/chat/browser/contextContrib/chatContext.contribution.js';",
		"import '../workbench/contrib/authentication/browser/authentication.contribution.js';",
		"import './contrib/accountMenu/browser/account.contribution.js';",
		"import './contrib/copilotChatSessions/browser/copilotChatSessions.contribution.js';",
		"import './contrib/chat/browser/chat.contribution.js';"
	].join('\n') : "import './contrib/chat/browser/chat.contribution.js';\n");
	writeText(path.join(root, 'src', 'vs', 'sessions', 'electron-browser', 'sessions.main.ts'), options.includeSessionsOfficialEntries ? "import { IDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';\nimport { DefaultAccountService } from '../../workbench/services/accounts/browser/defaultAccount.js';\nconst defaultAccountService = this._register(new DefaultAccountService(productService));\nserviceCollection.set(IDefaultAccountService, defaultAccountService);\n" : "import { IDefaultAccountService, NullDefaultAccountService } from '../../platform/defaultAccount/common/defaultAccount.js';\nconst defaultAccountService = this._register(new NullDefaultAccountService());\n");
	writeText(path.join(root, 'src', 'vs', 'platform', 'product', 'common', 'product.ts'), options.includeProductFallbackCopilotDefaults ? "Object.assign(product, {\n\tnameShort: 'Code - OSS Dev',\n\tnameLong: 'Code - OSS Dev',\n\tapplicationName: 'code-oss',\n\tdataFolderName: '.vscode-oss',\n\turlProtocol: 'code-oss',\n\treportIssueUrl: 'https://github.com/microsoft/vscode/issues/new',\n\tlicenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',\n\tserverLicenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',\n\tdefaultChatAgent: {\n\t\textensionId: 'GitHub.copilot',\n\t\tchatExtensionId: 'GitHub.copilot-chat',\n\t\tprovider: { default: { id: 'github', name: 'GitHub' }, enterprise: { id: 'github-enterprise', name: 'GitHub Enterprise' } },\n\t\tproviderScopes: []\n\t}\n});\n" : "Object.assign(product, {\n\tnameShort: 'OpenCode IDE Dev',\n\tnameLong: 'OpenCode IDE Dev',\n\tapplicationName: 'opencode-ide',\n\tdataFolderName: '.opencode-ide',\n\turlProtocol: 'opencode-ide',\n\tdefaultChatAgent: {\n\t\textensionId: 'opencode.ide-placeholder',\n\t\tchatExtensionId: 'opencode.ide-placeholder-chat',\n\t\tprovider: { default: { id: 'opencode', name: 'OpenCode' }, enterprise: { id: 'opencode-enterprise', name: 'OpenCode Enterprise' } },\n\t\tproviderScopes: []\n\t}\n});\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeOnboarding', 'common', 'onboardingTypes.ts'), options.includeOnboardingSignInDefault ? "export const ONBOARDING_STEPS = [\n\tOnboardingStepId.SignIn,\n\tOnboardingStepId.Personalize,\n];\n" : "export const ONBOARDING_STEPS = [\n\tOnboardingStepId.Personalize,\n];\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeOnboarding', 'browser', 'onboardingVariationA.ts'), options.includeOnboardingSignInDefault
		? "private readonly steps = defaultChat ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);\n"
		: options.includeOfficialWelcomeDefaults
			? "private readonly steps = ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);\nthis._footerSignInBtn.textContent = localize('onboarding.sessions.signInNudge', \"Sign in for AI Powered Features\");\nthis._createDocLink(docsRow, localize('onboarding.sessions.agentsTutorial', \"Agents tutorial\"), 'https://code.visualstudio.com/docs/copilot/agents/agents-tutorial', 'agentsTutorial');\nlocalize('onboarding.sessions.runAnywhere.desc', \"Run agents locally with Copilot CLI.\");\n"
			: "private readonly steps = ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeGettingStarted', 'common', 'gettingStartedContent.ts'), options.includeOfficialWelcomeDefaults
		? "title: localize('gettingStarted.setup.title', \"Get started with VS Code\"),\nwalkthroughPageTitle: localize('gettingStarted.setup.walkthroughPageTitle', 'Setup VS Code'),\ncreateCopilotSetupStep('CopilotSetupAnonymous', CopilotAnonymousButton, 'chatAnonymous', true),\nButton(localize('watch', \"Watch Tutorial\"), 'https://aka.ms/vscode-getting-started-video')\nButton(localize('workspaceTrust', \"Workspace Trust\"), 'https://code.visualstudio.com/docs/editor/workspace-trust')\n"
		: "title: localize('gettingStarted.setup.title', \"Get started with OpenCode IDE\"),\nwalkthroughPageTitle: localize('gettingStarted.setup.walkthroughPageTitle', 'Setup OpenCode IDE'),\nButton(localize('workspaceTrust', \"Workspace Trust\"), 'command:toSide:workbench.trust.manage')\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeGettingStarted', 'browser', 'gettingStarted.contribution.ts'), `'workbench.startupEditor': {
	'default': '${options.includeStartupWelcomeDefault ? 'welcomePage' : 'none'}',
}
`);
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'preferences', 'browser', 'settingsLayout.ts'), options.includeCopilotUiReferences ? "const COMMONLY_USED_SETTINGS = [\n\t'editor.fontSize',\n\t'GitHub.copilot-chat.manageExtension',\n];\n" : "const COMMONLY_USED_SETTINGS = [\n\t'editor.fontSize',\n];\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'editTelemetry', 'browser', 'telemetry', 'editSourceTrackingFeature.ts'), options.includeCopilotUiReferences ? "import { derived, observableFromEvent } from '../../../../../base/common/observable.js';\nimport { IExtensionService } from '../../../../services/extensions/common/extensions.js';\nclass Feature {\n\tconstructor(@IExtensionService private readonly _extensionService: IExtensionService) {\n\t\tconst extensions = observableFromEvent(this._extensionService.onDidChangeExtensions, () => {\n\t\t\treturn this._extensionService.extensions;\n\t\t});\n\t\tconst extensionIds = derived(reader => new Set(extensions.read(reader).map(e => e.id?.toLowerCase())));\n\t\tfunction getExtensionInfoObs(extensionId: string, extensionService: IExtensionService) {\n\t\t\tconst extIdLowerCase = extensionId.toLowerCase();\n\t\t\treturn derived(reader => extensionIds.read(reader).has(extIdLowerCase));\n\t\t}\n\n\t\tconst copilotInstalled = getExtensionInfoObs('GitHub.copilot', this._extensionService);\n\t\tconst copilotChatInstalled = getExtensionInfoObs('GitHub.copilot-chat', this._extensionService);\n\n\t\tconst shouldSendDetails = derived(reader => editSourceDetailsEnabled.read(reader) || !!copilotInstalled.read(reader) || !!copilotChatInstalled.read(reader));\n\t}\n}\n" : "import { derived, observableFromEvent } from '../../../../../base/common/observable.js';\nclass Feature {\n\tconstructor() {\n\t\tconst shouldSendDetails = derived(reader => editSourceDetailsEnabled.read(reader));\n\t}\n}\n");
	const defaultAccountCommandImport = "import { DEFAULT_ACCOUNT_SIGN_IN_COMMAND } from '../../../services/accounts/browser/defaultAccount.js';\n";
	const defaultAccountCommandLocal = "const DEFAULT_ACCOUNT_SIGN_IN_COMMAND = 'workbench.actions.accounts.signIn';\n";
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensions.contribution.ts'), `${options.includeDefaultAccountSideEffectImports ? defaultAccountCommandImport : defaultAccountCommandLocal}accessor.get(ICommandService).executeCommand(DEFAULT_ACCOUNT_SIGN_IN_COMMAND);\n`);
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensionsViewlet.ts'), `${options.includeDefaultAccountSideEffectImports ? defaultAccountCommandImport : defaultAccountCommandLocal}const content = \`command:\${DEFAULT_ACCOUNT_SIGN_IN_COMMAND}\`;\n`);
	writeText(path.join(root, 'scripts', 'code-opencode-dev.ps1'), options.includeOfficialExtensionLauncherDisables === false ? "$env:OPENCODE_CONFIG_DIR = $generativeUiConfigDir\n& $codeBat \"--user-data-dir=$userDataDir\" @CodeArgs\nexit $LASTEXITCODE\n" : "$cleanDisabledExtensionArgs = @(\n  '--disable-extension=GitHub.copilot-chat',\n  '--disable-extension=vscode.github-authentication',\n  '--disable-extension=vscode.microsoft-authentication'\n)\n$env:OPENCODE_CONFIG_DIR = $generativeUiConfigDir\n& $codeBat \"--user-data-dir=$userDataDir\" @cleanDisabledExtensionArgs @CodeArgs\nexit $LASTEXITCODE\n");

	writeText(path.join(root, 'resources', 'linux', 'code.desktop'), 'Keywords=opencode;ide;\n');
	writeText(path.join(root, 'resources', 'linux', 'code.appdata.xml'), 'https://github.com/xxloocee/opencode-ide\n');
	writeText(path.join(root, 'resources', 'linux', 'snap', 'snapcraft.yaml'), 'summary: OpenCode IDE\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'control.template'), 'Maintainer: OpenCode IDE Maintainers <noreply@opencode-ide.local>\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'templates.template'), 'Template: @@NAME@@/configure-external-repo\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'postinst.template'), 'OpenCode IDE packages do not configure any external apt repository.\n');
	writeText(path.join(root, 'resources', 'linux', 'rpm', 'code.spec.template'), 'Vendor:   OpenCode IDE\n');
	writeText(path.join(root, 'build', 'win32', 'code.iss'), 'AppPublisher=OpenCode IDE\nSource: "tools\\*"; DestDir: "{app}\\{#VersionedResourcesFolder}\\tools"; Flags: ignoreversion skipifsourcedoesntexist\n');
	writeJson(path.join(root, 'resources', 'server', 'manifest.json'), {
		name: options.includeUpstreamProductIcons ? 'Code - OSS' : 'OpenCode IDE',
		short_name: options.includeUpstreamProductIcons ? 'Code - OSS' : 'OpenCode IDE',
		icons: []
	});
	writeProductIconFixtures(root, options.includeUpstreamProductIcons);
	writeText(path.join(root, 'build', 'win32', 'i18n', 'messages.en.isl'), 'UpdatingVisualStudioCode=OpenCode IDE is updating...\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensions.contribution.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensionsActions.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensionsWorkbenchService.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'common', 'extensionsFileTemplate.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'common', 'installExtensionsTool.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'common', 'searchExtensionsTool.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'electron-browser', 'extensionsSlowActions.ts'), 'const text = "OpenCode IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'issue', 'browser', 'baseIssueReporterService.ts'), 'const text = "OpenCode IDE issue reporter";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'issue', 'browser', 'issueReporterModel.ts'), 'const text = "OpenCode IDE issue reporter";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'issue', 'browser', 'issueReporterPage.ts'), 'const text = "OpenCode IDE issue reporter";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'opencode', 'browser', 'opencode.contribution.ts'), 'const text = "OpenCode IDE";\n');
	if (options.includeOpenCodeBridge === false) {
		writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'opencode', 'browser', 'opencodeWebview.contribution.ts'), 'const disabled = true;\n');
		writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'opencode', 'browser', 'opencodeProtocol.ts'), 'export const disabled = true;\n');
	} else {
		writeText(path.join(root, 'src', 'vs', 'workbench', 'workbench.desktop.main.ts'), `${fs.readFileSync(path.join(root, 'src', 'vs', 'workbench', 'workbench.desktop.main.ts'), 'utf8')}import './contrib/opencode/electron-browser/opencodeHostService.js';\nimport './contrib/opencode/browser/opencode.contribution.js';\nimport './contrib/opencode/browser/opencodeWebview.contribution.js';\n`);
		writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'opencode', 'browser', 'opencodeWebview.contribution.ts'), "import { InputFocusedContext } from '../../../../platform/contextkey/common/contextkeys.js';\nwebviews.register(OpenCodeViewId, {});\nwhen: ContextKeyExpr.or(EditorContextKeys.editorTextFocus, InputFocusedContext.toNegated())\nif (evt.data?.source === 'opencode-bridge') { vscode.postMessage(evt.data); }\nif (evt.data?.source === 'opencode-host') { postToApp(evt.data); }\nif (evt.data?.source === 'opencode-host-event') { postToApp(evt.data); }\n");
		writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'opencode', 'browser', 'opencodeProtocol.ts'), "type A = { method: 'context.get' };\ntype B = { method: 'editor.open' };\ntype C = { method: 'terminal.last.get' };\ntype D = { method: 'diagnostics.workspace.get' };\n");
	}

	return root;
}

function writeJson(file, value) {
	writeText(file, JSON.stringify(value, null, '\t') + '\n');
}

function writeProductIconFixtures(root, useUpstreamPlaceholders = false) {
	const iconRoot = path.join(repoRoot, 'config', 'sanitize', 'assets', 'product-icons');
	const icons = [
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

	for (const [sourceName, targetRel] of icons) {
		const target = path.join(root, targetRel);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		if (useUpstreamPlaceholders) {
			fs.writeFileSync(target, 'upstream icon placeholder\n');
		} else {
			fs.copyFileSync(path.join(iconRoot, sourceName), target);
		}
	}
}

function assertProductIconEquals(root, sourceName, targetRel) {
	const source = path.join(repoRoot, 'config', 'sanitize', 'assets', 'product-icons', sourceName);
	const target = path.join(root, targetRel);
	assert.equal(fs.readFileSync(target).equals(fs.readFileSync(source)), true, targetRel);
}

function writeText(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

function normalizeLineEndings(text) {
	return text.replace(/\r\n/g, '\n');
}
