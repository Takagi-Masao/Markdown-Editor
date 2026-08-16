# Markdown 编辑器 - 实时预览 + 导出 PDF

一个功能丰富的 Web 端 Markdown 编辑器，支持实时预览、代码高亮、数学公式渲染以及 PDF 导出。

## ✨ 主要特性

- **便携式部署**：在线加载各依赖项，基本无需额外下载。
- **实时分屏预览**：左侧编辑，右侧即时渲染 Markdown 效果。编辑区与预览区滚动位置实时同步，体验丝滑流畅。
- **本地文件上传**：支持从本地上传 Markdown 文件（也可直接把 `.md` / `.txt` 文件拖拽到页面打开），自动加载文件内容。
- **代码语法高亮**：自动识别代码语言，使用 highlight.js 进行高亮。
- **LaTeX 数学公式**：支持行内公式 `$...$` 和块级公式 `$$...$$`，由 KaTeX 渲染。
- **多重安全保存机制**：既可保存 Markdown 文件也可以导出 PDF，Markdown 文件保存行为见快速开始第 3 条。当前文件有未保存修改时，打开新文件（或拖入新文件），刷新或关闭页面时前会弹出「保存 / 不保存 / 取消」确认框，防止修改丢失。
- **草稿自动保存**：编辑内容自动保存到浏览器本地存储，刷新或重开页面时可一键恢复，避免意外丢失。
- **编辑辅助工具**：提供加粗、斜体、行内代码等快捷按钮，支持 `Ctrl+B`、`Ctrl+I` 等快捷键，可在 `main.js` 中的 `handleGlobalKeydown` 自行修改。工具栏插入操作基于 `execCommand('insertText')`，不会破坏浏览器原生的 `Ctrl+Z` 撤销历史。

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

     或者使用 `node.js` 打开：

     ```bash
     npm install -g http-server # 如果没有它就先下载
     http-server -p <port>
     ```

     然后访问 `http://localhost:<port>` 即可。
3. 编辑 Markdown 内容或者本地上传 Markdown 文件，右侧实时预览效果。点击「保存 Markdown」按钮可以保存目前编辑的 Markdown 内容，有三种保存方案，按优先级排序如下：
    - 如果在非 Edge/Chrome 浏览器上，或者通过不安全上下文（如 `192.168.x.x` 局域网访问）使用，将会将内容下载到浏览器默认下载路径。如果未从本地打开文件，下载时将会要求输入文件名。
    - 如果文件是从本地打开的，修改内容会直接原位置写入，无对话框。
    - 使用浏览器自带的“保存”对话框。
4. 点击「导出 PDF」按钮，在弹出的打印对话框中选择「另存为 PDF」即可保存。较长代码块在右侧预览界面会折叠，但在生成 PDF 时完全展开。

## 🧩 项目结构

```
├── index.html # 主页面
├── css
|   └── style.css # 自定义样式
├── js
|   ├── main.js # 主 JavaScript 文件（应用逻辑与各模块接线）
|   ├── renderer.js # 渲染器（Markdown 解析、代码高亮、KaTeX 公式渲染）
|   ├── open.js # 文件打开（文件选择器、拖拽、未保存确认）
|   ├── save.js # 文件保存（三种方案）
|   ├── editor.js # 编辑器（选区插入等辅助功能）
|   └── draft.js # 草稿自动保存（localStorage）
├── LICENSE # 许可证文件
└── README.md # 本文件
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📃 许可

本项目采用 MIT 许可证，详情见 LICENSE 文件。
