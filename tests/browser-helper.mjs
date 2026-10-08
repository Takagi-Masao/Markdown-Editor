import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Each suite gets an isolated profile; only browser plumbing is shared.
export async function runBrowserSuite(name, run) {
    const profile = await mkdtemp(join(tmpdir(), `markdown-editor-${name.toLowerCase().replaceAll(" ", "-")}-`));
    const browserPath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const server = createServer(async (req, res) => {
        try {
            const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
            if (!path.startsWith(root + sep)) throw new Error('Outside workspace');
            const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
            res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
            res.end(await readFile(path));
        } catch {
            res.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const browser = spawn(browserPath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
    let socket;
    let sequence = 0;
    const requests = new Map();
    const errors = [];
    async function until(check, message, timeout = 20000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            if (await check()) return;
            await delay(50);
        }
        throw new Error(`Timed out: ${message}`);
    }
    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            requests.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    }
    async function waitFor(expression, label) {
        await until(async () => {
            try { return await evaluate(expression); }
            catch (error) {
                if (/Execution context was destroyed|Cannot find context|Inspected target navigated or closed/.test(error.message)) return false;
                throw error;
            }
        }, label);
    }
    async function edit(text) {
        await evaluate(`(() => { const ta = document.querySelector('textarea'); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }
    const dirty = "!!document.querySelector('.status-dirty')";
    const content = "document.querySelector('textarea')?.value";
    async function reload() {
        await evaluate('window.__reloading = true');
        await send('Page.reload');
        await waitFor("!window.__reloading && !!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('textarea')", 'Vue mount');
        await delay(150);
    }
    async function save() {
        await evaluate("document.querySelector('button[title^=\"保存 Markdown\"]').click()");
        await waitFor(`!(${dirty})`, 'save completion');
    }
    try {
        let port;
        await until(async () => {
            try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return !!port; }
            catch { return false; }
        }, 'Chrome debugging port');
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const request = requests.get(message.id);
                requests.delete(message.id);
                if (message.error) request?.reject(new Error(message.error.message));
                else request?.resolve(message.result);
            } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
            else if (message.method === 'Page.javascriptDialogOpening') {
                void send('Page.handleJavaScriptDialog', { accept: true }).catch(error => {
                    if (!/Inspected target navigated or closed|No dialog is showing/.test(error.message)) errors.push(error.message);
                });
            }
        };
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Page.addScriptToEvaluateOnNewDocument', { source: `
            window.__prompts = [];
            window.__alerts = [];
            window.confirm = message => { window.__prompts.push(message); return sessionStorage.getItem('test:recover') !== 'no'; };
            window.alert = message => window.__alerts.push(message);
        ` });
        await send('Page.navigate', { url });
        await waitFor("!!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('textarea')", 'initial Vue mount');
        const pressKey = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
            await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode });
        };
        await run({ root, send, evaluate, waitFor, edit, reload, save, pressKey, content, dirty });
        assert.deepEqual(errors, [], 'No uncaught browser errors');
        console.log(`${name} tests passed.`);
    } finally {
        if (socket?.readyState === WebSocket.OPEN) {
            try { await send('Browser.close'); } catch { /* Browser may close before responding. */ }
            socket.close();
        }
        browser.kill();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await delay(300);
        await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}
