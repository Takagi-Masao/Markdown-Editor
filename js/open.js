import { loadFileContent } from './editor.js';

export function createOpenHelpers({
    state, fileInput, showUnsavedModal, pendingOpen, saveFile, persist, rememberHandle,
    defaultContent, onNewFile = () => {},
}) {
    let openVersion = 0;
    let inputApproval = null;

    function newOpenRequest() {
        // A new intent supersedes reads, picker results and save confirmations immediately.
        const request = { version: ++openVersion, documentId: state.documentId.value };
        pendingOpen.value = null;
        showUnsavedModal.value = false;
        return request;
    }

    function isCurrent(request) {
        return request.version === openVersion && request.documentId === state.documentId.value;
    }

    function requestOpen(action, request = newOpenRequest()) {
        if (!isCurrent(request)) return;
        if (state.isDirty.value) {
            pendingOpen.value = { action, request };
            showUnsavedModal.value = true;
            return;
        }
        return action(request);
    }

    function openFile() {
        return requestOpen(openFilePicker);
    }

    function newFile() {
        return requestOpen(() => {
            state.replaceDocument({ content: defaultContent, baseline: defaultContent, fileName: null });
            persist();
            return onNewFile();
        });
    }

    async function handleUnsavedChoice(choice) {
        showUnsavedModal.value = false;
        const pending = pendingOpen.value;
        pendingOpen.value = null;
        if (choice === null || !pending || !isCurrent(pending.request)) return;
        if (choice === true) {
            const saved = await saveFile();
            if (!saved || state.isDirty.value || !isCurrent(pending.request)) return;
        }
        return pending.action(pending.request);
    }

    async function stageOpen(getFile, request) {
        if (!isCurrent(request)) return;
        const before = state.snapshot();
        try {
            const { file, handle } = await getFile();
            if (!isCurrent(request)) return;
            const text = (await loadFileContent(file)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            if (!isCurrent(request)) return;
            const commit = () => {
                if (!isCurrent(request)) return;
                state.replaceDocument({ content: text, baseline: text, fileName: file.name }, handle);
                persist();
                void rememberHandle(state.documentId.value, handle);
            };
            // Edits made during the picker/read need their own discard decision.
            if (state.markdownContent.value !== before.content) return requestOpen(commit, request);
            commit();
        } catch (err) {
            if (!isCurrent(request) || err.name === 'AbortError') return;
            console.error('无法读取文件:', err);
            alert('文件读取失败，请重试');
        }
    }

    function openFilePicker(request) {
        if (window.showOpenFilePicker) {
            return stageOpen(async () => {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
                });
                return { file: await handle.getFile(), handle };
            }, request);
        }
        inputApproval = { request, content: state.markdownContent.value };
        fileInput.value?.click();
    }

    async function handleFileChange(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        const approved = inputApproval;
        inputApproval = null;
        if (!file) return;
        if (approved && !isCurrent(approved.request)) return;
        const request = approved?.request ?? newOpenRequest();
        const action = request => stageOpen(async () => ({ file, handle: null }), request);
        if (approved && approved.content === state.markdownContent.value) return action(request);
        return requestOpen(action, request);
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
            return requestOpen(request => stageOpen(async () => ({ file, handle: null }), request));
        }
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', onDrop);
        };
    }

    return { newFile, openFile, handleFileChange, handleUnsavedChoice, setupDragDrop };
}
