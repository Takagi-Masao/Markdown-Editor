import { nextTick } from 'vue';

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
        markdownContent.value =
            markdownContent.value.substring(0, start) + replacement + markdownContent.value.substring(end);
        nextTick(() => {
            ta.focus();
            if (selected.length > 0) {
                ta.setSelectionRange(start, start + replacement.length);
            } else {
                ta.setSelectionRange(start + before.length, start + before.length);
            }
        });
    }

    function insertAtCursor(text) {
        const ta = getTextarea();
        if (!ta) return;
        const start = ta.selectionStart;
        markdownContent.value =
            markdownContent.value.substring(0, start) + text + markdownContent.value.substring(ta.selectionEnd);
        nextTick(() => {
            ta.focus();
            const newPos = start + text.length;
            ta.setSelectionRange(newPos, newPos);
        });
    }

    const insertBold = () => insertAroundSelection('**', '**');
    const insertItalic = () => insertAroundSelection('*', '*');
    const insertCode = () => insertAroundSelection('`', '`');

    return { insertBold, insertItalic, insertCode, insertAtCursor };
}