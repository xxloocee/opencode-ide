import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export function applyPatchSets({ root, patchRoot, patchSets }) {
	for (const patchSet of patchSets) {
		const sourceRoot = path.join(patchRoot, patchSet);
		if (!fs.existsSync(sourceRoot)) {
			console.log(`[sanitize] patch-set skipped missing=${patchSet}`);
			continue;
		}

		for (const patchFile of walkPatchFiles(sourceRoot)) {
			applyPatchFile({ root, patchFile, patchSet });
		}
	}
}

function applyPatchFile({ root, patchFile, patchSet }) {
	const relativePath = toPosix(path.relative(root, patchFile));
	const check = runGitApply(root, ['--check', '--ignore-whitespace', patchFile]);
	if (check.status === 0) {
		const apply = runGitApply(root, ['--ignore-whitespace', patchFile]);
		if (apply.status !== 0) {
			throw new Error(formatPatchError('failed to apply', relativePath, apply));
		}
		console.log(`[sanitize] patch ${patchSet}/${path.basename(patchFile)}`);
		return;
	}

	const reverseCheck = runGitApply(root, ['--check', '--reverse', '--ignore-whitespace', patchFile]);
	if (reverseCheck.status === 0) {
		console.log(`[sanitize] patch already applied ${patchSet}/${path.basename(patchFile)}`);
		return;
	}

	throw new Error(formatPatchError('cannot apply', relativePath, check));
}

function runGitApply(cwd, args) {
	return spawnSync('git', ['apply', ...args], {
		cwd,
		encoding: 'utf8'
	});
}

function walkPatchFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true })
		.flatMap(entry => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				return walkPatchFiles(fullPath);
			}
			return entry.isFile() && entry.name.endsWith('.patch') ? [fullPath] : [];
		})
		.sort((a, b) => a.localeCompare(b));
}

function formatPatchError(reason, patchFile, result) {
	const details = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
	return `[sanitize] ${reason}: ${patchFile}${details ? `\n${details}` : ''}`;
}

function toPosix(filePath) {
	return filePath.split(path.sep).join('/');
}
