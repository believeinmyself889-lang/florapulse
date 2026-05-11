import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const resultDir = join(rootDir, 'benchmarks', 'results');
const durationMs = Number.parseInt(process.env.FLORAPULSE_BENCHMARK_MS || '5000', 10);
const viewport = process.env.FLORAPULSE_VIEWPORT || '1440,900';
const debugPort = Number.parseInt(process.env.FLORAPULSE_DEBUG_PORT || '9333', 10);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser'
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            execFileSync(candidate, ['--version'], { stdio: 'ignore' });
            return candidate;
        } catch {
            // Try the next candidate.
        }
    }
    throw new Error('Chrome or Chromium was not found. Set CHROME_PATH to a browser executable.');
}

function createStaticServer() {
    return createServer((request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
        const filePath = normalize(join(rootDir, requested));

        if (!filePath.startsWith(rootDir)) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }

        const stream = createReadStream(filePath);
        stream.on('open', () => {
            response.writeHead(200, {
                'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            stream.pipe(response);
        });
        stream.on('error', () => {
            response.writeHead(404);
            response.end('Not found');
        });
    });
}

function listen(server) {
    return new Promise((resolveListen) => {
        server.listen(0, '127.0.0.1', () => resolveListen(server.address().port));
    });
}

async function wait(ms) {
    return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function fetchJson(url, attempts = 50) {
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
        try {
            const response = await fetch(url);
            if (response.ok) return response.json();
        } catch (error) {
            lastError = error;
        }
        await wait(100);
    }
    throw lastError || new Error(`Failed to fetch ${url}`);
}

async function connectCdp(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener('open', resolveOpen, { once: true });
        socket.addEventListener('error', rejectOpen, { once: true });
    });

    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (!message.id || !pending.has(message.id)) return;
        const { resolveMessage, rejectMessage } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejectMessage(new Error(message.error.message));
        else resolveMessage(message.result);
    });

    return {
        send(method, params = {}) {
            id += 1;
            socket.send(JSON.stringify({ id, method, params }));
            return new Promise((resolveMessage, rejectMessage) => {
                pending.set(id, { resolveMessage, rejectMessage });
            });
        },
        close() {
            socket.close();
        }
    };
}

async function waitForBenchmarkReady(cdp) {
    for (let i = 0; i < 80; i += 1) {
        const result = await cdp.send('Runtime.evaluate', {
            expression: 'Boolean(window.FloraPulseBenchmark && window.FloraPulseBenchmark.isReady())',
            returnByValue: true
        });
        if (result.result.value) return;
        await wait(125);
    }
    throw new Error('FloraPulse benchmark API did not become ready.');
}

function gitValue(args) {
    try {
        return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

async function main() {
    await mkdir(resultDir, { recursive: true });
    const server = createStaticServer();
    const port = await listen(server);
    const chromePath = findChrome();
    const profileDir = join(tmpdir(), `florapulse-benchmark-${Date.now()}`);
    const url = `http://127.0.0.1:${port}/index.html?demo=1&benchmark=1`;

    const chrome = spawn(chromePath, [
        '--headless=new',
        '--use-gl=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        `--window-size=${viewport}`,
        url
    ], { stdio: 'ignore' });

    let cdp;
    try {
        const tabs = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
        const page = tabs.find((entry) => entry.type === 'page' && entry.url.includes('/index.html'));
        if (!page) throw new Error('Could not locate benchmark page in Chrome targets.');

        cdp = await connectCdp(page.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        await waitForBenchmarkReady(cdp);
        await wait(durationMs);

        const evaluated = await cdp.send('Runtime.evaluate', {
            expression: 'JSON.stringify(window.FloraPulseBenchmark.getMetrics())',
            returnByValue: true
        });
        const metrics = JSON.parse(evaluated.result.value);
        const result = {
            timestamp: new Date().toISOString(),
            url,
            durationMs,
            git: {
                branch: gitValue(['branch', '--show-current']),
                commit: gitValue(['rev-parse', '--short', 'HEAD'])
            },
            environment: {
                chromePath,
                viewport,
                node: process.version,
                platform: process.platform
            },
            metrics
        };

        const latestPath = join(resultDir, 'latest.json');
        await writeFile(latestPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify(result, null, 2));
    } finally {
        cdp?.close();
        chrome.kill();
        server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
