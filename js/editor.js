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
