import { newDocumentId } from './document.js';

const SESSION_KEY = 'markdown-editor:session.v2';
const DRAFT_KEY = 'markdown-editor:draft.v2';
const LEGACY_KEY = 'markdown-editor:draft.v1';

function readRecord(key) {
    try {
        const data = JSON.parse(localStorage.getItem(key));
        if (!data || typeof data.content !== 'string') return null;
        if (key !== LEGACY_KEY && (typeof data.documentId !== 'string' ||
            (data.baseline !== null && typeof data.baseline !== 'string'))) return null;
        return { ...data, fileName: typeof data.fileName === 'string' ? data.fileName : null };
    } catch (err) {
        console.warn('Session read failed:', err);
        return null;
    }
}

// A clean session is not a draft. Keep both so declining recovery can show the baseline.
export function saveSession(snapshot) {
    const { documentId, content, baseline, fileName } = snapshot;
    const record = { documentId, content, baseline, fileName, savedAt: Date.now() };
    try {
        if (baseline === null || content !== baseline) {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(record));
        }
        if (baseline !== null) {
            localStorage.setItem(SESSION_KEY, JSON.stringify({ ...record, content: baseline }));
        } else {
            localStorage.removeItem(SESSION_KEY);
        }
        if (baseline !== null && content === baseline) localStorage.removeItem(DRAFT_KEY);
        localStorage.removeItem(LEGACY_KEY);
        return true;
    } catch (err) {
        console.warn('Session persistence failed:', err);
        return false;
    }
}

export function loadSession() {
    const session = readRecord(SESSION_KEY);
    const draft = readRecord(DRAFT_KEY);
    if (draft) return { session: session?.documentId === draft.documentId ? session : null, draft };
    const legacy = readRecord(LEGACY_KEY);
    if (legacy) {
        return { session, draft: { ...legacy, documentId: newDocumentId(), baseline: null } };
    }
    return { session, draft: null };
}

let databasePromise;
function openDatabase() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (!databasePromise) {
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open('markdown-editor', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('handles');
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Handle database blocked'));
        }).catch(err => {
            databasePromise = null;
            console.warn('Handle storage unavailable:', err);
            return null;
        });
    }
    return databasePromise;
}

export async function storeFileHandle(documentId, handle) {
    try {
        const db = await openDatabase();
        if (!db) return false;
        await new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readwrite');
            const store = tx.objectStore('handles');
            if (handle) store.put(handle, documentId);
            else store.delete(documentId);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        return true;
    } catch (err) {
        console.warn('File handle persistence failed:', err);
        return false;
    }
}

export async function loadFileHandle(documentId) {
    try {
        const db = await openDatabase();
        if (!db) return null;
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('handles', 'readonly');
            const request = tx.objectStore('handles').get(documentId);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('File handle recovery failed:', err);
        return null;
    }
}

export function formatDraftTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
