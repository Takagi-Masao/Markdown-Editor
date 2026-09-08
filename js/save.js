// Single-flight saves write one immutable snapshot. Typing remains enabled while saving.
export function createSaveHelpers({ state, persist, rememberHandle }) {
    let activeSave = null;

    function saveFile() {
        if (activeSave) return activeSave;
        if (state.handleRecoveryPending === state.documentId.value) {
            alert('正在恢复文件关联，请稍后再次点击保存。');
            return Promise.resolve(false);
        }
        const snapshot = state.snapshot();
        persist(); // Keep recovery content even if a file watcher reloads during close().
        activeSave = performSave(snapshot).finally(() => { activeSave = null; });
        return activeSave;
    }

    async function writeSnapshot(handle, snapshot) {
        let writable;
        try {
            writable = await handle.createWritable();
            await writable.write(snapshot.content);
            await writable.close();
        } catch (err) {
            try { await writable?.abort?.(); } catch { /* Preserve the original error. */ }
            throw err;
        }
        if (state.commitSave(snapshot, handle, handle.name || snapshot.fileName)) {
            persist();
            await rememberHandle(snapshot.documentId, handle);
        }
        return true;
    }

    async function performSave(snapshot) {
        try {
            let handle = snapshot.handle;
            if (handle) {
                // Restored handles may need permission again. Never request it during startup/open.
                let permission = handle.queryPermission ? await handle.queryPermission({ mode: 'readwrite' }) : 'granted';
                if (permission !== 'granted' && handle.requestPermission) {
                    permission = await handle.requestPermission({ mode: 'readwrite' });
                }
                if (permission !== 'granted') {
                    alert('未获得文件写入权限。内容已保留，请再次点击保存并允许访问。');
                    return false;
                }
                return await writeSnapshot(handle, snapshot);
            }
            if (window.showSaveFilePicker) {
                handle = await window.showSaveFilePicker({
                    suggestedName: snapshot.fileName || 'untitled.md',
                    types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }],
                });
                return await writeSnapshot(handle, snapshot);
            }

            let filename = snapshot.fileName || prompt('请输入文件名：', 'untitled.md');
            if (!filename) return false;
            if (!/\.(md|markdown|txt)$/i.test(filename)) filename += '.md';
            const url = URL.createObjectURL(new Blob([snapshot.content], { type: 'text/markdown' }));
            const anchor = document.createElement('a');
            try {
                anchor.href = url;
                anchor.download = filename;
                document.body.appendChild(anchor);
                anchor.click();
            } finally {
                anchor.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            // Downloads acknowledge export, not confirmed disk I/O. Retain the full session.
            if (state.commitSave(snapshot, null, filename)) persist();
            return true;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('保存失败:', err);
                alert('文件保存失败，内容和文件关联已保留，请重试。');
            }
            return false;
        }
    }

    return { saveFile };
}
