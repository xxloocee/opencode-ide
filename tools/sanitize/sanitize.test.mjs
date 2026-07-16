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

test('release workflow treats manual product versions as data', () => {
	const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'build-ergouzi-ide-installers.yml'), 'utf8');
	const runtimeRef = fs.readFileSync(path.join(repoRoot, '.github', 'opencode-runtime-ref'), 'utf8').trim();

	assert.match(runtimeRef, /^[0-9a-f]{40}$/);
	assert.match(workflow, /INPUT_RELEASE_VERSION: \$\{\{ inputs\.release_version \}\}/);
	assert.match(workflow, /release_version="\$INPUT_RELEASE_VERSION"/);
	assert.doesNotMatch(workflow, /release_version="\$\{\{ inputs\.release_version \}\}"/);
	assert.match(workflow, /if \[\[ "\$GITHUB_EVENT_NAME" == "push" && "\$GITHUB_REF" == refs\/tags\/ergouzi-ide-v\* \]\]/);
	assert.match(workflow, /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/ergouzi-ide-v'\)/);
	assert.match(workflow, /^permissions:\r?\n  contents: read$/m);
	assert.match(workflow, /^  release:[\s\S]*?^    permissions:\r?\n      contents: write$/m);
	assert.doesNotMatch(workflow, /^      GITHUB_TOKEN:/m);
	assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 4);
	assert.equal((workflow.match(/token: \$\{\{ secrets\.CROSS_REPO_GH_TOKEN \|\| secrets\.UPSTREAM_SYNC_TOKEN \|\| github\.token \}\}/g) || []).length, 2);
	assert.match(workflow, /tr -d '\\r\\n' < \.github\/opencode-runtime-ref/);
	assert.match(workflow, /opencode_ref: \$\{\{ steps\.opencode-source\.outputs\.ref \}\}/);
	assert.match(workflow, /opencode_sha: \$\{\{ steps\.opencode-revision\.outputs\.sha \}\}/);
	assert.match(workflow, /ref: \$\{\{ needs\.plan\.outputs\.opencode_sha \}\}/);
	assert.doesNotMatch(workflow, /ref: \$\{\{ env\.OPENCODE_REF \}\}\r?\n          path: opencode-source\r?\n          fetch-depth: 0/);
	assert.match(workflow, /Refuse to overwrite an existing release/);
	assert.match(workflow, /softprops\/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2\.6\.2/);
});

test('Darwin post-package tasks use the compatibility app bundle path', () => {
	const gulpfile = fs.readFileSync(path.join(repoRoot, 'build', 'gulpfile.vscode.ts'), 'utf8');
	assert.match(gulpfile, /productAppName: platform === 'darwin' \? \(product\.darwinApplicationName \|\| product\.nameLong\) : product\.nameLong/);
	assert.match(gulpfile, /path\.join\(outputDir, `\$\{product\.darwinApplicationName \|\| product\.nameLong\}\.app`/);

	const electron = fs.readFileSync(path.join(repoRoot, 'build', 'lib', 'electron.ts'), 'utf8');
	assert.match(electron, /productAppName: process\.platform === 'darwin' \? \(product\.darwinApplicationName \|\| product\.nameLong\) : product\.nameLong/);

	for (const rel of ['build/darwin/create-dmg.ts', 'build/darwin/create-universal-app.ts', 'build/darwin/sign.ts']) {
		const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
		assert.match(text, /const appName = \(product\.darwinApplicationName \|\| product\.nameLong\) \+ '\.app';/, rel);
		assert.doesNotMatch(text, /product\.nameLong \+ '\.app'|`\$\{product\.nameLong\}\.app`/, rel);
	}
});

test('release guide stages required implementation files and publishes from main', () => {
	const guide = fs.readFileSync(path.join(repoRoot, 'docs', 'ergouzi-ide-release-plan.zh.md'), 'utf8');

	for (const requiredPath of [
		'.github/opencode-runtime-ref',
		'build/darwin/create-dmg.ts',
		'build/darwin/create-universal-app.ts',
		'build/darwin/sign.ts',
		'build/gulpfile.vscode.ts',
		'build/lib/electron.ts',
		'build/win32/code.iss',
		'package.json',
		'product.json',
		':(glob).github/workflows/build-*-installers.yml',
		':(glob)scripts/*win32-system-setup.ps1',
		':(glob)docs/*release-plan.zh.md'
	]) {
		assert.match(guide, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	}
	assert.match(guide, /git checkout main/);
	assert.match(guide, /git push origin HEAD:main/);
	assert.doesNotMatch(guide, /release\/opencode-clean/);
	assert.match(guide, /在 `main` 上保留自动净化脚本/);

	const releaseFlow = guide.slice(guide.indexOf('## 测试 tag 流程'));
	assert.match(releaseFlow, /function Invoke-NativeStep/);
	assert.match(releaseFlow, /if \(\$LASTEXITCODE -ne 0\) \{\s*throw "\$Label failed with exit code \$LASTEXITCODE"/);
	assert.doesNotMatch(releaseFlow, /^(?:git|node)\s/m);
	for (const command of [
		'git commit -m "chore: unify Ergouzi IDE release identity"',
		'git fetch origin',
		'git rebase origin/main',
		'git push origin HEAD:main',
		'git rev-parse HEAD',
		'git rev-parse origin/main',
		'git tag "ergouzi-ide-v$version"',
	]) {
		assert.match(releaseFlow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	}
	assert.ok(releaseFlow.indexOf('git commit -m') < releaseFlow.indexOf('git fetch origin'));
	assert.ok(releaseFlow.indexOf('git fetch origin') < releaseFlow.indexOf('git rebase origin/main'));
	assert.ok(releaseFlow.indexOf('git rebase origin/main') < releaseFlow.indexOf('git push origin HEAD:main'));
	assert.ok(releaseFlow.indexOf('$localHead =') < releaseFlow.indexOf('git tag "ergouzi-ide-v$version"'));

	for (const protectedCommand of [
		"Invoke-NativeStep 'create release tag' { git tag \"ergouzi-ide-v$version\" }",
		"Invoke-NativeStep 'push release tag' { git push origin \"ergouzi-ide-v$version\" }",
	]) {
		assert.match(releaseFlow, new RegExp(protectedCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	}
	for (const repeatedProtectedCommand of [
		"Invoke-NativeStep 'run sanitizer tests' { node tools\\sanitize\\sanitize.test.mjs }",
		"Invoke-NativeStep 'check working tree diff' { git diff --check }",
	]) {
		const commandPattern = new RegExp(repeatedProtectedCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
		assert.equal((releaseFlow.match(commandPattern) || []).length, 1);
	}
	assert.match(releaseFlow, /Invoke-NativeStep 'rerun sanitizer tests' \{ node tools\\sanitize\\sanitize\.test\.mjs \}/);
	assert.match(releaseFlow, /Invoke-NativeStep 'recheck working tree diff' \{ git diff --check \}/);
});

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
	writeText(codeIssPath, fs.readFileSync(codeIssPath, 'utf8').replace('Flags: ignoreversion skipifsourcedoesntexist', 'Flags: ignoreversion'));

	const first = runNode(applyScript, `--root=${root}`, '--profile=clean-full');
	const second = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

	assert.equal(first.status, 0, first.stderr + first.stdout);
	assert.equal(second.status, 0, second.stderr + second.stdout);
	const text = fs.readFileSync(codeIssPath, 'utf8');
	assert.match(text, /Source: "tools\\\*"; DestDir: "\{app\}\\\{#VersionedResourcesFolder\}\\tools"; Flags: ignoreversion skipifsourcedoesntexist/);
	assert.doesNotMatch(text, /skipifsourcedoesntexist skipifsourcedoesntexist/);
});

test('apply clean-full installs legacy Windows launchers and removes released names on upgrade', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
	const codeIssPath = path.join(root, 'build', 'win32', 'code.iss');
	writeText(codeIssPath, '[InstallDelete]\nType: files; Name: "{app}\\OpenCode IDE.exe"; Check: IsNotBackgroundUpdate\nAppPublisher=Microsoft Corporation\nSource: "tools\\*"; DestDir: "{app}\\{#VersionedResourcesFolder}\\tools"; Flags: ignoreversion\nSource: "bin\\{#ApplicationName}.cmd"; DestDir: "{code:GetDestDir}\\bin"; DestName: "{code:GetBinDirApplicationCmdFilename}"; Flags: ignoreversion\nSource: "bin\\{#ApplicationName}"; DestDir: "{code:GetDestDir}\\bin"; DestName: "{code:GetBinDirApplicationFilename}"; Flags: ignoreversion\nSource: "bin\\opencode-ide.cmd"; DestDir: "{code:GetDestDir}\\bin"; DestName: "opencode-ide.cmd"; Flags: ignoreversion\n[Registry]\n#ifdef UnrelatedRegistryFeature\n#define UnrelatedRegistryFeatureEnabled\n#endif\n#if "user" == InstallTarget\n#define SoftwareClassesRootKey "HKCU"\n#else\n#define SoftwareClassesRootKey "HKLM"\n#endif\nRoot: {#SoftwareClassesRootKey}; Subkey: "Software\\Classes\\.ascx\\OpenWithProgids"; ValueType: none\n#if "user" == InstallTarget\n#define EnvironmentRootKey "HKCU"\n#else\n#define EnvironmentRootKey "HKLM"\n#endif\n; App Paths - allows running code from Explorer address bar\nRoot: {#EnvironmentRootKey}; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{#ApplicationName}.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\\{#ExeBasename}.exe"; Flags: uninsdeletekey\n');

	const first = runNode(applyScript, `--root=${root}`, '--profile=clean-full');
	const second = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

	assert.equal(first.status, 0, first.stderr + first.stdout);
	assert.equal(second.status, 0, second.stderr + second.stdout);
	const text = fs.readFileSync(codeIssPath, 'utf8');
	assert.equal((text.match(/Source: "bin\\opencode-ide\.cmd"/g) || []).length, 1);
	assert.equal((text.match(/Source: "bin\\opencode-ide";/g) || []).length, 1);
	assert.equal((text.match(/Name: "\{app\}\\OpenCode IDE\.exe"/g) || []).length, 1);
	assert.match(text, /Name: "\{autodesktop\}\\OpenCode IDE\.lnk"/);
	assert.equal((text.match(/Name: "\{app\}\\ErgouziCode\.exe"/g) || []).length, 1);
	assert.equal((text.match(/Name: "\{app\}\\ErgouziCode\.VisualElementsManifest\.xml"/g) || []).length, 1);
	assert.match(text, /Name: "\{autodesktop\}\\ErgouziCode Preview\.lnk"/);
	assert.equal((text.match(/Name: "\{userappdata\}\\Microsoft\\Internet Explorer\\Quick Launch\\OpenCode IDE\.lnk"/g) || []).length, 1);
	assert.equal((text.match(/Name: "\{userappdata\}\\Microsoft\\Internet Explorer\\Quick Launch\\ErgouziCode Preview\.lnk"/g) || []).length, 1);
	assert.equal((text.match(/Software\\Classes\\Applications\\OpenCode IDE\.exe/g) || []).length, 1);
	assert.equal((text.match(/Software\\Classes\\Applications\\ErgouziCode\.exe/g) || []).length, 1);
	assert.ok(text.indexOf('Software\\Classes\\Applications\\OpenCode IDE.exe') > text.indexOf('#define SoftwareClassesRootKey "HKLM"\n#endif'));
	assert.ok(text.indexOf('Software\\Classes\\Applications\\OpenCode IDE.exe') < text.indexOf('Software\\Classes\\.ascx\\OpenWithProgids'));
	assert.equal((text.match(/App Paths\\opencode-ide\.exe"; ValueType: string/g) || []).length, 1);
	assert.equal((text.match(/App Paths\\ergouzicode-preview\.exe"; ValueType: string/g) || []).length, 1);
	assert.equal((text.match(/App Paths\\opencode-ide\.exe"; ValueType: none; ValueName: "Path"; Flags: deletevalue/g) || []).length, 1);
	assert.equal((text.match(/App Paths\\ergouzicode-preview\.exe"; ValueType: none; ValueName: "Path"; Flags: deletevalue/g) || []).length, 1);
});

test('apply clean-full rejects missing Windows registry insertion anchors', () => {
	for (const [label, mutate, expected] of [
		[
			'Registry section',
			text => text
				.replace('[Registry]', '[MissingRegistry]')
				.split('\n').filter(line => !line.includes('Software\\Classes\\Applications\\')).join('\n'),
			/SoftwareClassesRootKey insertion anchor/,
		],
		[
			'App Paths marker',
			text => text
				.replace('; App Paths - allows running code from Explorer address bar', '; Missing App Paths marker')
				.split('\n').filter(line => !line.includes('CurrentVersion\\App Paths\\')).join('\n'),
			/App Paths insertion anchor/,
		],
	]) {
		const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
		const codeIssPath = path.join(root, 'build', 'win32', 'code.iss');
		writeText(codeIssPath, mutate(fs.readFileSync(codeIssPath, 'utf8')));

		const result = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

		assert.notEqual(result.status, 0, label);
		assert.match(result.stderr + result.stdout, expected, label);
	}
});

test('verify clean-full rejects a missing Windows Registry section', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
	const codeIssPath = path.join(root, 'build', 'win32', 'code.iss');
	writeText(codeIssPath, fs.readFileSync(codeIssPath, 'utf8').replace('[Registry]', '[MissingRegistry]'));

	const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

	assert.notEqual(result.status, 0);
	assert.match(result.stderr + result.stdout, /legacyRegistryMigration/);
});

test('apply clean-full preserves the previous Linux package and command identity', () => {
	const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
	writeText(path.join(root, 'resources', 'linux', 'debian', 'control.template'), 'Maintainer: Microsoft Corporation <vscode-linux@microsoft.com>\nHomepage: https://code.visualstudio.com/\nProvides: visual-studio-@@NAME@@\nConflicts: visual-studio-@@NAME@@\nReplaces: visual-studio-@@NAME@@\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'postinst.template'), 'rm -f /usr/bin/@@NAME@@\nln -s /usr/share/@@NAME@@/bin/@@NAME@@ /usr/bin/@@NAME@@\n# packages.microsoft.com/repos/code\nif [ "@@NAME@@" != "code-oss" ]; then\n\texit 0\nfi\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'postrm.template'), 'rm -f /usr/bin/@@NAME@@\n');
	writeText(path.join(root, 'resources', 'linux', 'rpm', 'code.spec.template'), 'Vendor:   Microsoft Corporation\nPackager: Visual Studio Code Team <vscode-linux@microsoft.com>\nRecommends: @@RECOMMENDS@@\nln -s %{_datadir}/%{name}/bin/%{name} %{buildroot}%{_bindir}/%{name}\n%{_bindir}/%{name}\n');

	const first = runNode(applyScript, `--root=${root}`, '--profile=clean-full');
	const second = runNode(applyScript, `--root=${root}`, '--profile=clean-full');

	assert.equal(first.status, 0, first.stderr + first.stdout);
	assert.equal(second.status, 0, second.stderr + second.stdout);
	const debianControl = fs.readFileSync(path.join(root, 'resources', 'linux', 'debian', 'control.template'), 'utf8');
	assert.equal((debianControl.match(/^Provides: visual-studio-@@NAME@@, opencode-ide$/gm) || []).length, 1);
	assert.equal((debianControl.match(/^Conflicts: visual-studio-@@NAME@@, opencode-ide$/gm) || []).length, 1);
	assert.equal((debianControl.match(/^Replaces: visual-studio-@@NAME@@, opencode-ide$/gm) || []).length, 1);
	assert.match(fs.readFileSync(path.join(root, 'resources', 'linux', 'debian', 'postinst.template'), 'utf8'), /\/usr\/bin\/opencode-ide/);
	const postrm = fs.readFileSync(path.join(root, 'resources', 'linux', 'debian', 'postrm.template'), 'utf8');
	assert.equal((postrm.match(/^\s*rm -f \/usr\/bin\/opencode-ide$/gm) || []).length, 1);
	const rpm = fs.readFileSync(path.join(root, 'resources', 'linux', 'rpm', 'code.spec.template'), 'utf8');
	assert.equal((rpm.match(/^Provides: opencode-ide = %\{version\}-%\{release\}$/gm) || []).length, 1);
	assert.equal((rpm.match(/^Obsoletes: opencode-ide < %\{version\}-%\{release\}$/gm) || []).length, 1);
	assert.equal((rpm.match(/^ln -s .*%\{_bindir\}\/opencode-ide$/gm) || []).length, 1);
	assert.equal((rpm.match(/^%\{_bindir\}\/opencode-ide$/gm) || []).length, 1);
});

test('verify clean-full rejects missing Linux package replacement declarations', () => {
	for (const [rel, snippet] of [
		['resources/linux/debian/control.template', 'Conflicts: visual-studio-@@NAME@@, opencode-ide\n'],
		['resources/linux/debian/control.template', 'Replaces: visual-studio-@@NAME@@, opencode-ide\n'],
		['resources/linux/rpm/code.spec.template', 'Obsoletes: opencode-ide < %{version}-%{release}\n'],
	]) {
		const root = makeFixtureRoot({ includeCoreWorkbenchChatEntry: true });
		const file = path.join(root, rel);
		writeText(file, fs.readFileSync(file, 'utf8').replace(snippet, ''));

		const result = runNode(verifyScript, `--root=${root}`, '--profile=clean-full');

		assert.notEqual(result.status, 0, `${rel}: ${snippet}`);
		assert.match(result.stderr + result.stdout, new RegExp(rel.replaceAll('/', '[\\\\/]')));
	}
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
		name: 'Ergouzi IDE',
		short_name: 'Ergouzi IDE',
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
		nameShort: 'Ergouzi IDE',
		nameLong: 'Ergouzi IDE',
		applicationName: 'ergouzi-ide',
		dataFolderName: '.opencode-ide',
		sharedDataFolderName: '.opencode-ide-shared',
		serverApplicationName: 'opencode-ide-server',
		serverDataFolderName: '.opencode-ide-server',
		tunnelApplicationName: 'opencode-ide-tunnel',
		win32DirName: 'Ergouzi IDE',
		win32NameVersion: 'Ergouzi IDE',
		win32RegValueName: 'OpenCodeIDE',
		win32AppUserModelId: 'OpenCode.IDE',
		win32ShellNameShort: '&Ergouzi IDE',
		darwinApplicationName: 'OpenCode IDE',
		darwinBundleIdentifier: 'com.opencode.ide',
		linuxIconName: 'ergouzi-ide',
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
	writeText(path.join(root, 'src', 'vs', 'platform', 'product', 'common', 'product.ts'), options.includeProductFallbackCopilotDefaults ? "Object.assign(product, {\n\tnameShort: 'Code - OSS Dev',\n\tnameLong: 'Code - OSS Dev',\n\tapplicationName: 'code-oss',\n\tdataFolderName: '.vscode-oss',\n\turlProtocol: 'code-oss',\n\treportIssueUrl: 'https://github.com/microsoft/vscode/issues/new',\n\tlicenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',\n\tserverLicenseUrl: 'https://github.com/microsoft/vscode/blob/main/LICENSE.txt',\n\tdefaultChatAgent: {\n\t\textensionId: 'GitHub.copilot',\n\t\tchatExtensionId: 'GitHub.copilot-chat',\n\t\tprovider: { default: { id: 'github', name: 'GitHub' }, enterprise: { id: 'github-enterprise', name: 'GitHub Enterprise' } },\n\t\tproviderScopes: []\n\t}\n});\n" : "Object.assign(product, {\n\tnameShort: 'Ergouzi IDE Dev',\n\tnameLong: 'Ergouzi IDE Dev',\n\tapplicationName: 'ergouzi-ide',\n\tdataFolderName: '.opencode-ide',\n\turlProtocol: 'opencode-ide',\n\tdefaultChatAgent: {\n\t\textensionId: 'opencode.ide-placeholder',\n\t\tchatExtensionId: 'opencode.ide-placeholder-chat',\n\t\tprovider: { default: { id: 'opencode', name: 'OpenCode' }, enterprise: { id: 'opencode-enterprise', name: 'OpenCode Enterprise' } },\n\t\tproviderScopes: []\n\t}\n});\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeOnboarding', 'common', 'onboardingTypes.ts'), options.includeOnboardingSignInDefault ? "export const ONBOARDING_STEPS = [\n\tOnboardingStepId.SignIn,\n\tOnboardingStepId.Personalize,\n];\n" : "export const ONBOARDING_STEPS = [\n\tOnboardingStepId.Personalize,\n];\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeOnboarding', 'browser', 'onboardingVariationA.ts'), options.includeOnboardingSignInDefault
		? "private readonly steps = defaultChat ? ONBOARDING_STEPS : ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);\n"
		: options.includeOfficialWelcomeDefaults
			? "private readonly steps = ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);\nthis._footerSignInBtn.textContent = localize('onboarding.sessions.signInNudge', \"Sign in for AI Powered Features\");\nthis._createDocLink(docsRow, localize('onboarding.sessions.agentsTutorial', \"Agents tutorial\"), 'https://code.visualstudio.com/docs/copilot/agents/agents-tutorial', 'agentsTutorial');\nlocalize('onboarding.sessions.runAnywhere.desc', \"Run agents locally with Copilot CLI.\");\n"
			: "private readonly steps = ONBOARDING_STEPS.filter(step => step !== OnboardingStepId.SignIn);\n");
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'welcomeGettingStarted', 'common', 'gettingStartedContent.ts'), options.includeOfficialWelcomeDefaults
		? "title: localize('gettingStarted.setup.title', \"Get started with VS Code\"),\nwalkthroughPageTitle: localize('gettingStarted.setup.walkthroughPageTitle', 'Setup VS Code'),\ncreateCopilotSetupStep('CopilotSetupAnonymous', CopilotAnonymousButton, 'chatAnonymous', true),\nButton(localize('watch', \"Watch Tutorial\"), 'https://aka.ms/vscode-getting-started-video')\nButton(localize('workspaceTrust', \"Workspace Trust\"), 'https://code.visualstudio.com/docs/editor/workspace-trust')\n"
		: "title: localize('gettingStarted.setup.title', \"Get started with Ergouzi IDE\"),\nwalkthroughPageTitle: localize('gettingStarted.setup.walkthroughPageTitle', 'Setup Ergouzi IDE'),\nButton(localize('workspaceTrust', \"Workspace Trust\"), 'command:toSide:workbench.trust.manage')\n");
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
	writeText(path.join(root, 'resources', 'linux', 'snap', 'snapcraft.yaml'), 'summary: Ergouzi IDE\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'control.template'), 'Maintainer: Ergouzi IDE Maintainers <noreply@ergouzi-ide.local>\nProvides: visual-studio-@@NAME@@, opencode-ide\nConflicts: visual-studio-@@NAME@@, opencode-ide\nReplaces: visual-studio-@@NAME@@, opencode-ide\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'templates.template'), 'Template: @@NAME@@/configure-external-repo\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'postinst.template'), 'Ergouzi IDE packages do not configure any external apt repository.\nln -s /usr/share/@@NAME@@/bin/@@NAME@@ /usr/bin/opencode-ide\n');
	writeText(path.join(root, 'resources', 'linux', 'debian', 'postrm.template'), 'rm -f /usr/bin/opencode-ide\n');
	writeText(path.join(root, 'resources', 'linux', 'rpm', 'code.spec.template'), 'Vendor:   Ergouzi IDE\nProvides: opencode-ide = %{version}-%{release}\nObsoletes: opencode-ide < %{version}-%{release}\n%{_bindir}/opencode-ide\n');
	writeText(path.join(root, 'build', 'win32', 'code.iss'), '[InstallDelete]\nType: files; Name: "{app}\\OpenCode IDE.exe"; Check: IsNotBackgroundUpdate\nType: files; Name: "{autodesktop}\\OpenCode IDE.lnk"; Check: IsNotBackgroundUpdate\nType: files; Name: "{app}\\ErgouziCode.exe"; Check: IsNotBackgroundUpdate\nType: files; Name: "{autodesktop}\\ErgouziCode Preview.lnk"; Check: IsNotBackgroundUpdate\nAppPublisher=Ergouzi IDE\n[Registry]\nRoot: {#SoftwareClassesRootKey}; Subkey: "Software\\Classes\\Applications\\OpenCode IDE.exe"; ValueType: none; Flags: deletekey; Check: IsNotBackgroundUpdate\nRoot: {#SoftwareClassesRootKey}; Subkey: "Software\\Classes\\Applications\\ErgouziCode.exe"; ValueType: none; Flags: deletekey; Check: IsNotBackgroundUpdate\nRoot: {#EnvironmentRootKey}; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\opencode-ide.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\\{#ExeBasename}.exe"; Flags: uninsdeletekey\nRoot: {#EnvironmentRootKey}; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\opencode-ide.exe"; ValueType: none; ValueName: "Path"; Flags: deletevalue\nRoot: {#EnvironmentRootKey}; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\ergouzicode-preview.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\\{#ExeBasename}.exe"; Flags: uninsdeletekey\nRoot: {#EnvironmentRootKey}; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\ergouzicode-preview.exe"; ValueType: none; ValueName: "Path"; Flags: deletevalue\n; App Paths - allows running code from Explorer address bar\nSource: "tools\\*"; DestDir: "{app}\\{#VersionedResourcesFolder}\\tools"; Flags: ignoreversion skipifsourcedoesntexist\nSource: "bin\\opencode-ide.cmd"; DestDir: "{code:GetDestDir}\\bin"; DestName: "opencode-ide.cmd"; Flags: ignoreversion\nSource: "bin\\opencode-ide"; DestDir: "{code:GetDestDir}\\bin"; DestName: "opencode-ide"; Flags: ignoreversion\n');
	writeJson(path.join(root, 'resources', 'server', 'manifest.json'), {
		name: options.includeUpstreamProductIcons ? 'Code - OSS' : 'Ergouzi IDE',
		short_name: options.includeUpstreamProductIcons ? 'Code - OSS' : 'Ergouzi IDE',
		icons: []
	});
	writeProductIconFixtures(root, options.includeUpstreamProductIcons);
	writeText(path.join(root, 'build', 'win32', 'i18n', 'messages.en.isl'), 'UpdatingVisualStudioCode=Ergouzi IDE is updating...\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensions.contribution.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensionsActions.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'browser', 'extensionsWorkbenchService.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'common', 'extensionsFileTemplate.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'common', 'installExtensionsTool.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'common', 'searchExtensionsTool.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'extensions', 'electron-browser', 'extensionsSlowActions.ts'), 'const text = "Ergouzi IDE extensions";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'issue', 'browser', 'baseIssueReporterService.ts'), 'const text = "Ergouzi IDE issue reporter";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'issue', 'browser', 'issueReporterModel.ts'), 'const text = "Ergouzi IDE issue reporter";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'issue', 'browser', 'issueReporterPage.ts'), 'const text = "Ergouzi IDE issue reporter";\n');
	writeText(path.join(root, 'src', 'vs', 'workbench', 'contrib', 'opencode', 'browser', 'opencode.contribution.ts'), 'const text = "Ergouzi IDE";\n');
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
