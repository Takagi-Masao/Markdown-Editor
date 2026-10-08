import assert from 'node:assert/strict';
import { runBrowserSuite } from './browser-helper.mjs';

// One happy-path tour: can the application perform its main jobs?
// Detailed rendering, recovery, print, caret and modal checks live in browser-regression.mjs.
await runBrowserSuite('Browser smoke', async ({ send, evaluate, waitFor, save, pressKey, content, dirty }) => {
    const defaultContent = await evaluate(content);
    assert.ok(defaultContent.length > 0);
    assert.equal(await evaluate(dirty), false);
    await waitFor("!!document.querySelector('.preview-content h1')", 'initial preview');
    console.log('PASS application starts with an editable document and preview');

    const source = '# Smoke document\n\n**bold** <span data-smoke-html>HTML</span>\n\n$x^2$';
    await evaluate(`(async () => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle('smoke.md', { create: true });
        const writable = await handle.createWritable();
        await writable.write(${JSON.stringify(source)}); await writable.close();
        window.showOpenFilePicker = async () => [handle];
        document.querySelector('button[title^="打开 Markdown"]').click();
    })()`);
    await waitFor(`${content} === ${JSON.stringify(source)} && !(${dirty})`, 'open document');
    assert.match(await evaluate('document.title'), /smoke\.md/);
    console.log('PASS toolbar opens a Markdown file');

    await waitFor(`(() => {
        const preview = document.querySelector('.preview-content');
        return preview.querySelector('h1')?.textContent === 'Smoke document'
            && preview.querySelector('strong')?.textContent === 'bold'
            && preview.querySelector('[data-smoke-html]')?.textContent === 'HTML'
            && !!preview.querySelector('.katex');
    })()`, 'representative Markdown, HTML and math preview');
    console.log('PASS representative Markdown, HTML and math render');

    await evaluate(`(() => {
        const ta = document.querySelector('textarea');
        ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    })()`);
    await send('Input.insertText', { text: '\n\nSmoke edit' });
    await waitFor(dirty, 'typing marks document dirty');
    const edited = source + '\n\nSmoke edit';
    assert.equal(await evaluate(content), edited);
    await save();
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('smoke.md')).getFile()).text())()"), edited);
    console.log('PASS typing and saving write the edited document');

    await evaluate(`(() => {
        window.__exportCalls = 0;
        window.print = () => {
            window.__exportCalls++;
            window.dispatchEvent(new Event('beforeprint'));
            window.dispatchEvent(new Event('afterprint'));
        };
        document.querySelector('button[title^="设置打印"]').click();
    })()`);
    await waitFor("!!document.querySelector('dialog[open]')", 'print settings open');
    await evaluate("document.querySelector('#print-header-text').focus()");
    await pressKey('Enter', 'Enter', 13);
    await waitFor("!document.querySelector('dialog[open]')", 'print settings close');
    await evaluate("document.querySelector('button[title^=\"导出 PDF\"]').click()");
    await waitFor('window.__exportCalls === 1', 'export reaches browser print entry');
    console.log('PASS print settings and PDF export entry work');

    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor(`${content} === ${JSON.stringify(defaultContent)} && !(${dirty})`, 'new document');
    assert.equal(await evaluate("document.querySelector('.statusbar .status-item').textContent.trim()"), '未命名');
    assert.deepEqual(await evaluate('window.__alerts'), []);
    console.log('PASS toolbar creates a clean unnamed document with default content');
});
