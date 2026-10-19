# 本地浏览器依赖

以下文件来自固定版本的官方发布包，文本统一使用 LF 行尾并补齐末尾换行。Vue 使用包含模板编译器的生产构建，以支持 `index.html` 中的 Vue 模板；无需额外打包步骤。

| 依赖 | 版本 | 发布来源 | 随附许可证 |
| --- | --- | --- | --- |
| Vue | 3.5.44 | https://cdn.jsdelivr.net/npm/vue@3.5.44/dist/vue.esm-browser.prod.js | [MIT](LICENSE.vue.txt) |
| marked | 12.0.2 | https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js | [完整声明](LICENSE.marked.md) |
| KaTeX | 0.16.9 | https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/ | [MIT](katex/LICENSE.txt) |
| highlight.js | 11.9.0 | https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/ | [BSD-3-Clause](highlight/LICENSE.txt) |

KaTeX 保留原版 CSS，提供其全部 20 个 WOFF2 字体。CSS 中的 WOFF/TTF 是未随附的旧浏览器后备格式；请使用支持 WOFF2、ES 模块及 import map 的现代 Chrome/Edge。正常加载 WOFF2 时不会请求后备格式。

离线使用仍需运行本地 HTTP 服务，不能直接通过 `file://` 加载 ES 模块。发布时请一并保留本目录及许可证。更新依赖后运行 `npm test`，确认接口、渲染、打印与本地字体加载仍正常。
