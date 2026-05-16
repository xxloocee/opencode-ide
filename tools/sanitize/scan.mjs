import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const targets = ['product.json', 'package.json', 'src/vs/workbench/workbench.common.main.ts', 'src/vs/workbench/workbench.desktop.main.ts'];

for (const rel of targets) {
	const file = path.join(root, rel);
	const text = fs.readFileSync(file, 'utf8');
	const matches = text.match(/copilot|chat|authentication|telemetry/gi) || [];
	console.log(`${rel}: ${matches.length}`);
}
