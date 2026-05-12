import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);

function argValue(name, fallback) {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const outDir = resolve(argValue('--out', join(rootDir, 'paper', 'figures')));
const viewport = argValue('--viewport', '1440,900');
const debugPort = Number.parseInt(argValue('--port', '9344'), 10);
const cases = args
    .filter((arg) => arg.startsWith('--case='))
    .map((arg) => arg.slice('--case='.length))
    .map((value) => {
        const splitAt = value.indexOf('=');
        if (splitAt < 0) return { name: value, path: null };
        return {
            name: value.slice(0, splitAt),
            path: value.slice(splitAt + 1)
        };
    });
const captureCases = cases.length ? cases : [{ name: 'rice', path: null }];

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
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
            // Continue searching.
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

async function waitForReady(cdp) {
    for (let i = 0; i < 120; i += 1) {
        const result = await cdp.send('Runtime.evaluate', {
            expression: 'Boolean(window.FloraPulseBenchmark && window.FloraPulseBenchmark.isReady())',
            returnByValue: true
        });
        if (result.result.value) return;
        await wait(125);
    }
    throw new Error('FloraPulse did not become ready.');
}

async function hideUi(cdp) {
    await cdp.send('Runtime.evaluate', {
        expression: `
            (() => {
                const style = document.createElement('style');
                style.textContent = '.top-nav,.status-line,#video-preview,.overlay{display:none!important} body{background:#101311!important}';
                document.head.appendChild(style);
                return true;
            })()
        `,
        returnByValue: true
    });
}

async function uploadImage(cdp, imagePath) {
    const documentNode = await cdp.send('DOM.getDocument', { depth: 1 });
    const inputNode = await cdp.send('DOM.querySelector', {
        nodeId: documentNode.root.nodeId,
        selector: '#image-upload'
    });
    await cdp.send('DOM.setFileInputFiles', {
        nodeId: inputNode.nodeId,
        files: [resolve(imagePath)]
    });
    await wait(1400);
}

async function captureCase(caseInfo, port, chromePath) {
    const profileDir = join(tmpdir(), `florapulse-capture-${caseInfo.name}-${Date.now()}`);
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
        if (!page) throw new Error('Could not locate capture page in Chrome targets.');

        cdp = await connectCdp(page.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await cdp.send('DOM.enable');
        await cdp.send('Runtime.enable');
        await waitForReady(cdp);
        if (caseInfo.path) await uploadImage(cdp, caseInfo.path);
        await hideUi(cdp);
        await wait(500);

        const screenshot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false
        });
        const outputPath = join(outDir, `result-${caseInfo.name}.png`);
        await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
        console.log(outputPath);
    } finally {
        cdp?.close();
        chrome.kill();
        await wait(250);
    }
}

async function main() {
    await mkdir(outDir, { recursive: true });
    const server = await createStaticServer();
    const port = await listen(server);
    const chromePath = findChrome();
    try {
        for (const caseInfo of captureCases) {
            await captureCase(caseInfo, port, chromePath);
        }
    } finally {
        server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
