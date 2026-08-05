# Markdown 编辑器 - 实时预览 + 导出 PDF

一个功能丰富的 Web 端 Markdown 编辑器，支持实时预览、代码高亮、数学公式渲染以及 PDF 导出。

## ✨ 主要特性

- **便携式部署**：将所有功能整合至双击即可使用的 `all-in-one.html`，无需额外配置。
- **实时分屏预览**：左侧编辑，右侧即时渲染 Markdown 效果。
- **丝滑同步滚动**：编辑区与预览区滚动位置实时同步，互不干扰。
- **代码语法高亮**：自动识别代码语言，使用 highlight.js 进行高亮。
- **LaTeX 数学公式**：支持行内公式 `$...$` 和块级公式 `$$...$$`，由 KaTeX 渲染。
- **PDF 导出**：一键调用浏览器打印功能，自动隐藏页眉页脚，内容完整不分页截断。
- **编辑辅助工具**：提供加粗、斜体、行内代码等快捷按钮，支持 `Ctrl+B`、`Ctrl+I` 等快捷键。
- **响应式设计**：适配桌面及移动端，布局自动切换。

## 🛠️ 技术栈

- **前端框架**：Vue 3 (Composition API)
- **Markdown 解析**：marked
- **代码高亮**：highlight.js
- **数学公式**：KaTeX
- **PDF 导出**：浏览器原生 `window.print()` 配合 CSS 打印样式
- **UI**：纯 CSS

## 🚀 快速开始

1. 克隆或下载本项目到本地。
2. 使用以下方法打开打开 `index.html`：
   - 使用 `VS Code Live Server` 插件打开 `index.html`。
   - 在项目根目录使用 Python 内置的 HTTP 服务器打开 `index.html`：
     ```bash
     python -m http.server 8000
     ```

   或者直接双击 `all-in-one.html` 即可使用。
3. 编辑 Markdown 内容，右侧实时预览效果。
4. 点击「导出 PDF」按钮，在弹出的打印对话框中选择「另存为 PDF」即可保存。

## 📄 打印/导出 PDF 说明

- 打印输出**不包含**浏览器自带的页眉页脚，且带有舒适的页面边距。
- 所有代码块在打印时自动展开、换行并允许跨页，确保内容完整。

## 🧩 项目结构

```
├── index.html # 主页面
├── css
|   └── style.css # 自定义样式
├── js
|   ├── main.js # 主 JavaScript 文件
|   ├── markdown.js # Markdown 解析器
|   ├── renderer.js # 渲染器
|   └── editor.js # 编辑器
├── all-in-one.html # 双击即可使用的整合文件
├── LICENSE # 许可证文件
└── README.md # 本文件
```

## 📝 示例 Markdown

编辑器内置了一段示例内容，包含标题、代码块、公式等，可直接体验或清空后自行编辑。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📃 许可

本项目采用 MIT 许可证，详情见 LICENSE 文件。
