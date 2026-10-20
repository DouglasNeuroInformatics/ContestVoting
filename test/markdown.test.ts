import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../src/markdown.ts";

test("headings, paragraphs and lists", () => {
  const html = renderMarkdown("# Rules\n\nLine one\nline two\n\n- a\n- b\n\n1. first\n2. second");
  assert.equal(
    html,
    [
      "<h2>Rules</h2>",
      "<p>Line one line two</p>",
      "<ul>",
      "<li>a</li>",
      "<li>b</li>",
      "</ul>",
      "<ol>",
      "<li>first</li>",
      "<li>second</li>",
      "</ol>",
    ].join("\n"),
  );
});

test("bold, italic and safe links", () => {
  assert.equal(
    renderMarkdown("**Prix** *surprise* [DNP](https://douglasneuroinformatics.ca) [mail](mailto:a@b.ca)"),
    '<p><strong>Prix</strong> <em>surprise</em> <a href="https://douglasneuroinformatics.ca">DNP</a> <a href="mailto:a@b.ca">mail</a></p>',
  );
});

test("HTML is escaped and javascript: links are dropped", () => {
  const html = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) [y](https://a.ca" onclick="z)');
  assert.doesNotMatch(html, /<script|href="javascript|onclick="/);
  assert.match(html, /&lt;script&gt;/);
});
