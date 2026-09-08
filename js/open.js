import { loadFileContent } from './editor.js';

export function createOpenHelpers({ state, fileInput, showUnsavedModal, pendingOpen, saveFile, persist, rememberHandle }) {
    let openVersion = 0;
    let inputApproval = null;

    function requestOpen(action) {
        if (state.isDirty.value) {
            pendingOpen.value = action;
            showUnsavedModal.value = true;
            return;
        }
        return action();
    }

    function openFile() {
        return requestOpen(openFilePicker);
    }

    async function handleUnsavedChoice(choice) {
        showUnsavedModal.value = false;
        const action = pendingOpen.value;
        pendingOpen.value = null;
        if (choice === null || !action) return;
        if (choice === true) {
            const identity = state.documentId.value;
            const saved = await saveFile();
            if (!saved || state.isDirty.value || identity !== state.documentId.value) return;
        }
        return action();
    }

    async function stageOpen(getFile) {
        const version = ++openVersion;
        const before = state.snapshot();
        try {
            const { file, handle } = await getFile();
            const text = (await loadFileContent(file)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (version !== openVersion || before.documentId !== state.documentId.value) return;
            const commit = () => {
                if (version !== openVersion || before.documentId !== state.documentId.value) return;
                state.replaceDocument({ content: text, baseline: text, fileName: file.name }, handle);
                persist();
                void rememberHandle(state.documentId.value, handle);
            };
            // Edits made during the picker/read need their own discard decision.
            if (state.markdownContent.value !== before.content) return requestOpen(commit);
            commit();
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('无法读取文件:', err);
            alert('文件读取失败，请重试');
        }
    }

    function openFilePicker() {
        if (window.showOpenFilePicker) {
            return stageOpen(async () => {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
                });
                return { file: await handle.getFile(), handle };
            });
        }
        inputApproval = state.snapshot();
        fileInput.value?.click();
    }

    async function handleFileChange(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        const approved = inputApproval;
        inputApproval = null;
        if (!file) return;
        const action = () => stageOpen(async () => ({ file, handle: null }));
        if (approved?.documentId === state.documentId.value && approved.content === state.markdownContent.value) return action();
        return requestOpen(action);
    }

    function setupDragDrop() {
        function preventDefault(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        function onDrop(e) {
            preventDefault(e);
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            if (!/\.(md|markdown|txt)$/i.test(file.name)) {
                alert('仅支持打开 .md / .markdown / .txt 文件');
                return;
            }
            return requestOpen(() => stageOpen(async () => ({ file, handle: null })));
        }
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', onDrop);
        };
    }

    return { openFile, handleFileChange, handleUnsavedChoice, setupDragDrop };
}
