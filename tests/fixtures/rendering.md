# Rendering regression

Paragraph with **bold**, *emphasis*, ~~deleted~~ and `inline code`.

Inline HTML: <span data-html-inline style="color: rgb(200, 30, 40)">styled <strong>HTML</strong></span><br>next line.

<div data-html-block>
  <p>Block <em>HTML</em> &amp; entities</p>
</div>

<details open data-html-details>
<summary>Details</summary>

**Markdown inside HTML**

</details>

<table data-html-table><tr><td colspan="2">HTML table</td></tr></table>

| Name | Value |
| --- | ---: |
| GFM | **cell** |

1. Ordered item
   - Nested item

- [x] Complete
- [ ] Pending

> Quoted **text**

---

[Reference][target] and <https://example.com/autolink>.

[target]: https://example.com/reference "Reference title"

![Embedded pixel](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6+9sAAAAASUVORK5CYII=)

`<span data-inline-code>Literal inline</span>`

```html
<div data-code-only>Literal fenced HTML</div>
```

```javascript
const message = "highlighted";
```

    <div data-indented-code>Literal indented HTML</div>

Escaped HTML: &lt;b data-escaped&gt;literal&lt;/b&gt;.

Inline math: $x^2$.

$$
x^2 + y^2 = z^2
$$
