# Markdown 编辑器 - 实时预览 + 导出 PDF

一个功能丰富的 Web 端 Markdown 编辑器，支持实时预览、代码高亮、数学公式渲染以及 PDF 导出。

## ✨ 主要特性

- **便携式部署**：在线加载各依赖项，无需额外下载。
- **实时分屏预览**：左侧编辑，右侧即时渲染 Markdown 效果。
- **丝滑同步滚动**：编辑区与预览区滚动位置实时同步，互不干扰。
- **本地文件上传**：支持从本地上传 Markdown 文件，自动加载文件内容。
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
2. 使用本地服务器打开 `index.html`，如：
   - 使用 `VS Code Live Server` 插件打开 `index.html`。
   - 在项目根目录使用 Python 内置的 HTTP 服务器打开 `index.html`：
     ```bash
     python -m http.server <port>
     ```
     然后访问 `http://localhost:<port>` 即可。
3. 编辑 Markdown 内容或者本地上传 Markdown 文件，右侧实时预览效果。
4. 点击「导出 PDF」按钮，在弹出的打印对话框中选择「另存为 PDF」即可保存。较长代码块在右侧预览界面会折叠，但在生成 PDF 时完全展开。

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
├── LICENSE # 许可证文件
└── README.md # 本文件
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📃 许可

本项目采用 MIT 许可证，详情见 LICENSE 文件。
