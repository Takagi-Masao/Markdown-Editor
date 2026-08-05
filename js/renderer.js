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

export function bindSyncScroll(textarea, preview) {
    if (!textarea || !preview) return () => {};

    let onEditorScroll, onPreviewScroll;

    onEditorScroll = () => {
        preview.removeEventListener('scroll', onPreviewScroll);
        const maxScrollTop = textarea.scrollHeight - textarea.clientHeight;
        if (maxScrollTop <= 0) {
            preview.addEventListener('scroll', onPreviewScroll);
            return;
        }
        const ratio = textarea.scrollTop / maxScrollTop;
        const previewMax = preview.scrollHeight - preview.clientHeight;
        preview.scrollTo({
            top: ratio * Math.max(previewMax, 0),
            behavior: 'instant'
        });
        preview.addEventListener('scroll', onPreviewScroll);
    };

    onPreviewScroll = () => {
        textarea.removeEventListener('scroll', onEditorScroll);
        const maxScrollTop = preview.scrollHeight - preview.clientHeight;
        if (maxScrollTop <= 0) {
            textarea.addEventListener('scroll', onEditorScroll);
            return;
        }
        const ratio = preview.scrollTop / maxScrollTop;
        const editorMax = textarea.scrollHeight - textarea.clientHeight;
        textarea.scrollTo({
            top: ratio * Math.max(editorMax, 0),
            behavior: 'instant'
        });
        textarea.addEventListener('scroll', onEditorScroll);
    };

    textarea.addEventListener('scroll', onEditorScroll);
    preview.addEventListener('scroll', onPreviewScroll);

    return () => {
        textarea.removeEventListener('scroll', onEditorScroll);
        preview.removeEventListener('scroll', onPreviewScroll);
    };
}