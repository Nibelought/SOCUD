# Demo corpus

Source texts for `npm run seed:demo` (see `src/scripts/seed-demo.ts`). The files are committed, so
seeding is offline and deterministic. Layout: `<lang>/<topic>-<n>.txt` with `lang` in `en | ru | uk`.

## File format

One file holds several documents. A document starts with a `=== slug ===` line, followed by header
lines, a `---` line and the body (HTML):

```
=== python-list-comprehensions ===
title: List comprehensions in Python
parent: python-basics
---
<h2>Syntax</h2>
<p>A comprehension builds a list from an iterable: <code>[x * x for x in range(5)]</code>.</p>
<pre><code class="language-python">squares = [x * x for x in range(5)]
</code></pre>
=== next-slug ===
title: ...
---
<p>...</p>
```

- `slug`: unique within the file, lowercase `a-z 0-9 -` (Latin letters only, even for ru/uk files).
- `title`: required, plain text, no HTML.
- `parent`: optional slug of another document in the same file (a parent must come before its children).
- The body is HTML limited to what the editor and the server sanitizer allow (anything else is dropped):
  - blocks: `h1`-`h4`, `p`, `ul`/`ol` with `li`, `blockquote`, `hr`, `pre` > `code`
    (`<pre><code class="language-python">...</code></pre>`; use `language-ts`, `language-python`, `language-sql`, ...)
  - inline: `strong`, `em`, `s`, `code`, `a`, `br` (sparingly)
  - math (KaTeX syntax): inline `<span data-type="inlineMath" data-latex="a^2+b^2=c^2" data-display="no"></span>`,
    display equation on its own paragraph: `<p><span data-type="inlineMath" data-latex="\int_0^1 x\,dx=\frac12" data-display="yes"></span></p>`
  - NOT allowed: tables, images, `style`, `class` (except on `code`), scripts, Markdown syntax
  - escape `<`, `>` and `&` inside text and code as `&lt;`, `&gt;`, `&amp;`
  - links to other documents of the same file: `<a href="{{doc:other-slug}}">text</a>`;
    external links: `https://...` only. Unknown slugs lose the link and keep the text.
