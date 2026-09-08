// Document identity stays stable across saves and reloads, not across opens.
export function newDocumentId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDocumentState(initialContent, { ref, computed }) {
    const markdownContent = ref(initialContent);
    const currentFileName = ref(null);
    const documentId = ref(newDocumentId());
    const savedContent = ref(initialContent);
    const fileHandle = { value: null };
    const isDirty = computed(() => savedContent.value === null || markdownContent.value !== savedContent.value);

    function snapshot() {
        return {
            documentId: documentId.value,
            content: markdownContent.value,
            baseline: savedContent.value,
            fileName: currentFileName.value,
            handle: fileHandle.value,
        };
    }

    function replaceDocument(record, handle = null) {
        documentId.value = record.documentId || newDocumentId();
        savedContent.value = record.baseline;
        markdownContent.value = record.content;
        currentFileName.value = record.fileName || null;
        fileHandle.value = handle;
    }

    function commitSave(saved, handle, fileName) {
        if (documentId.value !== saved.documentId) return false;
        savedContent.value = saved.content;
        fileHandle.value = handle;
        currentFileName.value = fileName;
        return true;
    }

    return { markdownContent, currentFileName, documentId, savedContent, fileHandle, isDirty,
        snapshot, replaceDocument, commitSave };
}
