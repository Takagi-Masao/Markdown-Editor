export function applyHighlight(previewEl) {
    if (!previewEl || !window.hljs) return;
    const codeBlocks = previewEl.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
        if (!block.dataset.highlighted) {
            try {
                window.hljs.highlightElement(block);
                block.dataset.highlighted = 'true';
            } catch (e) { console.warn('代码高亮失败:', e); }
        }
    });
}

export function renderMathElements(previewEl) {
    if (!previewEl || !window.katex) return;
    const inlines = previewEl.querySelectorAll('.math.inline');
    inlines.forEach((el) => {
        if (el.querySelector('.katex')) return;
        try {
            window.katex.render(el.textContent, el, { throwOnError: false, displayMode: false });
        } catch (e) { console.warn('公式渲染失败:', el.textContent, e); }
    });
    const blocks = previewEl.querySelectorAll('.math.block');
    blocks.forEach((el) => {
        if (el.querySelector('.katex')) return;
        try {
            window.katex.render(el.textContent, el, { throwOnError: false, displayMode: true });
        } catch (e) { console.warn('公式渲染失败:', el.textContent, e); }
    });
}
