import { ref, watch, nextTick } from 'vue';
import { renderMathElements } from './render.js';

// 打印 / PDF 导出：页眉页脚设置、@page margin boxes 动态样式、导出流程。
// 页眉页脚原理：把动态字符串直接嵌入 @page margin box 的静态 content
// （兼容不支持 content: var() 的浏览器）；margin boxes 由浏览器逐页排版，
// 不会与正文重叠，且各角内容基线统一。页码用 counter(page)/counter(pages)。
export function createPrintHelpers({
    currentFileName,
    previewRef,
    flushPreview,   // () => void：强制刷新预览内容（防抖计时器归 main.js 所有）
}) {
    // ---------- 打印页眉页脚设置 ----------
    const PRINT_SETTINGS_KEY = 'md-editor:print';
    const printSettings = ref({ showTime: true, showTitle: true, headerText: '', showUrl: true, footerText: '' });
    try {
        const saved = JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY) || 'null');
        if (saved && typeof saved === 'object') Object.assign(printSettings.value, saved);
    } catch (e) { /* 忽略存储异常 */ }
    const showPrintSettings = ref(false);
    watch(printSettings, (v) => {
        try { localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(v)); } catch (e) { /* 忽略存储异常 */ }
    }, { deep: true });
    function openPrintSettings() { showPrintSettings.value = true; }
    function closePrintSettings() { showPrintSettings.value = false; }

    // 页眉中的时间文本（固定格式 YYYY-MM-DD HH:mm）
    function formatPrintTime(d) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // 生成页眉/页脚/页码样式：把动态字符串直接嵌入 @page margin box 的
    // 静态 content（兼容不支持 content: var() 的浏览器）；margin boxes
    // 由浏览器逐页排版，不会与正文重叠，且各角内容基线统一。
    function buildPrintHeaderFooterStyle(settings, timeText, titleText, urlText) {
        const esc = (s) => JSON.stringify(s);
        return `@media print {
    @page {
        @top-left { content: ${esc(settings.showTime ? timeText : '')}; font-size: 9px; color: #666; }
        @top-center { content: ${esc(settings.headerText || '')}; font-size: 9px; color: #666; }
        @top-right { content: ${esc(settings.showTitle ? titleText : '')}; font-size: 9px; color: #666; }
        @bottom-left { content: ${esc(settings.showUrl ? urlText : '')}; font-size: 9px; color: #666; }
        @bottom-center { content: ${esc(settings.footerText || '')}; font-size: 9px; color: #666; }
        @bottom-right { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页"; font-size: 9px; color: #666; }
    }
}`;
    }

    // 导出 PDF：刷新预览 → 注入页眉页脚样式 → 打印 → 恢复标题
    function exportPDF() {
        // 生成 PDF 时，将页面标题临时改为当前文件名或 untitled.pdf，打印完成后再恢复
        const baseName = currentFileName.value
            ? currentFileName.value.replace(/\.[^/.]+$/, '') + '.pdf'
            : 'untitled.pdf';
        const oldTitle = document.title;
        document.title = baseName;

        // 若有尚未触发的防抖渲染，立即刷新预览，保证打印内容是最新的
        flushPreview();

        // 等待 Vue 更新 DOM 后再打印
        nextTick(() => {
            renderMathElements(previewRef.value);

            // 按设置生成页眉/页脚/页码样式并注入
            const styleEl = document.createElement('style');
            styleEl.id = 'print-header-footer-style';
            styleEl.textContent = buildPrintHeaderFooterStyle(
                printSettings.value,
                formatPrintTime(new Date()),
                baseName,
                location.href,
            );
            document.head.appendChild(styleEl);

            window.print();

            // 打印完成后移除样式并恢复标题
            styleEl.remove();
            document.title = oldTitle;
        });
    }

    return { printSettings, showPrintSettings, openPrintSettings, closePrintSettings, exportPDF };
}
