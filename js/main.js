import { createApp, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { parseMarkdown, renderMathElements } from './renderer.js';
import { createEditorHelpers, loadFileContent } from './editor.js';
import { saveDraft, loadDraft, clearDraft, formatDraftTime } from './draft.js';

const DEFAULT_CONTENT = `# 欢迎使用 Markdown 编辑器

这是一段 **Markdown** 示例，你可以在这里尽情编辑。

## 功能特性
- 实时预览
- 工具栏支持
- 导出 PDF（点击右上角按钮）

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

        const { insertBold, insertItalic, insertCode, insertAtCursor } = createEditorHelpers(markdownContent, textareaRef);

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

        // ---------- 滚动同步（编辑器驱动预览，且自动防止循环） ----------
        let syncLock = false;   // 锁：当程序设置 preview.scrollTop 时忽略事件

        function setupSyncScroll() {
            const editor = textareaRef.value;
            const preview = previewRef.value;
            if (!editor || !preview) return () => {};

            function onEditorScroll() {
                if (syncLock) return;
                const maxScrollTop = editor.scrollHeight - editor.clientHeight;
                if (maxScrollTop <= 0) return;
                const ratio = editor.scrollTop / maxScrollTop;
                const previewMax = preview.scrollHeight - preview.clientHeight;
                syncLock = true;
                preview.scrollTop = ratio * Math.max(previewMax, 0);
                syncLock = false;
            }

            editor.addEventListener('scroll', onEditorScroll, { passive: true });
            return () => editor.removeEventListener('scroll', onEditorScroll);
        }

        let cleanupSync = null;

        // ---------- 文件操作 ----------
        function openFile() {
            fileInput.value?.click();
        }

        async function handleFileChange(event) {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                let text = await loadFileContent(file);
                text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                markdownContent.value = text;
                currentFileName.value = file.name;
                document.title = file.name + ' - Markdown 编辑器';
            } catch (err) {
                console.error('无法读取文件:', err);
                alert('文件读取失败，请重试');
            } finally {
                event.target.value = '';
            }
        }

        function saveFile() {
            const content = markdownContent.value;
            let filename = currentFileName.value;

            if (!filename) {
                // 没有关联文件，则要求用户输入文件名
                filename = prompt('请输入文件名：', 'untitled.md');
                if (!filename) return;           // 取消输入则放弃保存
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
            clearTimeout(draftTimer);
            clearDraft();
        }

        function exportPDF() {
            // 生成 PDF 时，将页面标题临时改为当前文件名或 untitled.pdf，打印完成后再恢复
            const baseName = currentFileName.value
                ? currentFileName.value.replace(/\.[^/.]+$/, '') + '.pdf'
                : 'untitled.pdf';
            const oldTitle = document.title;
            document.title = baseName;

            // 若有尚未触发的防抖渲染，立即刷新预览，保证打印内容是最新的
            clearTimeout(renderTimer);
            renderedHtml.value = parseMarkdown(markdownContent.value);

            // 等待 Vue 更新 DOM 后再打印
            nextTick(() => {
                renderMathElements(previewRef.value);
                window.print();
                // 打印完成后恢复标题
                document.title = oldTitle;
            });
        }

        // ---------- 全局键盘快捷键 ----------
        function handleGlobalKeydown(e) {
            // 如果正在输入法组合中，不处理（以免打断中文输入）
            if (e.isComposing) return;

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
                }
                // 选择不恢复时保留草稿，避免误触导致内容丢失（下次打开仍可恢复）
            }

            await nextTick();
            renderMathElements(previewRef.value);
            cleanupSync = setupSyncScroll();
            document.addEventListener('keydown', handleGlobalKeydown);
        });

        onBeforeUnmount(() => {
            clearTimeout(renderTimer);
            clearTimeout(draftTimer);
            if (cleanupSync) cleanupSync();
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
            openFile,
            handleFileChange,
            insertBold,
            insertItalic,
            insertCode,
            saveFile,
            exportPDF,
        };
    },
});

app.mount('#app');
