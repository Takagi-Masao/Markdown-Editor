import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const profile = await mkdtemp(join(tmpdir(), 'markdown-editor-smoke-'));
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
        window.confirm = message => { window.__prompts.push(message); return sessionStorage.getItem('smoke:recover') !== 'no'; };
        window.alert = message => window.__alerts.push(message);
    ` });
    await send('Page.navigate', { url });
    await waitFor("!!document.querySelector('#app')?.__vue_app__ && !!document.querySelector('textarea')", 'initial Vue mount');
    const defaultContent = await evaluate(content);
    const defaultTitle = await evaluate('document.title');
    await evaluate(`(async () => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle('smoke.md', { create: true });
        const writable = await handle.createWritable();
        await writable.write('# baseline\\n'); await writable.close();
        window.showOpenFilePicker = async () => [handle];
        document.querySelector('button[title^="打开 Markdown"]').click();
    })()`);
    await waitFor(`${content} === '# baseline\\n'`, 'open file');
    assert.equal(await evaluate(dirty), false);
    await delay(150);
    await reload();
    assert.equal(await evaluate(content), '# baseline\n');
    assert.deepEqual(await evaluate('window.__prompts'), []);
    assert.equal(await evaluate(dirty), false);
    assert.match(await evaluate('document.title'), /smoke\.md/);
    console.log('PASS unchanged open / refresh restores clean document and title');

    await evaluate("const ta = document.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length)");
    await send('Input.insertText', { text: 'changed' });
    await waitFor(dirty, 'native typing dirty');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    await waitFor(`!(${dirty})`, 'native undo clean');
    assert.equal(await evaluate(content), '# baseline\n');
    console.log('PASS native typing / Ctrl+Z returns to clean baseline');

    await edit('# changed\n');
    await reload();
    assert.equal(await evaluate(content), '# changed\n');
    assert.equal(await evaluate(dirty), true);
    assert.equal(await evaluate('window.__prompts.length'), 1);
    await save();
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('smoke.md')).getFile()).text())()"), '# changed\n');
    assert.equal(await evaluate(content), '# changed\n');
    assert.match(await evaluate('document.title'), /smoke\.md/);
    assert.deepEqual(await evaluate('window.__alerts'), []);
    await reload();
    assert.equal(await evaluate(content), '# changed\n');
    assert.deepEqual(await evaluate('window.__prompts'), []);
    console.log('PASS immediate refresh recovery / persisted handle save / clean reload');

    await edit('');
    await reload();
    assert.equal(await evaluate(content), '');
    assert.equal(await evaluate(dirty), true);
    assert.equal(await evaluate('window.__prompts.length'), 1);
    await save();
    await reload();
    assert.equal(await evaluate(content), '');
    assert.equal(await evaluate(dirty), false);
    assert.deepEqual(await evaluate('window.__prompts'), []);
    console.log('PASS empty draft recovery / empty saved document reload');

    await edit('declined draft');
    await evaluate("sessionStorage.setItem('smoke:recover', 'no')");
    await reload();
    assert.equal(await evaluate(content), '');
    assert.equal(await evaluate(dirty), false);
    assert.equal(await evaluate('window.__prompts.length'), 1);
    await reload();
    assert.equal(await evaluate('window.__prompts.length'), 1);
    await evaluate("sessionStorage.removeItem('smoke:recover')");
    await reload();
    assert.equal(await evaluate(content), 'declined draft');
    assert.equal(await evaluate(dirty), true);
    await edit('');
    await reload();
    assert.equal(await evaluate(dirty), false);
    assert.deepEqual(await evaluate('window.__prompts'), []);
    console.log('PASS declined recovery retained / restored draft undo clears recovery');

    await edit(await readFile(join(root, 'tests/fixtures/rendering.md'), 'utf8'));
    await waitFor("document.querySelector('.preview-content h1')?.textContent === 'Rendering regression'", 'mixed Markdown / HTML rendering');
    const rendered = await evaluate(`(() => {
        const preview = document.querySelector('.preview-content');
        return {
            inlineHtml: preview.querySelector('[data-html-inline] strong')?.textContent,
            inlineStyle: preview.querySelector('[data-html-inline]')?.style.color,
            blockHtml: preview.querySelector('[data-html-block]')?.textContent.trim(),
            details: preview.querySelector('[data-html-details]')?.open,
            nestedMarkdown: preview.querySelector('[data-html-details] strong')?.textContent,
            htmlTable: preview.querySelector('[data-html-table] td')?.colSpan,
            gfmTable: preview.querySelector('table:not([data-html-table]) td strong')?.textContent,
            tasks: [...preview.querySelectorAll('input[type="checkbox"]')].map(el => el.checked),
            nestedList: preview.querySelector('ol li ul li')?.textContent,
            strike: preview.querySelector('del')?.textContent,
            emphasis: preview.querySelector('p > em')?.textContent,
            quote: preview.querySelector('blockquote strong')?.textContent,
            rule: !!preview.querySelector('hr'),
            reference: preview.querySelector('a[title="Reference title"]')?.getAttribute('href'),
            autolink: !!preview.querySelector('a[href="https://example.com/autolink"]'),
            image: preview.querySelector('img')?.getAttribute('src').startsWith('data:image/png;base64,'),
            inlineCode: [...preview.querySelectorAll('p > code')].some(el => el.textContent === '<span data-inline-code>Literal inline</span>'),
            fencedCode: preview.querySelector('pre code.language-html')?.textContent.trim(),
            highlighted: !!preview.querySelector('pre code.language-javascript .hljs-keyword'),
            indentedCode: [...preview.querySelectorAll('pre code')].some(el => el.textContent.trim() === '<div data-indented-code>Literal indented HTML</div>'),
            literalTags: preview.querySelectorAll('[data-inline-code], [data-code-only], [data-indented-code], [data-escaped]').length,
            math: preview.querySelectorAll('.math .katex').length,
        };
    })()`);
    assert.deepEqual(rendered, {
        inlineHtml: 'HTML', inlineStyle: 'rgb(200, 30, 40)', blockHtml: 'Block HTML & entities',
        details: true, nestedMarkdown: 'Markdown inside HTML', htmlTable: 2, gfmTable: 'cell',
        tasks: [true, false], nestedList: 'Nested item', strike: 'deleted', emphasis: 'emphasis',
        quote: 'text', rule: true, reference: 'https://example.com/reference', autolink: true, image: true,
        inlineCode: true, fencedCode: '<div data-code-only>Literal fenced HTML</div>',
        highlighted: true, indentedCode: true, literalTags: 0, math: 2,
    });
    await waitFor("document.querySelector('.preview-content img')?.naturalWidth === 1", 'embedded image decoding');
    await edit('');
    console.log('PASS raw inline / block HTML, mixed Markdown, GFM, data images, literal code and math');

    await evaluate(`(() => {
        document.querySelector('button[title="设置打印页眉页脚"]').click();
    })()`);
    await waitFor("!!document.querySelector('.print-settings')", 'print settings modal');
    await evaluate(`(() => {
        const inputs = document.querySelectorAll('.setting-input');
        for (const [index, text] of ['Regression header', 'Regression footer'].entries()) {
            inputs[index].value = text;
            inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
        }
        const transfer = new DataTransfer();
        transfer.items.add(new File(['incoming'], 'incoming.md', { type: 'text/markdown' }));
        const ta = document.querySelector('textarea');
        ta.value = '# Print baseline';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
    })()`);
    await waitFor("document.querySelectorAll('.modal-overlay').length === 2", 'both modals open');
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    assert.equal(await evaluate("[...document.querySelectorAll('.modal-overlay, .modal')].every(el => getComputedStyle(el).display === 'none')"), true);
    await send('Emulation.setEmulatedMedia', { media: '' });
    assert.equal(await evaluate("[...document.querySelectorAll('.modal-overlay')].every(el => getComputedStyle(el).display !== 'none')"), true);
    const oldTitle = await evaluate('document.title');
    const immediatePrint = await evaluate(`(() => {
        const ta = document.querySelector('textarea');
        ta.value = '# Native latest\\n\\n$x^2$';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        const stale = !document.querySelector('.preview-content').textContent.includes('Native latest');
        window.dispatchEvent(new Event('beforeprint'));
        const firstStyle = document.querySelector('#print-header-footer-style');
        window.dispatchEvent(new Event('beforeprint'));
        return {
            stale,
            latest: document.querySelector('.preview-content h1')?.textContent,
            math: !!document.querySelector('.preview-content .katex'),
            title: document.title,
            style: firstStyle.textContent,
            reusedStyle: firstStyle === document.querySelector('#print-header-footer-style'),
            styleCount: document.querySelectorAll('#print-header-footer-style').length,
        };
    })()`);
    assert.equal(immediatePrint.stale, true);
    assert.equal(immediatePrint.latest, 'Native latest');
    assert.equal(immediatePrint.math, true);
    assert.equal(immediatePrint.title, 'smoke.pdf');
    assert.match(immediatePrint.style, /Regression header/);
    assert.match(immediatePrint.style, /Regression footer/);
    assert.equal(immediatePrint.reusedStyle, true);
    assert.equal(immediatePrint.styleCount, 1);
    await evaluate("window.dispatchEvent(new Event('afterprint'))");
    assert.equal(await evaluate('document.title'), oldTitle);
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), false);
    console.log('PASS native beforeprint synchronously refreshes pending text, math and settings; both modals hidden in print');

    await evaluate(`(() => {
        window.__realPrint = window.print;
        window.__printCalls = 0;
        window.print = () => {
            window.__printCalls++;
            window.dispatchEvent(new Event('beforeprint'));
            window.__printed = {
                title: document.title,
                heading: document.querySelector('.preview-content h1')?.textContent,
                math: !!document.querySelector('.preview-content .katex'),
                styleCount: document.querySelectorAll('#print-header-footer-style').length,
            };
        };
        const ta = document.querySelector('textarea');
        ta.value = '# Export latest\\n\\n$y^2$';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        for (let i = 0; i < 2; i++) document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'E', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
        }));
    })()`);
    await waitFor('window.__printCalls === 1', 'export shortcut');
    assert.deepEqual(await evaluate('window.__printed'), {
        title: 'smoke.pdf', heading: 'Export latest', math: true, styleCount: 1,
    });
    assert.equal(await evaluate('document.title'), 'smoke.pdf');
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), true);
    await evaluate(`(() => {
        document.querySelector('button[title^="导出 PDF"]').click();
        window.dispatchEvent(new Event('afterprint'));
        window.print = window.__realPrint;
    })()`);
    assert.equal(await evaluate('window.__printCalls'), 1);
    assert.equal(await evaluate('document.title'), oldTitle);
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), false);
    assert.equal(await evaluate("document.querySelectorAll('.modal-overlay').length"), 2);
    console.log('PASS export shortcut with open modals, duplicate export guard and delayed afterprint cleanup');

    await evaluate(`(() => {
        window.__nativePrints = 0;
        window.addEventListener('beforeprint', () => {
            window.__nativePrints++;
            window.__pdfPrepared = {
                heading: document.querySelector('.preview-content h1')?.textContent,
                math: !!document.querySelector('.preview-content .katex'),
                style: document.querySelector('#print-header-footer-style')?.textContent,
            };
        });
    })()`);
    const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
    const pdfBytes = Buffer.from(pdf.data, 'base64');
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdfBytes.length > 5000);
    assert.equal(await evaluate('window.__nativePrints'), 1);
    const pdfPrepared = await evaluate('window.__pdfPrepared');
    assert.equal(pdfPrepared.heading, 'Export latest');
    assert.equal(pdfPrepared.math, true);
    assert.match(pdfPrepared.style, /Regression header/);
    assert.match(pdfPrepared.style, /Regression footer/);
    assert.equal(await evaluate('document.title'), oldTitle);
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), false);
    if (process.env.SMOKE_ARTIFACT_DIR) {
        const artifactDir = resolve(process.env.SMOKE_ARTIFACT_DIR);
        await mkdir(artifactDir, { recursive: true });
        await writeFile(join(artifactDir, 'print-regression.pdf'), pdfBytes);
    }
    console.log('PASS real Chrome PDF generation invokes print lifecycle and restores screen state');

    const printFailure = await evaluate(`(async () => {
        const { createPrintHelpers } = await import('./js/print.js');
        const helper = createPrintHelpers({ currentFileName: { value: null }, previewRef: { value: null }, flushPreview() {} });
        window.print = () => { throw new Error('printer unavailable'); };
        try { await helper.exportPDF(); }
        catch (error) { return error.message; }
        finally { window.print = window.__realPrint; }
    })()`);
    assert.equal(printFailure, 'printer unavailable');
    assert.equal(await evaluate('document.title'), oldTitle);
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), false);

    await evaluate(`(() => {
        document.querySelector('.print-settings').closest('.modal').querySelector('button').click();
        [...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '取消').click();
    })()`);
    await waitFor("!document.querySelector('.modal-overlay')", 'close existing modals');
    const reservedShortcuts = await evaluate(`(() => {
        const events = [false, true].map(shiftKey => new KeyboardEvent('keydown', {
            key: 'n', code: 'KeyN', ctrlKey: true, shiftKey, bubbles: true, cancelable: true,
        }));
        events.forEach(event => document.dispatchEvent(event));
        return events.map(event => event.defaultPrevented);
    })()`);
    assert.deepEqual(reservedShortcuts, [false, false]);
    assert.equal(await evaluate("!!document.querySelector('.modal-overlay')"), false);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 3, key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 3, key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78 });
    await waitFor("!!document.querySelector('.modal-overlay')", 'new file shortcut confirmation');
    await evaluate("[...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '取消').click()");
    assert.equal(await evaluate(content), '# Export latest\n\n$y^2$');
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor("!!document.querySelector('.modal-overlay')", 'new file toolbar confirmation');
    await evaluate("[...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '保存').click()");
    await waitFor(`${content} === ${JSON.stringify(defaultContent)}`, 'save then new file');
    assert.equal(await evaluate('document.title'), defaultTitle);
    assert.equal(await evaluate(dirty), false);
    assert.equal(await evaluate("document.activeElement === document.querySelector('textarea') && document.querySelector('textarea').selectionStart === 0"), true);
    assert.equal(await evaluate("document.querySelector('.statusbar .status-item').textContent.trim()"), '未命名');
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('smoke.md')).getFile()).text())()"), '# Export latest\n\n$y^2$');
    await reload();
    assert.equal(await evaluate(content), defaultContent);
    assert.equal(await evaluate('document.title'), defaultTitle);
    assert.equal(await evaluate(dirty), false);
    assert.deepEqual(await evaluate('window.__prompts'), []);
    const newId = await evaluate("JSON.parse(localStorage.getItem('markdown-editor:session.v2')).documentId");
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    assert.notEqual(await evaluate("JSON.parse(localStorage.getItem('markdown-editor:session.v2')).documentId"), newId);
    assert.equal(await evaluate("!!document.querySelector('.modal-overlay')"), false);
    console.log('PASS Ctrl+Alt+N / toolbar new, cancel, save-before-new, clean new and reload');

    await edit('discard this draft');
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor("!!document.querySelector('.modal-overlay')", 'discard-before-new confirmation');
    await evaluate("[...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '不保存').click()");
    await waitFor(`${content} === ${JSON.stringify(defaultContent)}`, 'discard then new file');
    assert.equal(await evaluate(dirty), false);
    assert.equal(await evaluate("localStorage.getItem('markdown-editor:draft.v2')"), null);
    await evaluate(`(() => {
        window.__savePickerCalls = 0;
        window.showSaveFilePicker = async () => {
            window.__savePickerCalls++;
            return (await navigator.storage.getDirectory()).getFileHandle('new-file.md', { create: true });
        };
    })()`);
    await edit('new file content');
    await save();
    assert.equal(await evaluate('window.__savePickerCalls'), 1);
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('new-file.md')).getFile()).text())()"), 'new file content');
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('smoke.md')).getFile()).text())()"), '# Export latest\n\n$y^2$');
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor(`${content} === ${JSON.stringify(defaultContent)}`, 'new after saving separate file');
    await waitFor("document.querySelector('button[title^=\"新建 Markdown\"] img').naturalWidth > 0", 'new file icon');
    if (process.env.SMOKE_ARTIFACT_DIR) {
        for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
            const screenshot = await send('Page.captureScreenshot', { format: 'png' });
            await writeFile(join(resolve(process.env.SMOKE_ARTIFACT_DIR), `new-file-${name}.png`), Buffer.from(screenshot.data, 'base64'));
        }
    }
    console.log('PASS discard-before-new, detached file association, separate save target and toolbar icon');

    const crlfContent = 'first\r\nsecond\r\nthird';
    const normalizedContent = 'first\nsecond\nthird';
    await evaluate(`(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([${JSON.stringify(crlfContent)}], 'crlf.md', { type: 'text/markdown' }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));
    })()`);
    await waitFor(`${content} === ${JSON.stringify(normalizedContent)}`, 'CRLF normalization');
    for (const operation of [
        { key: 'b', code: 'KeyB', keyCode: 66, modifiers: 2, from: 6, to: 12, text: 'first\n**second**\nthird', selection: [8, 14] },
        { key: 'i', code: 'KeyI', keyCode: 73, modifiers: 2, from: 6, to: 12, text: 'first\n*second*\nthird', selection: [7, 13] },
        { key: 'Tab', code: 'Tab', keyCode: 9, modifiers: 0, from: 13, to: 13, text: 'first\nsecond\n  third', selection: [15, 15] },
        { button: '加粗', from: 6, to: 12, text: 'first\n**second**\nthird', selection: [8, 14] },
    ]) {
        await evaluate(`(() => {
            const ta = document.querySelector('textarea');
            ta.focus(); ta.setSelectionRange(${operation.from}, ${operation.to});
        })()`);
        if (operation.button) {
            await evaluate(`(() => {
                const button = document.querySelector('button[title^="${operation.button}"]');
                button.focus(); button.click();
            })()`);
        } else {
            const { modifiers, key, code, keyCode: windowsVirtualKeyCode } = operation;
            await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode });
        }
        await waitFor(`${content} === ${JSON.stringify(operation.text)}`, 'formatting at normalized selection');
        assert.deepEqual(await evaluate("[document.querySelector('textarea').selectionStart, document.querySelector('textarea').selectionEnd]"), operation.selection);
        assert.equal(await evaluate("document.activeElement === document.querySelector('textarea')"), true);
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
        await waitFor(`${content} === ${JSON.stringify(normalizedContent)} && !(${dirty})`, 'formatting undo');
    }
    console.log('PASS CRLF selection positions, Ctrl+B / Ctrl+I / Tab, toolbar focus and native undo');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('Browser smoke tests passed (real IndexedDB and OPFS handles; native OS picker permissions are not automated).');
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
