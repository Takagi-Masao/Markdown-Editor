import { createApp, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { parseMarkdown } from './markdown.js';
import { applyHighlight, renderMathElements } from './renderer.js';
import { createEditorHelpers, loadFileContent } from './editor.js';

const app = createApp({
    setup() {
        const markdownContent = ref(`# 欢迎使用 Markdown 编辑器

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
`);

        const pageTitle = ref('Markdown 编辑器');
        const textareaRef = ref(null);
        const previewRef = ref(null);
        const fileInput = ref(null);
        const currentFileName = ref(null);

        const { insertBold, insertItalic, insertCode, insertAtCursor } = createEditorHelpers(markdownContent, textareaRef);

        const renderedHtml = computed(() => parseMarkdown(markdownContent.value));

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
        }

        function exportPDF() {
            // 生成 PDF 时，将页面标题临时改为当前文件名或 untitled.pdf，打印完成后再恢复
            const baseName = currentFileName.value
                ? currentFileName.value.replace(/\.[^/.]+$/, '') + '.pdf'
                : 'untitled.pdf';
            const oldTitle = document.title;
            document.title = baseName;

            // 等待 Vue 更新 DOM 后再打印
            nextTick(() => {
                applyHighlight(previewRef.value);
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
            await nextTick();
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            cleanupSync = setupSyncScroll();
            document.addEventListener('keydown', handleGlobalKeydown);
        });

        onBeforeUnmount(() => {
            if (cleanupSync) cleanupSync();
            document.removeEventListener('keydown', handleGlobalKeydown);
        });

        // 预览更新后重新高亮、渲染，但不要重新绑定同步（避免重复绑定）
        watch(renderedHtml, async () => {
            await nextTick();
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            // 注意：不再重新绑定同步，锁定机制保证稳定
        });

        return {
            pageTitle,
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
