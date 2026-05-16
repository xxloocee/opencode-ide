import fs from 'fs';
import path from 'path';

export function applyOverlays({ root, overlayRoot, overlays }) {
	for (const overlay of overlays) {
		const sourceRoot = path.join(overlayRoot, overlay);
		if (!fs.existsSync(sourceRoot)) {
			console.log(`[sanitize] overlay skipped missing=${overlay}`);
			continue;
		}

		for (const sourceFile of walkFiles(sourceRoot)) {
			const relativePath = path.relative(sourceRoot, sourceFile);
			const targetFile = path.join(root, relativePath);
			fs.mkdirSync(path.dirname(targetFile), { recursive: true });
			fs.copyFileSync(sourceFile, targetFile);
			console.log(`[sanitize] overlay ${overlay}/${toPosix(relativePath)}`);
		}
	}
}

function walkFiles(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkFiles(fullPath));
		} else if (entry.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

function toPosix(filePath) {
	return filePath.split(path.sep).join('/');
}
