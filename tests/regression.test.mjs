import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createDocumentState } from '../js/document.js';
import { createSaveHelpers } from '../js/save.js';
import { saveSession, loadSession, storeFileHandle, loadFileHandle } from '../js/draft.js';

// open.js uses only editor.js's FileReader helper; no framework installation is needed.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'vue') return { url: 'data:text/javascript,export const nextTick = (fn) => Promise.resolve().then(fn);', shortCircuit: true };
        return nextResolve(specifier, context);
    },
});
const { createOpenHelpers } = await import('../js/open.js');
const ref = value => ({ value });
const computed = getter => ({ get value() { return getter(); } });
const fresh = () => createDocumentState('baseline', { ref, computed });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
let alerts, events, storage;
beforeEach(() => {
    alerts = [];
    events = new Map();
    storage = new Map();
    globalThis.localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
    };
    globalThis.window = {
        addEventListener: (name, fn) => events.set(name, fn),
        removeEventListener: name => events.delete(name),
    };
    globalThis.alert = message => alerts.push(message);
    globalThis.prompt = () => 'export';
    globalThis.document = {
        createElement: () => ({ click() {}, remove() {} }),
        body: { appendChild() {} },
    };
    globalThis.FileReader = class {
        readAsText(file) {
            Promise.resolve(file.text).then(text => {
                if (file.fail) this.onerror();
                else { this.result = text; this.onload(); }
            });
        }
    };
});
function saveHelpers(state, overrides = {}) {
    return createSaveHelpers({ state, persist: () => saveSession(state.snapshot()), rememberHandle: async () => true, ...overrides });
}
function handle(name = 'old.md', options = {}) {
    const writes = [];
    const result = {
        name, writes,
        queryPermission: async () => 'granted',
        createWritable: async () => ({ write: async text => writes.push(text), close: async () => {} }),
        ...options,
    };
    return result;
}
function openHelpers(state, overrides = {}) {
    const showUnsavedModal = ref(false);
    const pendingOpen = ref(null);
    return {
        showUnsavedModal, pendingOpen,
        ...createOpenHelpers({ state, fileInput: ref({ click() {} }), showUnsavedModal, pendingOpen,
            saveFile: async () => true, persist: () => saveSession(state.snapshot()), rememberHandle: async () => true,
            ...overrides }),
    };
}
const inputEvent = file => ({ target: { files: [file], value: 'selected' } });
const dropEvent = file => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { files: [file] } });

test('dirty is computed against baseline including undo and empty content', () => {
    const state = fresh();
    assert.equal(state.isDirty.value, false);
    state.markdownContent.value = '';
    assert.equal(state.isDirty.value, true);
    state.markdownContent.value = 'baseline';
    assert.equal(state.isDirty.value, false);
});

test('clean session restores full content, name and identity without a draft', () => {
    const state = fresh();
    state.currentFileName.value = 'hello.md';
    saveSession(state.snapshot());
    const { session, draft } = loadSession();
    assert.equal(draft, null);
    const restored = fresh();
    restored.replaceDocument(session);
    assert.equal(restored.markdownContent.value, 'baseline');
    assert.equal(restored.currentFileName.value, 'hello.md');
    assert.equal(restored.documentId.value, state.documentId.value);
    assert.equal(restored.isDirty.value, false);
});

test('empty dirty draft is retained separately from clean session', () => {
    const state = fresh();
    state.markdownContent.value = '';
    saveSession(state.snapshot());
    const { session, draft } = loadSession();
    assert.equal(session.content, 'baseline');
    assert.equal(draft.content, '');
    const restored = fresh();
    restored.replaceDocument(draft);
    assert.equal(restored.isDirty.value, true);
});

test('legacy empty draft has unknown baseline and is conservatively dirty', () => {
    storage.set('markdown-editor:draft.v1', JSON.stringify({ content: '', fileName: 'legacy.md' }));
    const { draft } = loadSession();
    assert.equal(draft.baseline, null);
    const state = fresh();
    state.replaceDocument(draft);
    assert.equal(state.isDirty.value, true);
    saveSession(state.snapshot());
    assert.equal(storage.has('markdown-editor:draft.v1'), false);
    assert.equal(loadSession().session, null);
});

test('baseline save removes dirty draft but retains recovery session', () => {
    const state = fresh();
    state.markdownContent.value = 'saved';
    saveSession(state.snapshot());
    state.commitSave(state.snapshot(), null, 'saved.md');
    saveSession(state.snapshot());
    assert.equal(loadSession().draft, null);
    assert.equal(loadSession().session.content, 'saved');
});

test('mismatched session is not associated with a different draft identity', () => {
    const state = fresh();
    saveSession(state.snapshot());
    storage.set('markdown-editor:draft.v2', JSON.stringify({ documentId: 'other', content: 'draft', baseline: 'other baseline' }));
    assert.equal(loadSession().session, null);
});

test('corrupt storage and unavailable IDB do not prevent editing', async () => {
    storage.set('markdown-editor:session.v2', 'null');
    storage.set('markdown-editor:draft.v2', JSON.stringify({ content: 4 }));
    assert.deepEqual(loadSession(), { session: null, draft: null });
    assert.equal(await loadFileHandle('missing'), null);
    assert.equal(await storeFileHandle('missing', handle()), false);
});

test('successful in-place save advances baseline and persists title metadata', async () => {
    const state = fresh();
    state.fileHandle.value = handle();
    state.markdownContent.value = 'saved';
    assert.equal(await saveHelpers(state).saveFile(), true);
    assert.deepEqual(state.fileHandle.value.writes, ['saved']);
    assert.equal(state.isDirty.value, false);
    assert.equal(loadSession().session.fileName, 'old.md');
});

test('overlapping saves are serialized/coalesced; later edits remain dirty', async () => {
    const close = deferred();
    const state = fresh();
    let writes = 0;
    state.fileHandle.value = handle('slow.md', { createWritable: async () => ({
        write: async text => { writes++; assert.equal(text, 'snapshot'); }, close: () => close.promise,
    }) });
    state.markdownContent.value = 'snapshot';
    const saver = saveHelpers(state);
    const first = saver.saveFile();
    state.markdownContent.value = 'newer';
    assert.equal(saver.saveFile(), first);
    close.resolve();
    assert.equal(await first, true);
    assert.equal(writes, 1);
    assert.equal(state.savedContent.value, 'snapshot');
    assert.equal(state.isDirty.value, true);
    assert.equal(loadSession().draft.content, 'newer');
    state.markdownContent.value = 'snapshot';
    assert.equal(state.isDirty.value, false);
});

test('completion of old save never relabels or cleans a newly opened document', async () => {
    const close = deferred();
    const state = fresh();
    state.fileHandle.value = handle('old.md', { createWritable: async () => ({ write: async () => {}, close: () => close.promise }) });
    state.markdownContent.value = 'old edits';
    const saving = saveHelpers(state).saveFile();
    const newHandle = handle('new.md');
    state.replaceDocument({ content: 'new', baseline: 'new', fileName: 'new.md' }, newHandle);
    close.resolve();
    await saving;
    assert.equal(state.markdownContent.value, 'new');
    assert.equal(state.savedContent.value, 'new');
    assert.equal(state.fileHandle.value, newHandle);
    assert.equal(state.currentFileName.value, 'new.md');
});

test('permissions are requested on save and denial retains association/content', async () => {
    const state = fresh();
    let requests = 0;
    const original = handle('permission.md', { queryPermission: async () => 'prompt', requestPermission: async () => { requests++; return 'denied'; } });
    state.fileHandle.value = original;
    state.markdownContent.value = 'private';
    assert.equal(await saveHelpers(state).saveFile(), false);
    assert.equal(requests, 1);
    assert.equal(state.fileHandle.value, original);
    assert.equal(state.isDirty.value, true);
    assert.equal(loadSession().draft.content, 'private');
});

test('pending handle restoration requires a fresh save gesture', async () => {
    const state = fresh();
    state.handleRecoveryPending = state.documentId.value;
    window.showSaveFilePicker = () => assert.fail('must not choose a different target');
    assert.equal(await saveHelpers(state).saveFile(), false);
    assert.equal(alerts.length, 1);
});

test('native save-as cancel preserves baseline and association', async () => {
    const state = fresh();
    state.markdownContent.value = 'unsaved';
    window.showSaveFilePicker = async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); };
    assert.equal(await saveHelpers(state).saveFile(), false);
    assert.equal(state.savedContent.value, 'baseline');
    assert.equal(state.fileHandle.value, null);
    assert.equal(loadSession().draft.content, 'unsaved');
});

test('write failure retains original handle, draft, and baseline', async () => {
    const state = fresh();
    const original = handle('failed.md', { createWritable: async () => { throw Object.assign(new Error('failed'), { name: 'AbortError' }); } });
    state.fileHandle.value = original;
    state.markdownContent.value = 'unsaved';
    assert.equal(await saveHelpers(state).saveFile(), false);
    assert.equal(state.fileHandle.value, original);
    assert.equal(state.savedContent.value, 'baseline');
    assert.equal(loadSession().draft.content, 'unsaved');
});

test('download acknowledges export but preserves complete recovery session', async () => {
    const state = fresh();
    state.markdownContent.value = '';
    assert.equal(await saveHelpers(state).saveFile(), true);
    assert.equal(state.currentFileName.value, 'export.md');
    assert.equal(state.isDirty.value, false);
    assert.equal(loadSession().session.content, '');
});

test('canceling dirty drop never clears old file handle', async () => {
    const state = fresh();
    const original = handle();
    state.fileHandle.value = original;
    state.markdownContent.value = 'dirty';
    const opener = openHelpers(state);
    const cleanup = opener.setupDragDrop();
    events.get('drop')(dropEvent({ name: 'new.md', text: 'new' }));
    assert.equal(opener.showUnsavedModal.value, true);
    await opener.handleUnsavedChoice(null);
    assert.equal(state.fileHandle.value, original);
    assert.equal(state.markdownContent.value, 'dirty');
    cleanup();
});

test('read failure retains old document and handle', async () => {
    const state = fresh();
    const original = handle();
    state.fileHandle.value = original;
    window.showOpenFilePicker = async () => [{ getFile: async () => { throw Object.assign(new Error('read failed'), { name: 'AbortError' }); } }];
    await openHelpers(state).openFile();
    assert.equal(state.fileHandle.value, original);
    assert.equal(state.markdownContent.value, 'baseline');
});

test('FileReader failure after obtaining an incoming handle retains old association', async t => {
    t.mock.method(console, 'error', () => {});
    const state = fresh();
    const original = handle('original.md');
    state.fileHandle.value = original;
    const incoming = handle('incoming.md', { getFile: async () => ({ name: 'incoming.md', text: 'unreadable', fail: true }) });
    window.showOpenFilePicker = async () => [incoming];
    await openHelpers(state).openFile();
    assert.equal(state.fileHandle.value, original);
    assert.equal(state.markdownContent.value, 'baseline');
    assert.equal(state.savedContent.value, 'baseline');
    assert.equal(alerts.length, 1);
});

for (const failingStep of ['write', 'close']) {
    test(`${failingStep} failure aborts writable and preserves recovery/baseline`, async t => {
        t.mock.method(console, 'error', () => {});
        const state = fresh();
        let aborted = false;
        const writable = { write: async () => {}, close: async () => {}, abort: async () => { aborted = true; } };
        writable[failingStep] = async () => { throw new Error(`${failingStep} failed`); };
        const original = handle('broken.md', { createWritable: async () => writable });
        state.fileHandle.value = original;
        state.markdownContent.value = 'recover me';
        assert.equal(await saveHelpers(state).saveFile(), false);
        assert.equal(aborted, true);
        assert.equal(state.fileHandle.value, original);
        assert.equal(state.savedContent.value, 'baseline');
        assert.equal(loadSession().draft.content, 'recover me');
    });
}

test('successful save-as keeps newer edits and records the selected name/handle', async () => {
    const picker = deferred();
    const state = fresh();
    state.markdownContent.value = 'save-as snapshot';
    const selected = handle('chosen.md');
    const remembered = [];
    window.showSaveFilePicker = () => picker.promise;
    const saving = saveHelpers(state, { rememberHandle: async (...args) => remembered.push(args) }).saveFile();
    state.markdownContent.value = 'newer edit';
    picker.resolve(selected);
    assert.equal(await saving, true);
    assert.deepEqual(selected.writes, ['save-as snapshot']);
    assert.equal(state.currentFileName.value, 'chosen.md');
    assert.equal(state.fileHandle.value, selected);
    assert.equal(state.isDirty.value, true);
    assert.deepEqual(remembered, [[state.documentId.value, selected]]);
});

test('unavailable localStorage is best effort and does not throw', t => {
    t.mock.method(console, 'warn', () => {});
    localStorage.setItem = () => { throw new Error('quota'); };
    assert.equal(saveSession(fresh().snapshot()), false);
    localStorage.getItem = () => { throw new Error('blocked'); };
    assert.deepEqual(loadSession(), { session: null, draft: null });
});

test('picker opens content and handle together, normalizes newlines, no write permission request', async () => {
    const state = fresh();
    const selected = handle('selected.md', {
        getFile: async () => ({ name: 'selected.md', text: 'a\r\nb\rc' }),
        requestPermission: () => assert.fail('open must not request write permission'),
    });
    window.showOpenFilePicker = async () => [selected];
    await openHelpers(state).openFile();
    assert.equal(state.fileHandle.value, selected);
    assert.equal(state.markdownContent.value, 'a\nb\nc');
    assert.equal(state.isDirty.value, false);
});

test('input discard approval is consumed without a second prompt', async () => {
    const state = fresh();
    state.markdownContent.value = 'dirty';
    const opener = openHelpers(state);
    await opener.openFile();
    await opener.handleUnsavedChoice(false);
    await opener.handleFileChange(inputEvent({ name: 'input.md', text: 'loaded' }));
    assert.equal(opener.showUnsavedModal.value, false);
    assert.equal(state.markdownContent.value, 'loaded');
    assert.equal(state.fileHandle.value, null);
});

test('typing while file is being read requires a new discard confirmation', async () => {
    const content = deferred();
    const state = fresh();
    const opener = openHelpers(state);
    const opening = opener.handleFileChange(inputEvent({ name: 'slow.md', text: content.promise }));
    state.markdownContent.value = 'typed while reading';
    content.resolve('new file');
    await opening;
    assert.equal(opener.showUnsavedModal.value, true);
    await opener.handleUnsavedChoice(null);
    assert.equal(state.markdownContent.value, 'typed while reading');
});

test('save-before-open does not discard edits typed during async save', async () => {
    const saved = deferred();
    const state = fresh();
    state.markdownContent.value = 'dirty';
    const opener = openHelpers(state, { saveFile: () => saved.promise });
    window.showOpenFilePicker = () => assert.fail('newer edits must prevent opening');
    await opener.openFile();
    const choice = opener.handleUnsavedChoice(true);
    state.markdownContent.value = 'newer';
    saved.resolve(true);
    await choice;
    assert.equal(state.markdownContent.value, 'newer');
});
