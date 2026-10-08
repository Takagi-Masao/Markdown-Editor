import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runBrowserSuite } from './browser-helper.mjs';

await runBrowserSuite('Browser regression', async ({ root, send, evaluate, waitFor, edit, reload, save, pressKey, content, dirty }) => {
    // Regression: Saving/reloading must retain baseline, identity and recovery content.
    const defaultContent = await evaluate(content);
    const defaultTitle = await evaluate('document.title');
    await evaluate(`(async () => {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle('regression.md', { create: true });
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
    assert.match(await evaluate('document.title'), /regression\.md/);
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
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('regression.md')).getFile()).text())()"), '# changed\n');
    assert.equal(await evaluate(content), '# changed\n');
    assert.match(await evaluate('document.title'), /regression\.md/);
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
    await evaluate("sessionStorage.setItem('test:recover', 'no')");
    await reload();
    assert.equal(await evaluate(content), '');
    assert.equal(await evaluate(dirty), false);
    assert.equal(await evaluate('window.__prompts.length'), 1);
    await reload();
    assert.equal(await evaluate('window.__prompts.length'), 1);
    await evaluate("sessionStorage.removeItem('test:recover')");
    await reload();
    assert.equal(await evaluate(content), 'declined draft');
    assert.equal(await evaluate(dirty), true);
    await edit('');
    await reload();
    assert.equal(await evaluate(dirty), false);
    assert.deepEqual(await evaluate('window.__prompts'), []);
    console.log('PASS declined recovery retained / restored draft undo clears recovery');

    // Regression: Raw HTML was escaped globally; Markdown, code and math must still render.
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

    // Regression: Open dialogs and pending preview updates must not corrupt print output.
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
    await waitFor("document.querySelectorAll('dialog[open]').length === 2", 'both modals open');
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    assert.equal(await evaluate("[...document.querySelectorAll('.modal, dialog.modal-dialog')].every(el => getComputedStyle(el).display === 'none')"), true);
    await send('Emulation.setEmulatedMedia', { media: '' });
    assert.equal(await evaluate("[...document.querySelectorAll('dialog.modal-dialog')].every(el => getComputedStyle(el).display !== 'none')"), true);
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
    assert.equal(immediatePrint.title, 'regression.pdf');
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
        title: 'regression.pdf', heading: 'Export latest', math: true, styleCount: 1,
    });
    assert.equal(await evaluate('document.title'), 'regression.pdf');
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), true);
    await evaluate(`(() => {
        document.querySelector('button[title^="导出 PDF"]').click();
        window.dispatchEvent(new Event('afterprint'));
        window.print = window.__realPrint;
    })()`);
    assert.equal(await evaluate('window.__printCalls'), 1);
    assert.equal(await evaluate('document.title'), oldTitle);
    assert.equal(await evaluate("!!document.querySelector('#print-header-footer-style')"), false);
    assert.equal(await evaluate("document.querySelectorAll('dialog[open]').length"), 2);
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
    if (process.env.TEST_ARTIFACT_DIR) {
        const artifactDir = resolve(process.env.TEST_ARTIFACT_DIR);
        await mkdir(artifactDir, { recursive: true });
        await writeFile(join(artifactDir, 'print-regression.pdf'), pdfBytes);
    }
    console.log('PASS real Chrome PDF generation invokes print lifecycle and restores screen state');

    await evaluate(`(() => {
        document.querySelector('.print-settings').closest('.modal').querySelector('button').click();
        [...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '取消').click();
    })()`);
    await waitFor("!document.querySelector('dialog[open]')", 'close existing modals');
    // Regression: The new-file shortcut must reach the app and reset its file association.
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 3, key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 3, key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78 });
    await waitFor("!!document.querySelector('dialog[open]')", 'new file shortcut confirmation');
    await evaluate("[...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '取消').click()");
    assert.equal(await evaluate(content), '# Export latest\n\n$y^2$');
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor("!!document.querySelector('dialog[open]')", 'new file toolbar confirmation');
    await evaluate("[...document.querySelectorAll('.modal-actions button')].find(el => el.textContent === '保存').click()");
    await waitFor(`${content} === ${JSON.stringify(defaultContent)}`, 'save then new file');
    assert.equal(await evaluate('document.title'), defaultTitle);
    assert.equal(await evaluate(dirty), false);
    assert.equal(await evaluate("document.activeElement === document.querySelector('textarea') && document.querySelector('textarea').selectionStart === 0"), true);
    assert.equal(await evaluate("document.querySelector('.statusbar .status-item').textContent.trim()"), '未命名');
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('regression.md')).getFile()).text())()"), '# Export latest\n\n$y^2$');
    await reload();
    assert.equal(await evaluate(content), defaultContent);
    assert.equal(await evaluate('document.title'), defaultTitle);
    assert.equal(await evaluate(dirty), false);
    assert.deepEqual(await evaluate('window.__prompts'), []);
    console.log('PASS Ctrl+Alt+N / toolbar new, cancel, save-before-new and reload');

    await edit('discard this draft');
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor("!!document.querySelector('dialog[open]')", 'discard-before-new confirmation');
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
    assert.equal(await evaluate("(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('regression.md')).getFile()).text())()"), '# Export latest\n\n$y^2$');
    await evaluate("document.querySelector('button[title^=\"新建 Markdown\"]').click()");
    await waitFor(`${content} === ${JSON.stringify(defaultContent)}`, 'new after saving separate file');
    console.log('PASS discard-before-new, detached file association, separate save target');

    // Regression: CRLF input previously shifted formatting and caret offsets.
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

    // ---- 弹窗键盘与无障碍：初始焦点、Tab 圈定、Esc/遮罩关闭、焦点归还 ----
    await evaluate(`(() => {
        const ta = document.querySelector('textarea');
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
    })()`);
    assert.equal(await evaluate("document.querySelector('textarea').getAttribute('aria-label')"), 'Markdown 编辑区');
    await edit('modal edits');
    await waitFor(dirty, 'modal edits dirty');
    await pressKey('O', 'KeyO', 79, 10);
    await waitFor("!!document.querySelector('dialog[open]')", 'unsaved dialog opens via shortcut');
    assert.equal(await evaluate("document.activeElement?.textContent?.trim()"), '取消', 'initial focus on cancel');
    assert.equal(await evaluate("document.activeElement?.closest('dialog[open]')?.getAttribute('aria-labelledby')"), 'unsaved-modal-title');
    for (let i = 0; i < 4; i++) {
        await pressKey('Tab', 'Tab', 9);
        await delay(30);
        assert.equal(await evaluate("!!document.activeElement?.closest('dialog[open]')"), true, `Tab ${i + 1} stays inside dialog`);
    }
    assert.equal(await evaluate(content), 'modal edits', 'background editor untouched while dialog open');
    await pressKey('Escape', 'Escape', 27);
    await waitFor("!document.querySelector('dialog[open]')", 'Esc closes unsaved dialog');
    assert.equal(await evaluate("document.activeElement === document.querySelector('textarea')"), true, 'focus restored to editor');
    assert.equal(await evaluate(dirty), true, 'Esc keeps edits');
    await pressKey('O', 'KeyO', 79, 10);
    await waitFor("!!document.querySelector('dialog[open]')", 'dialog reopens');
    await evaluate("document.querySelector('dialog[open]').click()");
    await waitFor("!document.querySelector('dialog[open]')", 'backdrop click cancels');
    assert.equal(await evaluate("document.activeElement === document.querySelector('textarea')"), true, 'focus restored after backdrop cancel');
    assert.equal(await evaluate(dirty), true, 'cancel keeps dirty state');
    console.log('PASS unsaved dialog initial focus, Tab trap, Esc / backdrop cancel and focus restore');

    // ---- 打印设置弹窗：初始焦点、label 关联、Esc 与回车提交、焦点归还 ----
    const openPrintSettingsDialog = async () => {
        await evaluate(`(() => { const b = document.querySelector('button[title^="设置打印页眉页脚"]'); b.focus(); b.click(); })()`);
        await waitFor("!!document.querySelector('dialog[open]')", 'print settings dialog opens');
    };
    await openPrintSettingsDialog();
    assert.equal(await evaluate("document.activeElement === document.querySelector('#print-settings-form input[type=checkbox]')"), true, 'initial focus on first checkbox');
    assert.equal(await evaluate("document.querySelector('#print-header-text').labels.length"), 1, 'header input has label');
    await pressKey('Escape', 'Escape', 27);
    await waitFor("!document.querySelector('dialog[open]')", 'Esc closes print dialog');
    assert.equal(await evaluate("document.activeElement?.textContent?.includes('打印设置')"), true, 'focus restored to print settings button');
    await openPrintSettingsDialog();
    await evaluate("document.querySelector('#print-header-text').focus()");
    await pressKey('Enter', 'Enter', 13);
    await waitFor("!document.querySelector('dialog[open]')", 'Enter submits and closes print dialog');
    assert.equal(await evaluate("document.activeElement?.textContent?.includes('打印设置')"), true, 'focus restored after Enter submit');
    console.log('PASS print settings dialog focus, labels, Esc / Enter close and focus restore');

    // ---- 弹窗叠加：最上层 Esc 只关最上层 ----
    await openPrintSettingsDialog();
    await pressKey('O', 'KeyO', 79, 10);
    await waitFor("document.querySelectorAll('dialog[open]').length === 2", 'unsaved dialog stacks on top');
    await pressKey('Escape', 'Escape', 27);
    await waitFor("document.querySelectorAll('dialog[open]').length === 1", 'Esc closes topmost unsaved dialog');
    assert.equal(await evaluate("document.querySelector('#print-settings-form') !== null"), true, 'print dialog remains');
    await pressKey('Escape', 'Escape', 27);
    await waitFor("!document.querySelector('dialog[open]')", 'second Esc closes print dialog');
    console.log('PASS stacked dialogs: topmost Esc closes only the topmost dialog');

    // ---- 滚动同步：程序写入的回环不得吞掉用户滚轮位移 ----
    await evaluate(`(() => {
        const ta = document.querySelector('textarea');
        const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
        ta.value = '\\n\\n'.repeat(600) + fence + '\\n' + Array.from({ length: 400 }, (_, i) => 'line ' + i).join('\\n') + '\\n' + fence;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(800);
    const editorPane = await evaluate(`(() => {
        const r = document.querySelector('.editor-pane').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: editorPane.x, y: editorPane.y });
    const wheelDeltas = async (ticks, deltaY) => {
        const start = await evaluate("document.querySelector('textarea').scrollTop");
        const tops = [];
        for (let i = 0; i < ticks; i++) {
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: editorPane.x, y: editorPane.y, deltaX: 0, deltaY });
            await delay(120);
            tops.push(await evaluate("document.querySelector('textarea').scrollTop"));
        }
        return [tops[0] - start, ...tops.slice(1).map((value, index) => value - tops[index])];
    };
    // 预览滚动范围远小于编辑区时（代码块被折叠为 400px），回环曾把每格 120px 吞成 ~109px。
    await evaluate(`(() => { document.querySelector('textarea').scrollTop = 10000; })()`);
    await delay(200);
    for (const delta of await wheelDeltas(6, 120)) {
        assert.ok(Math.abs(delta - 120) < 5, `wheel tick moves full distance, got ${delta}`);
    }
    // 靠近底部：每格仍完整移动，到达端点后停止。
    await evaluate(`(() => { const ta = document.querySelector('textarea'); ta.scrollTop = ta.scrollHeight - ta.clientHeight - 600; })()`);
    await delay(200);
    const bottomDeltas = await wheelDeltas(7, 120);
    assert.deepEqual(bottomDeltas.slice(0, 5).map(delta => Math.round(delta)), [120, 120, 120, 120, 120]);
    assert.equal(bottomDeltas[5], 0);
    assert.equal(bottomDeltas[6], 0);
    console.log('PASS scroll sync echo suppression keeps full wheel ticks near the edges');

});
