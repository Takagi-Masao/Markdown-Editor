import { createApp, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { parseMarkdown, renderMathElements } from './render.js';
import { createEditorHelpers, createEditorFeatures } from './editor.js';
import { saveDraft, loadDraft, clearDraft, formatDraftTime } from './draft.js';
import { createOpenHelpers } from './open.js';
import { createSaveHelpers } from './save.js';
import { createPrintHelpers } from './print.js';

const DEFAULT_CONTENT = `# 欢迎使用 Markdown 编辑器

这是一段 **Markdown** 示例，你可以在这里尽情编辑。

## 使用须知
- 导出 pdf 时，关闭浏览器自带的黑色页眉页脚。
- 除非参与开发，需要刷新页面查看效果，否则尽量不要平白无故刷新，并且在刷新前及时保存。
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
        const markdownContent = ref(DEFAULT_CONTENT);
        const textareaRef = ref(null);
        const previewRef = ref(null);
        const fileInput = ref(null);
        const currentFileName = ref(null);
        const mirrorRef = ref(null);
        const lineHighlightRef = ref(null);
        // 自动换行开关（默认关闭；状态持久化）
        let initialWrap = false;
        try { initialWrap = localStorage.getItem('md-editor:wrap') === 'on'; } catch (e) { /* 忽略存储异常 */ }
        const wrapEnabled = ref(initialWrap);

        const { insertBold, insertItalic, insertCode, insertAtCursor } = createEditorHelpers(markdownContent, textareaRef);

        // ---------- 未保存修改标记 ----------
        // 同步监听内容变化：任何途径的修改（打字、粘贴、IME、工具栏插入等）都会
        // 立即置为未保存；加载/保存成功后由 open.js / save.js 显式重置为 false。
        const isDirty = ref(false);
        watch(markdownContent, () => {
            isDirty.value = true;
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
        const { updateCursorPos, onEditorInput, toggleWrap } = editorFeatures;

        // 文件句柄与待执行的打开操作（普通对象容器，供 open.js / save.js 共享）
        const fileHandle = { value: null };
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

        // ---------- 草稿自动保存（防抖 500ms，写入 localStorage） ----------
        let draftTimer = null;
        watch(markdownContent, () => {
            clearTimeout(draftTimer);
            draftTimer = setTimeout(() => {
                saveDraft(markdownContent.value, currentFileName.value);
            }, 500);
        });

        // ---------- 文件打开 / 保存（拆分为独立模块） ----------
        const saveHelpers = createSaveHelpers({
            markdownContent,
            currentFileName,
            isDirty,
            fileHandle,
            onSaveSuccess: () => {
                clearTimeout(draftTimer);
                clearDraft();
            },
        });

        const openHelpers = createOpenHelpers({
            markdownContent,
            currentFileName,
            fileInput,
            isDirty,
            showUnsavedModal,
            fileHandle,
            pendingOpen,
            saveFile: saveHelpers.saveFile,
        });

        const { openFile, handleFileChange, handleUnsavedChoice, setupDragDrop } = openHelpers;
        const { saveFile } = saveHelpers;

        // ---------- 滚动同步（双向，按滚动比例互相映射） ----------
        let syncLock = false;   // 锁：当程序设置 scrollTop 时忽略事件，防止循环

        function setupSyncScroll() {
            const editor = textareaRef.value;
            const preview = previewRef.value;
            if (!editor || !preview) return () => {};

            // 按滚动比例把一侧的位置映射到另一侧
            function syncTo(ratio, target) {
                const max = target.scrollHeight - target.clientHeight;
                syncLock = true;
                target.scrollTop = ratio * Math.max(max, 0);
                syncLock = false;
            }

            // 编辑 → 预览
            function onEditorScroll() {
                if (syncLock) return;
                const maxScrollTop = editor.scrollHeight - editor.clientHeight;
                if (maxScrollTop <= 0) return;
                syncTo(editor.scrollTop / maxScrollTop, preview);
            }

            // 预览 → 编辑
            function onPreviewScroll() {
                if (syncLock) return;
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

        // ---------- 打印 / PDF 导出（独立模块，见 print.js） ----------
        const printHelpers = createPrintHelpers({
            currentFileName,
            previewRef,
            flushPreview: () => {
                clearTimeout(renderTimer);
                renderedHtml.value = parseMarkdown(markdownContent.value);
            },
        });
        const { printSettings, showPrintSettings, openPrintSettings, closePrintSettings, exportPDF } = printHelpers;

        // ---------- 全局键盘快捷键 ----------
        function handleGlobalKeydown(e) {
            // 如果正在输入法组合中，不处理（以免打断中文输入）
            if (e.isComposing) return;

            // Esc：关闭未保存修改弹窗
            if (e.key === 'Escape' && showUnsavedModal.value) {
                showUnsavedModal.value = false;
                pendingOpen.value = null;
                return;
            }

            const isCtrl = e.ctrlKey || e.metaKey;

            // Ctrl + Shift + O ：打开文件
            if (isCtrl && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
                e.preventDefault();
                openFile();
                return;
            }

            // Tab 键：插入两个空格，并阻止焦点转移
            if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                ensureTextareaFocus();
                insertAtCursor('  ');
                return;
            }

            // Ctrl + B / Ctrl + I ：加粗 / 斜体
            if (isCtrl && !e.shiftKey) {
                if (e.key === 'b' || e.key === 'B') {
                    e.preventDefault();
                    ensureTextareaFocus();
                    insertBold();
                    return;
                }
                if (e.key === 'i' || e.key === 'I') {
                    e.preventDefault();
                    ensureTextareaFocus();
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

        // 辅助：如果当前焦点不在 textarea，则聚焦（保留原有光标位置）
        function ensureTextareaFocus() {
            const ta = textareaRef.value;
            if (!ta) return;
            if (document.activeElement !== ta) {
                ta.focus({ preventScroll: true });
            }
        }

        // ---------- 生命周期 ----------
        onMounted(async () => {
            // 恢复上次未保存的草稿（与默认内容相同则视为无草稿，不打扰）
            const draft = loadDraft();
            if (draft && draft.content && draft.content !== DEFAULT_CONTENT) {
                const savedTime = formatDraftTime(draft.savedAt) || '未知时间';
                if (confirm(`检测到未保存的草稿（保存于 ${savedTime}），是否恢复？`)) {
                    markdownContent.value = draft.content;
                    currentFileName.value = draft.fileName;
                    document.title = draft.fileName ? draft.fileName + ' - Markdown 编辑器' : 'Markdown 编辑器';
                    isDirty.value = true;  // 恢复的内容尚未保存到文件
                }
                // 选择不恢复时保留草稿，避免误触导致内容丢失（下次打开仍可恢复）
            }

            await nextTick();
            renderMathElements(previewRef.value);
            editorFeatures.mount();
            editorFeatures.render();
            cleanupSync = setupSyncScroll();
            cleanupDragDrop = setupDragDrop();
            document.addEventListener('keydown', handleGlobalKeydown);
        });

        onBeforeUnmount(() => {
            clearTimeout(renderTimer);
            clearTimeout(draftTimer);
            editorFeatures.cleanup();
            if (cleanupSync) cleanupSync();
            if (cleanupDragDrop) cleanupDragDrop();
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
            updateCursorPos,
            toggleWrap,
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
        };
    },
});

app.mount('#app');
