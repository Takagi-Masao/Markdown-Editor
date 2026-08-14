// 草稿自动保存：把编辑内容写入 localStorage，刷新/重开页面后可恢复。
const DRAFT_KEY = 'markdown-editor:draft.v1';

export function saveDraft(content, fileName = null) {
    try {
        const payload = {
            content,
            fileName,
            savedAt: Date.now(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
    } catch (err) {
        // 存储被禁用或空间不足时静默失败，不影响编辑
        console.warn('草稿保存失败:', err);
    }
}

export function loadDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data.content !== 'string') return null;
        return {
            content: data.content,
            fileName: data.fileName || null,
            savedAt: data.savedAt || 0,
        };
    } catch (err) {
        console.warn('草稿读取失败:', err);
        return null;
    }
}

export function clearDraft() {
    try {
        localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
        console.warn('草稿清除失败:', err);
    }
}

export function formatDraftTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
