import { loadFileContent } from './editor.js';

// 文件打开：文件选择器（File System Access API / 隐藏 input 回退）、拖拽打开、
// 以及打开前的未保存修改确认（保存 / 不保存 / 取消）。
export function createOpenHelpers({
    markdownContent,
    currentFileName,
    fileInput,
    isDirty,
    showUnsavedModal,
    fileHandle,     // { value: FileSystemFileHandle | null } 容器
    pendingOpen,    // { value: (() => void) | null } 容器
    saveFile,       // () => Promise<boolean>
}) {
    // 打开入口（工具栏 / Ctrl+Shift+O）：有未保存修改时先弹窗确认
    async function openFile() {
        if (isDirty.value) {
            pendingOpen.value = () => openFilePicker();
            showUnsavedModal.value = true;
            return;
        }
        openFilePicker();
    }

    // 拖拽加载入口：同样先检查未保存修改
    function requestLoadFile(file) {
        if (isDirty.value) {
            pendingOpen.value = () => { loadDroppedFile(file); };
            showUnsavedModal.value = true;
            return;
        }
        loadDroppedFile(file);
    }

    // 未保存修改弹窗按钮：true=保存后继续，false=不保存继续，null=取消
    async function handleUnsavedChoice(choice) {
        showUnsavedModal.value = false;
        const action = pendingOpen.value;
        pendingOpen.value = null;
        if (choice === null || !action) return;   // 取消
        if (choice === true) {
            const saved = await saveFile();
            if (!saved) return;                    // 保存被取消或失败，中止打开
        }
        action();
    }

    async function openFilePicker() {
        // 优先使用 File System Access API（Chrome/Edge）：能拿到文件句柄，之后可原地保存
        if (window.showOpenFilePicker) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{
                        description: 'Markdown 文件',
                        accept: { 'text/markdown': ['.md', '.markdown', '.txt'] },
                    }],
                });
                const file = await handle.getFile();
                await loadDroppedFile(file);
                fileHandle.value = handle;
                // 尽量申请读写权限，以便后续 Ctrl+S 原地保存（被拒绝则保存时走另存为）
                try {
                    if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                        if (handle.requestPermission) await handle.requestPermission({ mode: 'readwrite' });
                    }
                } catch (e) { /* 权限异常忽略，保存时再走另存为 */ }
                return;
            } catch (err) {
                if (err.name === 'AbortError') return;  // 用户取消选择
                console.error('无法读取文件:', err);
                alert('文件读取失败，请重试');
                return;
            }
        }
        // 回退：隐藏的 file input
        fileInput.value?.click();
    }

    // 共享的文件加载逻辑（文件选择 / 拖拽都用它）。
    // 注意：isDirty 必须等 markdownContent 赋值之后再重置，
    // 否则同步监听会把刚加载的内容误判为未保存修改。
    async function loadDroppedFile(file) {
        try {
            let text = await loadFileContent(file);
            text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            markdownContent.value = text;
            currentFileName.value = file.name;
            document.title = file.name + ' - Markdown 编辑器';
            isDirty.value = false;
        } catch (err) {
            console.error('无法读取文件:', err);
            alert('文件读取失败，请重试');
        }
    }

    async function handleFileChange(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        fileHandle.value = null;  // input 方式拿不到句柄
        await loadDroppedFile(file);
        event.target.value = '';
    }

    // 拖拽打开文件
    function setupDragDrop() {
        function preventDefault(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        function onDragOver(e) {
            preventDefault(e);
        }
        function onDrop(e) {
            preventDefault(e);
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            if (!/\.(md|markdown|txt)$/i.test(file.name)) {
                alert('仅支持打开 .md / .markdown / .txt 文件');
                return;
            }
            fileHandle.value = null;  // 拖拽方式拿不到句柄
            requestLoadFile(file);
        }
        // 阻止浏览器直接打开被拖入的文件
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('drop', onDrop);
        };
    }

    return { openFile, requestLoadFile, handleUnsavedChoice, openFilePicker, loadDroppedFile, handleFileChange, setupDragDrop };
}
