import { marked } from 'marked';

// ==================== Markdown 解析（marked） ====================

// 数学公式扩展：行内 $...$ 与块级 $$...$$
const mathExtension = {
    extensions: [
        {
            name: 'blockMath',
            level: 'block',
            start(src) { return src.match(/\$\$/)?.index; },
            tokenizer(src) {
                const match = src.match(/^\$\$(\n?.*?)\$\$/s);
                if (match) {
                    return { type: 'blockMath', raw: match[0], text: match[1].trim() };
                }
            },
            renderer(token) {
                return `<div class="math block">${token.text}</div>`;
            }
        },
        {
            name: 'inlineMath',
            level: 'inline',
            start(src) { return src.match(/\$/)?.index; },
            tokenizer(src) {
                const match = src.match(/^\$([^\n$]+?)\$(?!\$)/);
                if (match) {
                    return { type: 'inlineMath', raw: match[0], text: match[1].trim() };
                }
            },
            renderer(token) {
                return `<span class="math inline">${token.text}</span>`;
            }
        }
    ]
};

// ---------- HTML 转义工具（自定义代码块渲染用） ----------
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
}

// ---------- 自定义代码块渲染器（marked v12 位置参数签名） ----------
// 在解析阶段直接用 highlight.js 高亮（纯字符串操作），
// 避免渲染完成后再次遍历整个预览 DOM，提升大文档性能。
// 内部任何异常都 return false，让 marked 回退到默认渲染，保证不会拖垮整个预览。
const customRenderer = {
    code(text, lang, escaped) {
        try {
            const langName = (lang || '').split(/\s+/)[0];
            const langClass = langName ? ` class="language-${escapeAttr(langName)}"` : '';
            let highlighted = escaped ? text : escapeHtml(text);
            if (langName && window.hljs && window.hljs.getLanguage(langName)) {
                highlighted = window.hljs.highlight(text, { language: langName, ignoreIllegals: true }).value;
            }
            return `<pre><code${langClass}>${highlighted}</code></pre>`;
        } catch (e) {
            console.warn('代码块渲染失败，回退到默认渲染:', e);
            return false;
        }
    }
};

marked.use(mathExtension);
marked.use({ renderer: customRenderer });
marked.setOptions({ breaks: true, gfm: true });

export function parseMarkdown(raw) {
    if (!raw || raw.trim() === '') return '';
    try {
        return marked.parse(raw);
    } catch (err) {
        console.error('Markdown 解析错误:', err);
        return `<p style="color:red;">Markdown 解析出错，请检查语法。</p>`;
    }
}

// ==================== DOM 渲染 ====================

// KaTeX 数学公式的 DOM 渲染（代码高亮已在解析阶段完成）
export function renderMathElements(previewEl) {
    if (!previewEl || !window.katex) return;
    const inlines = previewEl.querySelectorAll('.math.inline');
    inlines.forEach((el) => {
        if (el.querySelector('.katex')) return;
        try {
            window.katex.render(el.textContent, el, { throwOnError: false, displayMode: false });
        } catch (e) { console.warn('公式渲染失败:', el.textContent, e); }
    });
    const blocks = previewEl.querySelectorAll('.math.block');
    blocks.forEach((el) => {
        if (el.querySelector('.katex')) return;
        try {
            window.katex.render(el.textContent, el, { throwOnError: false, displayMode: true });
        } catch (e) { console.warn('公式渲染失败:', el.textContent, e); }
    });
}
