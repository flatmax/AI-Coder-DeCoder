import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Inline the pure functions from the component to test them in isolation

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSimpleMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="code-block"><code>${code}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\n/g, '<br>');
}

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
  });

  it('passes plain text through', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });

  it('handles empty string', () => {
    assert.equal(escapeHtml(''), '');
  });
});

describe('renderSimpleMarkdown', () => {
  it('returns empty string for falsy input', () => {
    assert.equal(renderSimpleMarkdown(''), '');
    assert.equal(renderSimpleMarkdown(null), '');
    assert.equal(renderSimpleMarkdown(undefined), '');
  });

  it('renders bold text', () => {
    const result = renderSimpleMarkdown('**bold**');
    assert.ok(result.includes('<strong>bold</strong>'));
  });

  it('renders italic text', () => {
    const result = renderSimpleMarkdown('*italic*');
    assert.ok(result.includes('<em>italic</em>'));
  });

  it('renders inline code', () => {
    const result = renderSimpleMarkdown('use `foo()` here');
    assert.ok(result.includes('<code>foo()</code>'));
  });

  it('renders code blocks', () => {
    const result = renderSimpleMarkdown('```js\nconst x = 1;\n```');
    assert.ok(result.includes('<pre class="code-block">'));
    assert.ok(result.includes('const x = 1;'));
  });

  it('renders headings', () => {
    assert.ok(renderSimpleMarkdown('# H1').includes('<h2>H1</h2>'));
    assert.ok(renderSimpleMarkdown('## H2').includes('<h3>H2</h3>'));
    assert.ok(renderSimpleMarkdown('### H3').includes('<h4>H3</h4>'));
  });

  it('converts newlines to <br>', () => {
    const result = renderSimpleMarkdown('line1\nline2');
    assert.ok(result.includes('<br>'));
  });

  it('escapes HTML in input', () => {
    const result = renderSimpleMarkdown('<script>alert(1)</script>');
    assert.ok(!result.includes('<script>'));
    assert.ok(result.includes('&lt;script&gt;'));
  });
});