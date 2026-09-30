import { createApp, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { parseMarkdown, renderMathElements } from './render.js';
import { createEditorHelpers, createEditorFeatures } from './editor.js';
import { saveSession, loadSession, storeFileHandle, loadFileHandle, formatDraftTime } from './draft.js';
import { createDocumentState } from './document.js';
import { createOpenHelpers } from './open.js';
import { createSaveHelpers } from './save.js';
import { createPrintHelpers } from './print.js';

const DEFAULT_CONTENT = `# 欢迎使用 Markdown 编辑器

这是一段 **Markdown** 示例，你可以在这里尽情编辑。

## 使用须知
- 导出 pdf 时，关闭浏览器自带的黑色页眉页脚。
- 用 Edge/Chrome 等浏览器打开，体验最佳。

$$
e^{i \\pi} + 1 = 0
$$

\`\`\`javascript
console.log('Hello, world!');
\`\`\`

> 生活不止眼前的苟且，还有诗和远方。

你可以在[这里](https://help.luogu.com.cn/rules/academic/handbook/latex "LaTeX 格式手册")或者[这里](https://help.luogu.com.cn/rules/academic/handbook/markdown "洛谷 Markdown 格式手册")学习更多关于 Markdown 的知识。
`;

const app = createApp({
    setup() {
        const state = createDocumentState(DEFAULT_CONTENT, { ref, computed });
        const { markdownContent, currentFileName, isDirty, fileHandle } = state;
        const textareaRef = ref(null);
        const previewRef = ref(null);
        const fileInput = ref(null);
        const mirrorRef = ref(null);
        const lineHighlightRef = ref(null);
        // 自动换行开关（默认关闭；状态持久化）
        let initialWrap = false;
        try { initialWrap = localStorage.getItem('md-editor:wrap') === 'on'; } catch (e) { /* 忽略存储异常 */ }
        const wrapEnabled = ref(initialWrap);

        const { insertBold, insertItalic, insertCode, insertAtCursor } = createEditorHelpers(markdownContent, textareaRef);

        // Dirty is derived from the saved baseline, so undoing all edits becomes clean.
        watch(markdownContent, () => {
            editorFeatures?.scheduleRender();
        }, { flush: 'sync' });

        // 未保存确认弹窗的显示状态
        const showUnsavedModal = ref(false);

        // ---------- 状态栏 ----------
        const cursorLine = ref(1);
        const cursorCol = ref(1);
        const lineCount = computed(() => markdownContent.value.split('\n').length);
        const charCount = computed(() => markdownContent.value.length);

        // ---------- 编辑器增强（行号镜像、当前行高亮、光标行列、自动换行）----------
        // 实现在 editor.js 的 createEditorFeatures 中，此处仅接线
        const editorFeatures = createEditorFeatures({
            markdownContent,
            textareaRef,
            mirrorRef,
            lineHighlightRef,
            wrapEnabled,
            cursorLine,
            cursorCol,
        });
        const {
            updateCursorPos,
            onEditorInput,
            onEditorCompositionStart,
            onEditorCompositionEnd,
            onEditorCompositionCancel,
            toggleWrap,
        } = editorFeatures;

        // Pending open is separate from the current document association.
        const pendingOpen = { value: null };

        // ---------- 预览渲染（防抖 200ms，避免每次击键都全量解析 + 重渲染） ----------
        // 初始值同步渲染一次；输入停止 200ms 后才刷新预览。
        // 代码高亮已在 marked 解析阶段完成，KaTeX 由下方 watch 在 DOM 更新后渲染。
        const renderedHtml = ref(parseMarkdown(markdownContent.value));
        let renderTimer = null;
        watch(markdownContent, () => {
            clearTimeout(renderTimer);
            renderTimer = setTimeout(() => {
                renderedHtml.value = parseMarkdown(markdownContent.value);
            }, 200);
        });

        // Persist immediately at lifecycle boundaries and debounce ordinary edits.
        let draftTimer = null;
        let restoring = false;
        let preserveDeclinedDraft = false;
        function persist() {
            clearTimeout(draftTimer);
            if (!restoring && !preserveDeclinedDraft) saveSession(state.snapshot());
        }
        function persistAction() {
            preserveDeclinedDraft = false;
            persist();
        }
        watch([markdownContent, currentFileName, state.savedContent, state.documentId], () => {
            if (restoring) return;
            preserveDeclinedDraft = false;
            clearTimeout(draftTimer);
            draftTimer = setTimeout(persist, 500);
        }, { flush: 'sync' });
        watch(currentFileName, name => {
            document.title = name ? name + ' - Markdown 编辑器' : 'Markdown 编辑器';
        }, { immediate: true, flush: 'sync' });
        function onVisibilityChange() {
            if (document.visibilityState === 'hidden') persist();
        }
        function onBeforeUnload(event) {
            persist();
            if (isDirty.value) {
                event.preventDefault();
                event.returnValue = '';
            }
        }

        const saveHelpers = createSaveHelpers({ state, persist: persistAction, rememberHandle: storeFileHandle });
        const openHelpers = createOpenHelpers({
            state, fileInput, showUnsavedModal, pendingOpen,
            defaultContent: DEFAULT_CONTENT,
            saveFile: saveHelpers.saveFile,
            persist: persistAction,
            rememberHandle: storeFileHandle,
            focusEditor: async () => {
                await nextTick();
                const textarea = textareaRef.value;
                if (textarea) {
                    textarea.focus({ preventScroll: true });
                    textarea.setSelectionRange(0, 0);
                    textarea.scrollTop = 0;
                    textarea.scrollLeft = 0;
                }
                if (previewRef.value) previewRef.value.scrollTop = 0;
                updateCursorPos();
            },
        });

        const { newFile, openFile, handleFileChange, handleUnsavedChoice, setupDragDrop } = openHelpers;
        const { saveFile } = saveHelpers;

        // ---------- 滚动同步（双向，按滚动比例互相映射） ----------
        // scroll 事件是异步派发的，短暂置锁挡不住回环：程序写入的滚动会在
        // 下一帧触发对方的 scroll 事件，再把比例（含取整误差/端点钳制）写回
        // 原侧，抵消用户滚轮的部分位移——对方滚动范围越小时越明显（实测每格
        // 120px 被回环抵消成 109px），接近上下端时表现为每格移动距离变小。
        // 因此按「写入值吞掉一次回声」：只消费位置与程序写入值一致的事件。

        function setupSyncScroll() {
            const editor = textareaRef.value;
            const preview = previewRef.value;
            if (!editor || !preview) return () => {};

            let suppressEditorEcho = null;
            let suppressPreviewEcho = null;

            // 按滚动比例把一侧的位置映射到另一侧
            function syncTo(ratio, target) {
                const max = target.scrollHeight - target.clientHeight;
                if (max <= 0) return;
                const value = ratio * max;
                if (target === preview) suppressPreviewEcho = value;
                else suppressEditorEcho = value;
                target.scrollTop = value;
            }

            // 编辑 → 预览
            function onEditorScroll() {
                if (suppressEditorEcho !== null && Math.abs(editor.scrollTop - suppressEditorEcho) < 1) {
                    suppressEditorEcho = null;
                    return;
                }
                suppressEditorEcho = null;
                const maxScrollTop = editor.scrollHeight - editor.clientHeight;
                if (maxScrollTop <= 0) return;
                syncTo(editor.scrollTop / maxScrollTop, preview);
            }

            // 预览 → 编辑
            function onPreviewScroll() {
                if (suppressPreviewEcho !== null && Math.abs(preview.scrollTop - suppressPreviewEcho) < 1) {
                    suppressPreviewEcho = null;
                    return;
                }
                suppressPreviewEcho = null;
                const maxScrollTop = preview.scrollHeight - preview.clientHeight;
                if (maxScrollTop <= 0) return;
                syncTo(preview.scrollTop / maxScrollTop, editor);
            }

            editor.addEventListener('scroll', onEditorScroll, { passive: true });
            preview.addEventListener('scroll', onPreviewScroll, { passive: true });
            return () => {
                editor.removeEventListener('scroll', onEditorScroll);
                preview.removeEventListener('scroll', onPreviewScroll);
            };
        }

        let cleanupSync = null;
        let cleanupDragDrop = null;
        let cleanupPrint = null;

        // ---------- 打印 / PDF 导出（独立模块，见 print.js） ----------
        const printHelpers = createPrintHelpers({
            currentFileName,
            previewRef,
            flushPreview: () => {
                clearTimeout(renderTimer);
                const html = parseMarkdown(markdownContent.value);
                renderedHtml.value = html;
                // Native beforeprint cannot wait for Vue's queued v-html update.
                if (previewRef.value && previewRef.value.innerHTML !== html) {
                    previewRef.value.innerHTML = html;
                }
            },
        });
        const { printSettings, showPrintSettings, openPrintSettings, closePrintSettings, exportPDF } = printHelpers;

        // ---------- 弹窗焦点管理（原生 <dialog>：top layer、背景 inert、Esc 关闭）----------
        // 打开：记住焦点来源，进入弹窗并聚焦初始控件；关闭：同步状态并归还焦点。
        // 允许弹窗叠加（如打印设置之上再弹未保存确认），Esc 原生关闭最上层。
        const unsavedDialogRef = ref(null);
        const printDialogRef = ref(null);
        let unsavedRestoreTarget = null;
        let printRestoreTarget = null;
        // 打开顺序栈：栈顶 = 最上层弹窗（原生 <dialog> 只保证背景 inert，
        // Tab 焦点圈定需要自行实现；Esc 关闭最上层由浏览器原生处理）。
        const dialogStack = [];

        function trapDialogTab(e) {
            if (e.key !== 'Tab' || dialogStack.length === 0) return;
            const dialog = dialogStack[dialogStack.length - 1];
            if (!dialog.open) return;
            const focusables = [...dialog.querySelectorAll(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )].filter(el => el.getClientRects().length > 0);
            if (focusables.length === 0) return;
            const index = focusables.indexOf(document.activeElement);
            let next = index === -1 ? 0 : index + (e.shiftKey ? -1 : 1);
            if (next >= focusables.length) next = 0;
            if (next < 0) next = focusables.length - 1;
            e.preventDefault();
            focusables[next].focus();
        }

        function restoreDialogFocus(target) {
            if (target instanceof HTMLElement && target.isConnected && target !== document.body) {
                target.focus({ preventScroll: true });
            } else {
                const ta = textareaRef.value;
                if (ta) ta.focus({ preventScroll: true });
            }
        }

        function focusDialogInitial(dialog) {
            const el = dialog?.querySelector('[data-autofocus]');
            if (el instanceof HTMLElement) el.focus();
        }

        function dropDialogFromStack(dialog) {
            const index = dialogStack.indexOf(dialog);
            if (index !== -1) dialogStack.splice(index, 1);
        }

        // 状态是唯一事实来源：Esc 经 cancel 事件、表单提交经 submit 事件、
        // 按钮经 handleUnsavedChoice / closePrintSettings 同步状态，再由 watch
        // 关闭弹窗、弹出焦点栈并归还焦点。close 事件异步派发且可能晚于重开，
        // 因此只做残留清理，不反向写状态（避免旧弹窗的 close 误关新弹窗）。
        watch(showUnsavedModal, open => {
            if (open) {
                nextTick(() => {
                    const dialog = unsavedDialogRef.value;
                    if (!dialog) return;
                    unsavedRestoreTarget = document.activeElement;
                    if (!dialog.open) {
                        dialog.showModal();
                        focusDialogInitial(dialog);
                    }
                    if (!dialogStack.includes(dialog)) dialogStack.push(dialog);
                });
            } else {
                const dialog = unsavedDialogRef.value;
                if (dialog?.open) dialog.close();
                dropDialogFromStack(dialog);
                const target = unsavedRestoreTarget;
                unsavedRestoreTarget = null;
                restoreDialogFocus(target);
            }
        });

        watch(showPrintSettings, open => {
            if (open) {
                nextTick(() => {
                    const dialog = printDialogRef.value;
                    if (!dialog) return;
                    printRestoreTarget = document.activeElement;
                    if (!dialog.open) {
                        dialog.showModal();
                        focusDialogInitial(dialog);
                    }
                    if (!dialogStack.includes(dialog)) dialogStack.push(dialog);
                });
            } else {
                const dialog = printDialogRef.value;
                if (dialog?.open) dialog.close();
                dropDialogFromStack(dialog);
                const target = printRestoreTarget;
                printRestoreTarget = null;
                restoreDialogFocus(target);
            }
        });

        // Esc 关闭弹窗：cancel 事件在浏览器关闭弹窗前同步触发，直接走状态路径。
        function onUnsavedDialogCancel() {
            if (showUnsavedModal.value) {
                showUnsavedModal.value = false;
                pendingOpen.value = null;
            }
        }

        // close 事件：只清理焦点栈；若浏览器未触发 cancel 就关闭了当前弹窗
        // （浏览器差异的防御分支），按取消同步状态。
        function onUnsavedDialogClose(event) {
            const dialog = event?.currentTarget;
            dropDialogFromStack(dialog);
            if (!dialog || dialog !== unsavedDialogRef.value) return;
            if (showUnsavedModal.value) {
                showUnsavedModal.value = false;
                pendingOpen.value = null;
            }
        }

        function onPrintSettingsDialogClose(event) {
            const dialog = event?.currentTarget;
            dropDialogFromStack(dialog);
            if (!dialog || dialog !== printDialogRef.value) return;
            if (showPrintSettings.value) showPrintSettings.value = false;
        }

        // ---------- 全局键盘快捷键 ----------
        function handleGlobalKeydown(e) {
            // 如果正在输入法组合中，不处理（以免打断中文输入）
            if (e.isComposing) return;

            // Esc 关闭弹窗由原生 <dialog> 的 cancel/close 事件接管（见下方 watch）。
            // 其余快捷键在弹窗打开时保持可用：背景已 inert、焦点圈定在弹窗内，
            // 打开/新建等流程由 open.js 的请求版本号安全地让新意图取代旧意图。

            const isCtrl = e.ctrlKey || e.metaKey;
            const isEditorTarget = e.target === textareaRef.value;

            // Ctrl+Alt+N avoids the browser-reserved Ctrl+N / Ctrl+Shift+N shortcuts.
            if (isCtrl && e.altKey && !e.shiftKey && (e.code === 'KeyN' || e.key === 'n' || e.key === 'N')) {
                e.preventDefault();
                newFile();
                return;
            }

            // Ctrl + Shift + O ：打开文件
            if (isCtrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
                e.preventDefault();
                openFile();
                return;
            }

            // Tab 键：插入两个空格，并阻止焦点转移
            if (e.key === 'Tab' && !e.shiftKey && isEditorTarget) {
                e.preventDefault();
                insertAtCursor('  ');
                return;
            }

            // Ctrl + B / Ctrl + I ：加粗 / 斜体
            if (isCtrl && !e.shiftKey && isEditorTarget) {
                if (e.key === 'b' || e.key === 'B') {
                    e.preventDefault();
                    insertBold();
                    return;
                }
                if (e.key === 'i' || e.key === 'I') {
                    e.preventDefault();
                    insertItalic();
                    return;
                }
            }

            // Ctrl + S ：保存 Markdown
            if (isCtrl && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                saveFile();
                return;
            }

            // Ctrl + Shift + E ：导出 PDF
            if (isCtrl && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
                e.preventDefault();
                exportPDF();
                return;
            }
        }

        // ---------- 生命周期 ----------
        onMounted(async () => {
            // Restore text synchronously before awaiting handle lookup or mounting listeners.
            restoring = true;
            const { session, draft } = loadSession();
            let restored = session;
            if (draft) {
                const savedTime = formatDraftTime(draft.savedAt) || '未知时间';
                if (confirm(`检测到未保存的草稿（保存于 ${savedTime}），是否恢复？`)) restored = draft;
                else preserveDeclinedDraft = true;
            }
            if (restored) state.replaceDocument(restored);
            restoring = false;
            persist();
            if (restored) {
                const identity = restored.documentId;
                state.handleRecoveryPending = identity;
                void loadFileHandle(identity).then(handle => {
                    if (state.documentId.value === identity && !fileHandle.value) fileHandle.value = handle;
                }).finally(() => {
                    if (state.handleRecoveryPending === identity) state.handleRecoveryPending = null;
                });
            }
            window.addEventListener('pagehide', persist);
            window.addEventListener('beforeunload', onBeforeUnload);
            document.addEventListener('visibilitychange', onVisibilityChange);
            cleanupPrint = printHelpers.setupPrintEvents();

            await nextTick();
            renderMathElements(previewRef.value);
            editorFeatures.mount();
            editorFeatures.render();
            cleanupSync = setupSyncScroll();
            cleanupDragDrop = setupDragDrop();
            document.addEventListener('keydown', trapDialogTab);
            document.addEventListener('keydown', handleGlobalKeydown);
        });

        onBeforeUnmount(() => {
            persist();
            window.removeEventListener('pagehide', persist);
            window.removeEventListener('beforeunload', onBeforeUnload);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            clearTimeout(renderTimer);
            clearTimeout(draftTimer);
            editorFeatures.cleanup();
            if (cleanupSync) cleanupSync();
            if (cleanupDragDrop) cleanupDragDrop();
            if (cleanupPrint) cleanupPrint();
            document.removeEventListener('keydown', trapDialogTab);
            document.removeEventListener('keydown', handleGlobalKeydown);
        });

        // 预览更新后重新渲染公式（代码高亮已在 marked 渲染阶段完成）
        watch(renderedHtml, async () => {
            await nextTick();
            renderMathElements(previewRef.value);
        });

        return {
            markdownContent,
            renderedHtml,
            textareaRef,
            previewRef,
            fileInput,
            currentFileName,
            mirrorRef,
            lineHighlightRef,
            wrapEnabled,
            isDirty,
            showUnsavedModal,
            cursorLine,
            cursorCol,
            lineCount,
            charCount,
            printSettings,
            showPrintSettings,
            onEditorInput,
            onEditorCompositionStart,
            onEditorCompositionEnd,
            onEditorCompositionCancel,
            updateCursorPos,
            toggleWrap,
            newFile,
            openFile,
            handleFileChange,
            handleUnsavedChoice,
            insertBold,
            insertItalic,
            insertCode,
            saveFile,
            openPrintSettings,
            closePrintSettings,
            exportPDF,
            unsavedDialogRef,
            printDialogRef,
            onUnsavedDialogCancel,
            onUnsavedDialogClose,
            onPrintSettingsDialogClose,
        };
    },
});

app.mount('#app');
