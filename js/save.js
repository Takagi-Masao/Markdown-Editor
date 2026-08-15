// 文件保存：File System Access API 原地写回 → 原生另存为 → 「提示文件名 + 下载」回退。
export function createSaveHelpers({
    markdownContent,
    currentFileName,
    isDirty,
    fileHandle,     // { value: FileSystemFileHandle | null } 容器
    onSaveSuccess,  // () => void：保存成功后清理草稿等
}) {
    // 保存当前内容。返回 true 表示保存成功；false 表示被取消或失败。
    async function saveFile() {
        const content = markdownContent.value;

        // 方案一：已有可写句柄（File System Access API 打开/保存过）→ 原地写入，无对话框
        if (fileHandle.value) {
            try {
                const writable = await fileHandle.value.createWritable();
                await writable.write(content);
                await writable.close();
                isDirty.value = false;
                onSaveSuccess();
                return true;
            } catch (err) {
                console.error('原地保存失败，改用另存为:', err);
                fileHandle.value = null;
            }
        }

        // 方案二：File System Access API 另存为（浏览器原生"保存"对话框）
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: currentFileName.value || 'untitled.md',
                    types: [{
                        description: 'Markdown 文件',
                        accept: { 'text/markdown': ['.md', '.markdown', '.txt'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(content);
                await writable.close();
                fileHandle.value = handle;
                currentFileName.value = handle.name;
                document.title = handle.name + ' - Markdown 编辑器';
                isDirty.value = false;
                onSaveSuccess();
                return true;
            } catch (err) {
                if (err.name === 'AbortError') return false;  // 用户取消
                console.error('另存为失败:', err);
            }
        }

        // 方案三：回退到原来的「提示文件名 + 下载」方式
        let filename = currentFileName.value;
        if (!filename) {
            // 没有关联文件，则要求用户输入文件名
            filename = prompt('请输入文件名：', 'untitled.md');
            if (!filename) return false;      // 取消输入则放弃保存
            if (!filename.endsWith('.md')) {
                filename += '.md';
            }
            currentFileName.value = filename; // 之后就可以直接保存
        }

        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // 已成功导出，清除本地草稿（继续编辑会自动重新保存）
        isDirty.value = false;
        onSaveSuccess();
        return true;
    }

    return { saveFile };
}
