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

    function insertAroundSelection(before, after) {
        const ta = getTextarea();
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const selected = markdownContent.value.substring(start, end);
        const replacement = before + selected + after;

        // 保存滚动位置
        const scrollTop = ta.scrollTop;
        const scrollLeft = ta.scrollLeft;

        // 修改内容（就像手动输入一样，只是拼接字符串）
        markdownContent.value =
            markdownContent.value.substring(0, start) +
            replacement +
            markdownContent.value.substring(end);

        nextTick(() => {
            // 避免 focus 引起滚动
            try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }

            if (selected.length > 0) {
                ta.setSelectionRange(start, start + replacement.length);
            } else {
                ta.setSelectionRange(start + before.length, start + before.length);
            }

            // 强制恢复滚动，覆盖浏览器可能的行为
            ta.scrollTop = scrollTop;
            ta.scrollLeft = scrollLeft;
        });
    }

    function insertAtCursor(text) {
        const ta = getTextarea();
        if (!ta) return;
        const start = ta.selectionStart;
        const scrollTop = ta.scrollTop;
        const scrollLeft = ta.scrollLeft;

        markdownContent.value =
            markdownContent.value.substring(0, start) +
            text +
            markdownContent.value.substring(ta.selectionEnd);

        nextTick(() => {
            try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
            const newPos = start + text.length;
            ta.setSelectionRange(newPos, newPos);
            ta.scrollTop = scrollTop;
            ta.scrollLeft = scrollLeft;
        });
    }

    const insertBold = () => insertAroundSelection('**', '**');
    const insertItalic = () => insertAroundSelection('*', '*');
    const insertCode = () => insertAroundSelection('`', '`');

    return { insertBold, insertItalic, insertCode, insertAtCursor };
}
