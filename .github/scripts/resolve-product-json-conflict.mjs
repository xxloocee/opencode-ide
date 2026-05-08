import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function readStage(stage, file) {
	return JSON.parse(execFileSync('git', ['show', `:${stage}:${file}`], { encoding: 'utf8' }));
}

const ours = readStage(2, 'product.json');
const theirs = readStage(3, 'product.json');
const merged = { ...ours };

const brandKeys = [
	'nameShort',
	'nameLong',
	'applicationName',
	'dataFolderName',
	'win32MutexName',
	'serverApplicationName',
	'serverDataFolderName',
	'tunnelApplicationName',
	'win32DirName',
	'win32NameVersion',
	'win32RegValueName',
	'win32x64AppId',
	'win32arm64AppId',
	'win32x64UserAppId',
	'win32arm64UserAppId',
	'win32AppUserModelId',
	'win32ShellNameShort',
	'win32TunnelServiceMutex',
	'win32TunnelMutex',
	'darwinBundleIdentifier',
	'linuxIconName',
	'urlProtocol'
];

for (const key of brandKeys) {
	if (Object.prototype.hasOwnProperty.call(theirs, key)) {
		merged[key] = theirs[key];
	}
}

if (Object.prototype.hasOwnProperty.call(theirs, 'sharedDataFolderName')) {
	merged.sharedDataFolderName = theirs.sharedDataFolderName;
} else if (typeof theirs.dataFolderName === 'string' && theirs.dataFolderName.length > 0) {
	merged.sharedDataFolderName = `${theirs.dataFolderName}-shared`;
}

fs.writeFileSync('product.json', `${JSON.stringify(merged, null, '\t')}\n`);
