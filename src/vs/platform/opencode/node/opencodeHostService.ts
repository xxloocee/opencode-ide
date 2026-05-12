/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname, join } from '../../../base/common/path.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { killTree } from '../../../base/node/processes.js';
import { IEnvironmentService, INativeEnvironmentService } from '../../environment/common/environment.js';
import { ILogService } from '../../log/common/log.js';
import { IOpenCodeHostMainService, OpenCodeDefaultUrl, type IOpenCodeHostLaunch, type IOpenCodeHostState, OpenCodeHostPhase } from '../common/opencodeHost.js';

const OpenCodeManagedHostname = '127.0.0.1';
const OpenCodeManagedStartPort = 4096;
const OpenCodeManagedPortAttempts = 100;

interface IResolvedOpenCodeLaunch {
	readonly command: string;
	readonly url: string;
	readonly hostname: string;
	readonly port: number;
}

interface IOpenCodeHostRegistryEntry {
	readonly ownerId: string;
	readonly windowId: number;
	readonly pid: number | undefined;
	readonly port: number;
	readonly url: string;
	readonly command: string;
	readonly cwd: string | undefined;
	readonly startedAt: number;
}

export class OpenCodeHostMainService extends Disposable implements IOpenCodeHostMainService {
	declare readonly _serviceBrand: undefined;

	private readonly hosts = new Map<number, OpenCodeWindowHost>();
	private readonly ownerId = generateUuid();
	private readonly registry: OpenCodeHostRegistry;
	private orphanSweep: Promise<void> | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
	) {
		super();
		this.registry = new OpenCodeHostRegistry(
			join(this.environmentService.userDataPath, 'opencode', 'hosts.json'),
			this.ownerId,
			this.logService,
		);
	}

	onDidChangeState(windowId: number): Event<IOpenCodeHostState> {
		return this.host(windowId).onDidChangeState;
	}

	async getState(windowId: number): Promise<IOpenCodeHostState> {
		return this.host(windowId).getState();
	}

	async start(windowId: number, input: IOpenCodeHostLaunch): Promise<IOpenCodeHostState> {
		await this.sweepOrphansOnce();
		return this.host(windowId).start(input);
	}

	async stop(windowId: number): Promise<void> {
		await this.host(windowId).stop();
	}

	private host(windowId: number): OpenCodeWindowHost {
		const id = windowId > 0 ? windowId : 0;
		let host = this.hosts.get(id);
		if (!host) {
			host = this._register(new OpenCodeWindowHost(id, this.ownerId, this.registry, this.logService, this.environmentService));
			this.hosts.set(id, host);
		}
		return host;
	}

	private sweepOrphansOnce(): Promise<void> {
		if (!this.orphanSweep) {
			this.orphanSweep = this.registry.sweepOrphans();
		}
		return this.orphanSweep;
	}
}

class OpenCodeWindowHost extends Disposable {

	private readonly _onDidChangeState = this._register(new Emitter<IOpenCodeHostState>());
	readonly onDidChangeState: Event<IOpenCodeHostState> = this._onDidChangeState.event;

	private state: IOpenCodeHostState = { phase: OpenCodeHostPhase.Stopped };
	private proc: cp.ChildProcess | undefined;
	private own = false;
	private stopping = false;

	constructor(
		private readonly windowId: number,
		private readonly ownerId: string,
		private readonly registry: OpenCodeHostRegistry,
		private readonly logService: ILogService,
		private readonly environmentService: INativeEnvironmentService,
	) {
		super();
	}

	async getState(): Promise<IOpenCodeHostState> {
		return this.state;
	}

	async start(input: IOpenCodeHostLaunch): Promise<IOpenCodeHostState> {
		if (this.state.phase === OpenCodeHostPhase.Running || this.state.phase === OpenCodeHostPhase.Starting) {
			return this.state;
		}

		const managed = isDefaultUrl(input.url);
		if ((!managed || !input.command) && await probe(input.url)) {
			const endpoint = new URL(input.url);
			this.own = false;
			this.setState({
				phase: OpenCodeHostPhase.Running,
				url: input.url,
				port: toPort(endpoint),
				owned: false,
				message: `Connected to OpenCode runtime at ${input.url}.`
			});
			return this.state;
		}

		if (!input.command) {
			this.setState({
				phase: OpenCodeHostPhase.Error,
				url: input.url,
				owned: false,
				message: `OpenCode runtime is unavailable at ${input.url}. Configure sessions.openCode.command or start the server manually.`
			});
			return this.state;
		}

		const launch = await this.resolveLaunch(input);
		const configDir = await this.prepareBundledGenerativeUiConfigDir(input.uiPackage);
		this.stopping = false;
		this.setState({
			phase: OpenCodeHostPhase.Starting,
			url: launch.url,
			port: launch.port,
			owned: true,
			message: `Starting OpenCode runtime on ${launch.url}...`
		});

		this.logService.info(`[OpenCodeHost:${this.windowId}] Starting command: ${launch.command}${input.cwd ? ` (cwd: ${input.cwd})` : ''}`);
		const proc = cp.spawn(launch.command, {
			cwd: input.cwd,
			env: {
				...process.env,
				VSCODE_WINDOW_ID: String(this.windowId),
				OPENCODE_URL: launch.url,
				OPENCODE_HOSTNAME: launch.hostname,
				OPENCODE_PORT: String(launch.port),
				QUANTCODE_OPENCODE_OWNER: this.ownerId,
				QUANTCODE_OPENCODE_WINDOW_ID: String(this.windowId),
				QUANTCODE_OPENCODE_PARENT_PID: String(process.pid),
				QUANTCODE_OPENCODE_REGISTRY: this.registry.location,
				...(input.uiPackage ? { OPENCODE_UI_PACKAGE: input.uiPackage } : {}),
				...(configDir ? { OPENCODE_CONFIG_DIR: configDir } : {}),
				...(input.uiPackage === 'app-ide' && input.enableGenerativeUiCsp ? { OPENCODE_ENABLE_GENERATIVE_UI_CSP: '1' } : {}),
			},
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
		});
		this.proc = proc;
		this.own = true;

		proc.stdout?.on('data', data => {
			const text = data.toString().trim();
			if (text) {
				this.logService.info(`[OpenCodeHost:${this.windowId}] ${text}`);
			}
		});

		proc.stderr?.on('data', data => {
			const text = data.toString().trim();
			if (text) {
				this.logService.warn(`[OpenCodeHost:${this.windowId}] ${text}`);
			}
		});

		proc.once('exit', (code, signal) => {
			this.proc = undefined;
			if (this.stopping) {
				this.own = false;
				return;
			}
			void this.registry.stop(this.windowId);
			if (this.state.phase === OpenCodeHostPhase.Starting) {
				this.logService.warn(`[OpenCodeHost:${this.windowId}] Launcher process exited while waiting for runtime (${code ?? signal ?? 'unknown'}).`);
				return;
			}
			this.own = false;
			this.setState({
				phase: OpenCodeHostPhase.Error,
				url: launch.url,
				port: launch.port,
				pid: proc.pid,
				owned: true,
				message: `OpenCode runtime exited unexpectedly (${code ?? signal ?? 'unknown'}).`
			});
		});

		await this.registry.upsert({
			ownerId: this.ownerId,
			windowId: this.windowId,
			pid: proc.pid,
			port: launch.port,
			url: launch.url,
			command: launch.command,
			cwd: input.cwd,
			startedAt: Date.now(),
		});

		const ok = await waitForHealthy(launch.url, 20_000);
		if (!ok) {
			this.logService.error(`[OpenCodeHost:${this.windowId}] Timed out waiting for runtime health check`);
			await this.stop();
			this.setState({
				phase: OpenCodeHostPhase.Error,
				url: launch.url,
				port: launch.port,
				pid: proc.pid,
				owned: true,
				message: `OpenCode runtime did not become healthy at ${launch.url}.`
			});
			return this.state;
		}

		this.setState({
			phase: OpenCodeHostPhase.Running,
			url: launch.url,
			port: launch.port,
			pid: proc.pid,
			owned: true,
			message: `OpenCode runtime is running at ${launch.url}.`
		});
		return this.state;
	}

	async stop(): Promise<void> {
		await this.shutdown();
	}

	private async shutdown(): Promise<void> {
		this.stopping = true;
		const proc = this.proc;
		this.proc = undefined;
		if (proc && this.own) {
			await kill(proc.pid, this.logService);
		}
		if (this.own) {
			await this.registry.stop(this.windowId);
		}
		this.own = false;
		this.setState({ phase: OpenCodeHostPhase.Stopped });
	}

	private setState(state: IOpenCodeHostState): void {
		this.state = state;
		this._onDidChangeState.fire(state);
	}

	private async resolveLaunch(input: IOpenCodeHostLaunch): Promise<IResolvedOpenCodeLaunch> {
		const managed = isDefaultUrl(input.url);
		const endpoint = managed
			? new URL(`http://${OpenCodeManagedHostname}:${await findAvailablePort(OpenCodeManagedStartPort, OpenCodeManagedHostname)}`)
			: new URL(input.url);
		const port = toPort(endpoint);
		const hostname = endpoint.hostname;
		const url = `${endpoint.protocol}//${hostname}:${port}`;
		return {
			command: withNetworkArguments(input.command!, hostname, port, url),
			url,
			hostname,
			port,
		};
	}

	private async prepareBundledGenerativeUiConfigDir(uiPackage: string | undefined): Promise<string | undefined> {
		if (uiPackage !== 'app-ide') {
			return undefined;
		}

		const sourceDir = join(this.environmentService.appRoot, 'opencode', 'bundles', 'generative-ui');
		if (!fs.existsSync(join(sourceDir, 'package.json'))) {
			return undefined;
		}

		const targetDir = join(this.environmentService.userDataPath, 'opencode', 'bundles', `generative-ui-window-${this.windowId}`);
		try {
			await fs.promises.rm(targetDir, { recursive: true, force: true });
			await fs.promises.mkdir(dirname(targetDir), { recursive: true });
			await fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true });
			return targetDir;
		} catch (err) {
			this.logService.warn(`[OpenCodeHost:${this.windowId}] Failed to prepare generative UI bundle`, err);
			return undefined;
		}
	}
}

function isDefaultUrl(url: string): boolean {
	return normalizeUrl(url) === normalizeUrl(OpenCodeDefaultUrl);
}

function normalizeUrl(url: string): string {
	const endpoint = new URL(url);
	return `${endpoint.protocol}//${endpoint.hostname}:${toPort(endpoint)}`;
}

function toPort(endpoint: URL): number {
	if (endpoint.port) {
		return Number(endpoint.port);
	}
	return endpoint.protocol === 'https:' ? 443 : 80;
}

function withNetworkArguments(command: string, hostname: string, port: number, url: string): string {
	if (command.includes('{port}') || command.includes('{hostname}') || command.includes('{url}')) {
		return command
			.replaceAll('{port}', String(port))
			.replaceAll('{hostname}', hostname)
			.replaceAll('{url}', url);
	}

	const normalized = command
		.replace(/(^|\s)--hostname(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/g, ' ')
		.replace(/(^|\s)--port(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/g, ' ')
		.trim();
	return `${normalized} --hostname ${hostname} --port ${port}`;
}

async function findAvailablePort(start: number, hostname: string): Promise<number> {
	for (let port = start; port < start + OpenCodeManagedPortAttempts; port++) {
		if (await isPortAvailable(port, hostname)) {
			return port;
		}
	}
	throw new Error(`No available OpenCode port found from ${start} to ${start + OpenCodeManagedPortAttempts - 1}.`);
}

function isPortAvailable(port: number, hostname: string): Promise<boolean> {
	return new Promise(resolve => {
		const server = net.createServer();
		server.once('error', () => {
			resolve(false);
		});
		server.once('listening', () => {
			server.close(() => resolve(true));
		});
		server.listen({ port, host: hostname });
	});
}

class OpenCodeHostRegistry {

	constructor(
		readonly location: string,
		private readonly ownerId: string,
		private readonly logService: ILogService,
	) { }

	async upsert(entry: IOpenCodeHostRegistryEntry): Promise<void> {
		const entries = await this.read();
		await this.write([
			...entries.filter(item => item.ownerId !== entry.ownerId || item.windowId !== entry.windowId),
			entry,
		]);
	}

	async stop(windowId: number): Promise<void> {
		const entries = await this.read();
		const next: IOpenCodeHostRegistryEntry[] = [];
		for (const entry of entries) {
			if (entry.ownerId !== this.ownerId || entry.windowId !== windowId) {
				next.push(entry);
				continue;
			}
			if (!await this.stopEntry(entry)) {
				next.push(entry);
			}
		}
		await this.write(next);
	}

	async sweepOrphans(): Promise<void> {
		const entries = await this.read();
		if (!entries.length) {
			return;
		}

		const next: IOpenCodeHostRegistryEntry[] = [];
		for (const entry of entries) {
			if (entry.ownerId === this.ownerId) {
				next.push(entry);
				continue;
			}
			if (!await this.stopEntry(entry)) {
				next.push(entry);
			}
		}
		await this.write(next);
	}

	private async stopEntry(entry: IOpenCodeHostRegistryEntry): Promise<boolean> {
		let stopped = false;

		if (entry.pid && await isProcessAlive(entry.pid)) {
			await kill(entry.pid, this.logService);
			stopped = true;
		}

		const portProcess = await findManagedOpenCodeProcessByPort(entry.port);
		if (portProcess) {
			await kill(portProcess.pid, this.logService);
			stopped = true;
		}

		if (!stopped && await probe(entry.url)) {
			this.logService.warn(`[OpenCodeHost] Managed runtime registry entry is still healthy but could not be safely matched to a process: ${entry.url}`);
			return false;
		}

		return true;
	}

	private async read(): Promise<IOpenCodeHostRegistryEntry[]> {
		try {
			const raw = await fs.promises.readFile(this.location, 'utf8');
			const value = JSON.parse(raw);
			return Array.isArray(value) ? value.filter(isOpenCodeHostRegistryEntry) : [];
		} catch (err) {
			if (isNotFound(err)) {
				return [];
			}
			this.logService.warn('[OpenCodeHost] Failed to read host registry', err);
			return [];
		}
	}

	private async write(entries: readonly IOpenCodeHostRegistryEntry[]): Promise<void> {
		try {
			await fs.promises.mkdir(dirname(this.location), { recursive: true });
			await fs.promises.writeFile(this.location, JSON.stringify(entries, null, 2), 'utf8');
		} catch (err) {
			this.logService.warn('[OpenCodeHost] Failed to write host registry', err);
		}
	}
}

async function waitForHealthy(url: string, timeout: number): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await probe(url)) {
			return true;
		}
		await new Promise(resolve => setTimeout(resolve, 500));
	}
	return false;
}

async function probe(url: string): Promise<boolean> {
	const endpoint = new URL('/global/health', url);
	const mod = endpoint.protocol === 'https:' ? await import('https') : await import('http');

	return new Promise(resolve => {
		const req = mod.request(endpoint, { method: 'GET' }, res => {
			res.resume();
			resolve(res.statusCode === 200);
		});
		req.on('error', () => resolve(false));
		req.setTimeout(1500, () => {
			req.destroy();
			resolve(false);
		});
		req.end();
	});
}

async function kill(pid: number | undefined, logService: ILogService) {
	if (!pid) {
		return;
	}

	try {
		await killTree(pid, true);
	} catch (err) {
		logService.warn('[OpenCodeHost] Failed to kill process tree', err);
	}
}

function isOpenCodeHostRegistryEntry(value: unknown): value is IOpenCodeHostRegistryEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const entry = value as Partial<IOpenCodeHostRegistryEntry>;
	return typeof entry.ownerId === 'string'
		&& typeof entry.windowId === 'number'
		&& (entry.pid === undefined || typeof entry.pid === 'number')
		&& typeof entry.port === 'number'
		&& typeof entry.url === 'string'
		&& typeof entry.command === 'string'
		&& (entry.cwd === undefined || typeof entry.cwd === 'string')
		&& typeof entry.startedAt === 'number';
}

function isNotFound(err: unknown): boolean {
	return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}

function isProcessAlive(pid: number): Promise<boolean> {
	return new Promise(resolve => {
		try {
			process.kill(pid, 0);
			resolve(true);
		} catch (err) {
			resolve(typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'EPERM');
		}
	});
}

interface IOpenCodeProcessByPort {
	readonly pid: number;
	readonly commandLine: string;
}

async function findManagedOpenCodeProcessByPort(port: number): Promise<IOpenCodeProcessByPort | undefined> {
	const processInfo = process.platform === 'win32'
		? await findWindowsProcessByPort(port)
		: await findPosixProcessByPort(port);
	if (!processInfo || !isManagedOpenCodeCommand(processInfo.commandLine, port)) {
		return undefined;
	}
	return processInfo;
}

async function findWindowsProcessByPort(port: number): Promise<IOpenCodeProcessByPort | undefined> {
	const script = [
		`$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
		'if ($c) {',
		'  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"',
		'  if ($p) { [Console]::Write("$($p.ProcessId)`t$($p.CommandLine)") }',
		'}',
	].join('; ');
	const output = await execFileOutput('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
	const [pidText, ...commandParts] = output.trim().split('\t');
	const pid = Number(pidText);
	if (!Number.isInteger(pid) || pid <= 0) {
		return undefined;
	}
	return { pid, commandLine: commandParts.join('\t') };
}

async function findPosixProcessByPort(port: number): Promise<IOpenCodeProcessByPort | undefined> {
	const pidOutput = await execFileOutput('sh', ['-c', `command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:${port} -sTCP:LISTEN -Fp | sed -n 's/^p//p' | head -n 1`]);
	const pid = Number(pidOutput.trim());
	if (!Number.isInteger(pid) || pid <= 0) {
		return undefined;
	}
	const commandLine = await execFileOutput('sh', ['-c', `ps -p ${pid} -o command= 2>/dev/null`]);
	return { pid, commandLine: commandLine.trim() };
}

function isManagedOpenCodeCommand(commandLine: string, port: number): boolean {
	const text = commandLine.replaceAll('\\', '/').toLowerCase();
	const hasOpenCodeServe = (text.includes('packages/opencode') || text.includes('opencode'))
		&& (text.includes('src/index.ts serve') || text.includes(' opencode serve') || text.includes(' serve '));
	const hasPort = text.includes(`--port ${port}`) || text.includes(`--port=${port}`);
	return hasOpenCodeServe && hasPort;
}

function execFileOutput(file: string, args: readonly string[]): Promise<string> {
	return new Promise(resolve => {
		cp.execFile(file, [...args], { timeout: 5000, windowsHide: true }, (err, stdout) => {
			if (err) {
				resolve('');
				return;
			}
			resolve(String(stdout));
		});
	});
}
