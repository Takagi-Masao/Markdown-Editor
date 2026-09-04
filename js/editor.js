import { nextTick } from 'vue';

export function loadFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('文件读取失败'));
        reader.readAsText(file, 'UTF-8');
    });
}

export function createEditorHelpers(markdownContent, textareaRef) {
    function getTextarea() {
        return textareaRef.value;
    }

    // 通过 execCommand('insertText') 插入文本：
    // 浏览器会把它当作一次普通输入，从而保留原生 Ctrl+Z / Ctrl+Y 撤销栈。
    // （execCommand 已被标记为废弃，但主流浏览器至今仍支持，且这是唯一
    //   能在 textarea 上不破坏原生撤销历史的做法。）
    function execInsertText(text) {
        const ta = getTextarea();
        if (!ta || typeof document.execCommand !== 'function') return false;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const scrollTop = ta.scrollTop;
        const scrollLeft = ta.scrollLeft;
        try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
        ta.setSelectionRange(start, end);
        const ok = document.execCommand('insertText', false, text);
        ta.scrollTop = scrollTop;
        ta.scrollLeft = scrollLeft;
        return ok;
    }

    // 手动插入（execCommand 不可用时的回退方案；此路径无法保留撤销历史）
    function manualInsert(replacement, from, to) {
        const ta = getTextarea();
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const scrollTop = ta.scrollTop;
        const scrollLeft = ta.scrollLeft;

        markdownContent.value =
            markdownContent.value.substring(0, start) +
            replacement +
            markdownContent.value.substring(end);

        nextTick(() => {
            try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
            ta.setSelectionRange(from, to);
            ta.scrollTop = scrollTop;
            ta.scrollLeft = scrollLeft;
        });
    }

    function insertAroundSelection(before, after) {
        const ta = getTextarea();
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const selected = markdownContent.value.substring(start, end);
        const replacement = before + selected + after;

        if (execInsertText(replacement)) {
            // 成功后把光标/选区放回包裹内容的内部，方便继续输入
            nextTick(() => {
                const ta2 = getTextarea();
                if (!ta2) return;
                if (selected.length > 0) {
                    ta2.setSelectionRange(start + before.length, start + before.length + selected.length);
                } else {
                    const pos = start + before.length;
                    ta2.setSelectionRange(pos, pos);
                }
            });
        } else {
            manualInsert(replacement, start + before.length, start + before.length + selected.length);
        }
    }

    function insertAtCursor(text) {
        const ta = getTextarea();
        if (!ta) return;
        const start = ta.selectionStart;

        if (execInsertText(text)) {
            nextTick(() => {
                const ta2 = getTextarea();
                if (!ta2) return;
                const pos = start + text.length;
                ta2.setSelectionRange(pos, pos);
            });
        } else {
            manualInsert(text, start + text.length, start + text.length);
        }
    }

    const insertBold = () => insertAroundSelection('**', '**');
    const insertItalic = () => insertAroundSelection('*', '*');
    const insertCode = () => insertAroundSelection('`', '`');

    return { insertBold, insertItalic, insertCode, insertAtCursor };
}

// ---------- 编辑器增强：行号镜像、当前行高亮、光标行列、自动换行 ----------
// 行号原理：镜像层与 textarea 同宽、同字体、同内边距，源文本逐行渲染为
// 「行号 span + 透明文本 span」。行号列宽（--gutter）恰好等于 textarea 的
// 左内边距，因此透明文本的起始列与 textarea 完全一致；折行由浏览器引擎
// 按同一规则计算，行号自动落在每个源行的开头左侧。无需逐行测量视觉行数。
// 高亮原理：高亮条为块级元素，位置/高度取镜像流中当前行 .lt 元素的并集盒
// （getBoundingClientRect）——与行号同源，行号正确则高亮必然正确；
// left/right 撑满整行宽，天然覆盖行号列；空行回退用行号 span 的盒子。
export function createEditorFeatures({
    markdownContent,
    textareaRef,
    mirrorRef,
    lineHighlightRef,
    wrapEnabled,
    cursorLine,
    cursorCol,
}) {
    let editorRaf = null;
    let compositionRaf = null;
    let isComposing = false;
    let removeListeners = null;

    // 转义文本（镜像用 innerHTML 构建）
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 根据光标位置计算行列（由 textarea 的 input/keyup/click/select 触发），
    // 并同步当前行高亮。
    function updateCursorPos(event) {
        const ta = textareaRef.value;
        // IME 会在 composition 期间报告临时的 selectionStart；此时读取会把
        // 光标误判到下一行。等 compositionend 后再以最终选区刷新。
        if (!ta || isComposing || event?.isComposing) return;
        const pos = ta.selectionStart;
        // 选区属于 textarea 当前值，不能依赖可能尚未完成同步的 Vue ref。
        const before = ta.value.slice(0, pos);
        cursorLine.value = (before.match(/\n/g) || []).length + 1;
        cursorCol.value = pos - before.lastIndexOf('\n');
        updateLineHighlight();
    }

    // 当前行高亮条：取镜像流中当前行 .lt 元素的并集盒定位——与行号同源；
    // 空行（.lt 无内容）回退用行号 span 的盒子；top 减去 scrollTop 随滚动同步。
    function updateLineHighlight() {
        const mirror = mirrorRef.value;
        const ta = textareaRef.value;
        const hl = lineHighlightRef.value;
        if (!mirror || !ta || !hl) return;
        const idx = cursorLine.value - 1;

        let rect = mirror.querySelectorAll('.lt')[idx]?.getBoundingClientRect();
        if (!rect || !rect.height) {
            rect = mirror.querySelectorAll('.ln')[idx]?.getBoundingClientRect();
        }
        if (!rect || !rect.height) {
            hl.style.display = 'none';
            return;
        }
        const base = mirror.getBoundingClientRect().top;
        hl.style.display = 'block';
        hl.style.top = (rect.top - base - ta.scrollTop) + 'px';
        hl.style.height = rect.height + 'px';
    }

    // 渲染镜像：行号（可见）+ 源文本（透明，仅参与排版）
    function renderMirror() {
        const mirror = mirrorRef.value;
        const ta = textareaRef.value;
        if (!mirror || !ta) return;
        const style = getComputedStyle(ta);
        mirror.style.width = ta.clientWidth + 'px';
        mirror.style.fontFamily = style.fontFamily;
        mirror.style.fontSize = style.fontSize;
        mirror.style.fontWeight = style.fontWeight;
        mirror.style.fontStyle = style.fontStyle;
        mirror.style.lineHeight = style.lineHeight;
        mirror.style.letterSpacing = style.letterSpacing;
        mirror.style.wordSpacing = style.wordSpacing;
        mirror.style.overflowWrap = style.overflowWrap;
        mirror.style.wordBreak = style.wordBreak;
        mirror.style.lineBreak = style.lineBreak;
        mirror.style.tabSize = style.tabSize;
        mirror.style.textIndent = style.textIndent;
        mirror.style.paddingTop = style.paddingTop;
        mirror.style.paddingRight = style.paddingRight;
        mirror.style.paddingBottom = style.paddingBottom;
        mirror.style.paddingLeft = style.paddingLeft;
        // 换行开关决定镜像是否折行（与 textarea 的 wrap 属性保持一致）
        mirror.style.whiteSpace = wrapEnabled.value ? 'pre-wrap' : 'pre';

        const lines = markdownContent.value.split('\n');
        const parts = [];
        for (let i = 0; i < lines.length; i++) {
            parts.push(`<span class="ln">${i + 1}</span><span class="lt">${escapeHtml(lines[i])}</span>`);
            if (i < lines.length - 1) parts.push('\n');
        }
        mirror.innerHTML = parts.join('');
    }

    // 刷新编辑器视图（rAF 合并，内容、换行开关或窗口尺寸变化后调用）
    function refreshEditorView() {
        renderMirror();
        updateCursorPos();
    }
    function scheduleEditorRefresh() {
        if (editorRaf) return;
        editorRaf = requestAnimationFrame(() => {
            editorRaf = null;
            if (!isComposing) refreshEditorView();
        });
    }

    // 输入事件（内容变化）：更新行列 + 重排镜像
    function onEditorInput(event) {
        updateCursorPos(event);
        scheduleEditorRefresh();
    }

    function onEditorCompositionStart() {
        isComposing = true;
    }

    function onEditorCompositionEnd() {
        isComposing = false;
        // compositionend 与 v-model 的最终值同步可能不在同一个任务中，
        // 因此至少让 Vue 完成一次更新后再安排镜像和光标刷新。
        nextTick(() => {
            if (compositionRaf) cancelAnimationFrame(compositionRaf);
            compositionRaf = requestAnimationFrame(() => {
                compositionRaf = null;
                if (!isComposing) refreshEditorView();
            });
        });
    }

    function onEditorCompositionCancel() {
        onEditorCompositionEnd();
    }

    // 切换自动换行（行号与文本流同步，无需重测）
    function toggleWrap() {
        wrapEnabled.value = !wrapEnabled.value;
        try {
            localStorage.setItem('md-editor:wrap', wrapEnabled.value ? 'on' : 'off');
        } catch (e) { /* 忽略存储异常 */ }
        nextTick(refreshEditorView);
    }

    // 挂载监听（组件挂载后调用）：镜像跟随滚动 + 高亮跟随滚动 + 窗口尺寸重排
    function mount() {
        const ta = textareaRef.value;
        const mirror = mirrorRef.value;
        if (!ta || !mirror) return;
        function onScroll() {
            mirror.style.transform = `translateY(${-ta.scrollTop}px)`;
            updateLineHighlight();
        }
        function onResize() {
            scheduleEditorRefresh();
        }
        ta.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        removeListeners = () => {
            ta.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
        };
    }

    function cleanup() {
        if (editorRaf) cancelAnimationFrame(editorRaf);
        if (compositionRaf) cancelAnimationFrame(compositionRaf);
        if (removeListeners) removeListeners();
    }

    return {
        updateCursorPos,
        onEditorInput,
        onEditorCompositionStart,
        onEditorCompositionEnd,
        onEditorCompositionCancel,
        toggleWrap,
        render: refreshEditorView,
        scheduleRender: scheduleEditorRefresh,
        mount,
        cleanup,
    };
}
