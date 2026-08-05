import { createApp, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { parseMarkdown } from './markdown.js';
import { applyHighlight, renderMathElements, bindSyncScroll } from './renderer.js';
import { createEditorHelpers } from './editor.js';

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

        const { insertBold, insertItalic, insertCode, insertAtCursor } = createEditorHelpers(markdownContent, textareaRef);

        const renderedHtml = computed(() => parseMarkdown(markdownContent.value));

        function exportPDF() {
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            requestAnimationFrame(() => {
                window.print();
            });
        }

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

        let cleanupScroll = null;

        watch(renderedHtml, async () => {
            await nextTick();
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            if (cleanupScroll) cleanupScroll();
            cleanupScroll = bindSyncScroll(textareaRef.value, previewRef.value);
        });

        onMounted(async () => {
            await nextTick();
            applyHighlight(previewRef.value);
            renderMathElements(previewRef.value);
            cleanupScroll = bindSyncScroll(textareaRef.value, previewRef.value);
        });

        onBeforeUnmount(() => {
            if (cleanupScroll) cleanupScroll();
        });

        return {
            markdownContent,
            renderedHtml,
            textareaRef,
            previewRef,
            insertBold,
            insertItalic,
            insertCode,
            handleKeydown,
            exportPDF,
        };
    },
});

app.mount('#app');