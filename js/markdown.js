import { marked } from 'marked';

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

marked.use(mathExtension);
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