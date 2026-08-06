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
e^{i \\pi } + 1 = 0
$$

\`\`\`javascript
console.log('Hello, world!');
\`\`\`

> 生活不止眼前的苟且，还有诗和远方。

你可以在[这里](https://help.luogu.com.cn/rules/academic/handbook/latex "LaTeX 格式手册")或者[这里](https://help.luogu.com.cn/rules/academic/handbook/markdown "洛谷 Markdown 格式手册")学习更多关于 Markdown 的知识。
`);

        const textareaRef = ref(null);
        const previewRef = ref(null);
        const fileInput = ref(null);

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
                // ✅ 统一换行符，避免与 textarea 内部表示不一致
                text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                markdownContent.value = text;
            } catch (err) {
                console.error('无法读取文件:', err);
                alert('文件读取失败，请重试');
            } finally {
                event.target.value = '';
            }
        }

        function exportPDF() {
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            requestAnimationFrame(() => window.print());
        }

        // ---------- 键盘快捷键 ----------
        function handleKeydown(e) {
            if (e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault();
                insertAtCursor('  ');
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                insertBold();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                e.preventDefault();
                insertItalic();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                exportPDF();
                return;
            }
        }

        // ---------- 生命周期 ----------
        onMounted(async () => {
            await nextTick();
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            cleanupSync = setupSyncScroll();
        });

        onBeforeUnmount(() => {
            if (cleanupSync) cleanupSync();
        });

        // 预览更新后重新高亮、渲染，但不要重新绑定同步（避免重复绑定）
        watch(renderedHtml, async () => {
            await nextTick();
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            // 注意：不再重新绑定同步，锁定机制保证稳定
        });

        return {
            markdownContent,
            renderedHtml,
            textareaRef,
            previewRef,
            fileInput,
            openFile,
            handleFileChange,
            insertBold,
            insertItalic,
            insertCode,
            handleKeydown,
            exportPDF,
        };
    },
});

app.mount('#app');
