import fs from 'node:fs';
import path from 'node:path';

const rootArgument = process.argv.find(argument => argument.startsWith('--root='));
if (!rootArgument) {
	throw new Error('Usage: node tools/validate-opencode-runtime.mjs --root=<opencode-source>');
}

const root = path.resolve(rootArgument.slice('--root='.length));
const lockPath = path.join(root, 'bun.lock');
const rootPackagePath = path.join(root, 'package.json');

const lock = fs.readFileSync(lockPath);
if ((lock[0] === 0xFF && lock[1] === 0xFE) || (lock[0] === 0xFE && lock[1] === 0xFF)) {
	throw new Error(`${lockPath} must be UTF-8; UTF-16 lockfiles are ignored by Bun`);
}

let lockText;
try {
	lockText = new TextDecoder('utf-8', { fatal: true }).decode(lock);
} catch {
	throw new Error(`${lockPath} must contain valid UTF-8`);
}
if (lockText.includes('\0')) {
	throw new Error(`${lockPath} contains NUL bytes and is not a valid UTF-8 Bun text lockfile`);
}

const firstLockCharacter = lockText.replace(/^\uFEFF/, '').trimStart()[0];
if (firstLockCharacter !== '{') {
	throw new Error(`${lockPath} is not a Bun text lockfile`);
}

const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
const catalog = rootPackage.workspaces?.catalog ?? {};
const namedCatalogs = rootPackage.workspaces?.catalogs ?? {};
const workspacePatterns = Array.isArray(rootPackage.workspaces)
	? rootPackage.workspaces
	: rootPackage.workspaces?.packages ?? [];
const manifestPaths = new Set([rootPackagePath]);
const missingCatalogEntries = [];

for (const pattern of workspacePatterns) {
	for (const workspaceDirectory of expandWorkspacePattern(pattern)) {
		const manifestPath = path.join(workspaceDirectory, 'package.json');
		if (fs.existsSync(manifestPath)) {
			manifestPaths.add(manifestPath);
		}
	}
}

for (const manifestPath of manifestPaths) {
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		for (const [name, version] of Object.entries(manifest[section] ?? {})) {
			if (typeof version !== 'string' || !version.startsWith('catalog:')) {
				continue;
			}
			const catalogName = version.slice('catalog:'.length);
			const selectedCatalog = catalogName ? namedCatalogs[catalogName] ?? {} : catalog;
			if (!(name in selectedCatalog)) {
				missingCatalogEntries.push(`${path.relative(root, manifestPath)}:${section}.${name}`);
			}
		}
	}
}

if (missingCatalogEntries.length > 0) {
	throw new Error(`OpenCode workspaces reference missing catalog entries: ${missingCatalogEntries.join(', ')}`);
}

const appPackagePath = path.join(root, 'packages', 'app', 'package.json');
const appIdePackagePath = path.join(root, 'packages', 'app-ide', 'package.json');
if (fs.existsSync(appPackagePath) && fs.existsSync(appIdePackagePath)) {
	const appDependencies = JSON.parse(fs.readFileSync(appPackagePath, 'utf8')).dependencies ?? {};
	const appIdeDependencies = JSON.parse(fs.readFileSync(appIdePackagePath, 'utf8')).dependencies ?? {};
	const mismatchedSharedDependencies = Object.keys(appIdeDependencies)
		.filter(name => name in appDependencies && appDependencies[name] !== appIdeDependencies[name])
		.map(name => `${name} (${appDependencies[name]} != ${appIdeDependencies[name]})`);
	if (mismatchedSharedDependencies.length > 0) {
		throw new Error(`OpenCode app-ide shared dependencies must match app: ${mismatchedSharedDependencies.join(', ')}`);
	}
}

console.log(`[opencode-runtime] validated ${root}`);

function expandWorkspacePattern(pattern) {
	let candidates = [root];
	for (const segment of pattern.replaceAll('\\', '/').split('/').filter(Boolean)) {
		if (segment === '*') {
			candidates = candidates.flatMap(candidate => fs.existsSync(candidate)
				? fs.readdirSync(candidate, { withFileTypes: true })
					.filter(entry => entry.isDirectory())
					.map(entry => path.join(candidate, entry.name))
				: []);
			continue;
		}
		if (segment.includes('*')) {
			throw new Error(`Unsupported OpenCode workspace pattern: ${pattern}`);
		}
		candidates = candidates.map(candidate => path.join(candidate, segment));
	}
	return candidates;
}
