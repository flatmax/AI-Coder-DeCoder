# Reference: Symbol Index

**Supplements:** `specs4/2-indexing/symbol-index.md`

## Byte-level formats

### Legend — context variant (no line numbers)

```
# c=class m=method f=function af=async func am=async method
# v=var p=property i=import i→=local
# ->T=returns ?=optional ←N=refs →=calls
# +N=more ″=ditto Nc/Nm=test summary
# @1/=some/frequent/path/ @2/=another/path/
```

### Legend — LSP variant (with line numbers)

Identical to the context legend plus one additional line inserted after the `v p i i→` line:

```
# :N=line(s)
```

Full LSP legend:

```
# c=class m=method f=function af=async func am=async method
# v=var p=property i=import i→=local
# :N=line(s)
# ->T=returns ?=optional ←N=refs →=calls
# +N=more ″=ditto Nc/Nm=test summary
# @1/=some/frequent/path/ @2/=another/path/
```

### Per-element syntax

| Element | Syntax |
|---|---|
| File header | `path/to/file.py: ←5` — path, colon, space, optional `←N` for incoming references |
| External imports | `i json,os,typing` — literal `i`, space, comma-joined module names |
| Local imports | `i→ other/module.py,another.py` — literal `i→` (arrow glyph is Unicode U+2192), space, comma-joined paths |
| Class | `c MyClass(Base):10` — kind code, space, name, optional `(bases)`, optional `:line` (LSP only) |
| Method | `m fetch(url,timeout?)->Response:10` — kind code, space, name, params, optional `->returntype`, optional `:line` |
| Variable | `v CONFIG:15 ←3` — kind code, space, name, optional `:line`, optional `←N` |
| Nesting | Two-space indent per level — child of a class/function is indented one level deeper than its parent |
| References | `←N` (count-only) or `←file:line[,file:line]*` (explicit sites) |
| Calls | `→target1,target2` — literal `→` (arrow glyph U+2192), comma-joined callee names |
| Ditto | `″` (double prime, U+2033) — repeat-previous-references marker |
| Path alias | `@N/file.py` — at-sign, alias index, slash, then the path suffix |

### Kind codes

Single-character prefix, lowercase. Case-sensitive.

| Code | Meaning |
|---|---|
| `c` | class |
| `m` | method |
| `f` | function |
| `af` | async function |
| `am` | async method |
| `v` | variable |
| `p` | property |
| `i` | external import |
| `i→` | local import (resolves to a file in the repo) |

### Test file collapsing

Test files render as a single summary line instead of the full symbol tree:

```
tests/test_auth.py:
# 3c/12m fixtures:mock_store,test_user
```

Format: `# <N>c/<M>m fixtures:<comma-joined-fixture-names>` where `N` is class count and `M` is method count. Fixture list is comma-joined, no spaces after commas.

### Instance variable rendering

Instance variables extracted from `__init__` assignments (`self.x = ...`) are emitted as indented `v` lines immediately under the class header, before method lines. Each instance var gets its own line at one indent level deeper than the class.

## Numeric constants

### Path alias computation

Path prefixes earn an alias when they meet both thresholds:

- **Minimum prefix length** — 4 characters (shorter prefixes aren't worth aliasing)
- **Minimum use count** — 2 (prefix must appear in at least two paths)

Alias indices (`@1`, `@2`, ...) are assigned in descending order of reference frequency — the most-referenced prefix gets `@1`. Sub-prefixes of an already-aliased prefix are skipped (if `src/ac_dc/` is `@1/`, `src/` doesn't also get an alias).

## Schemas

No JSON or RPC schemas — symbol map output is plain text.

## Dependency quirks

### tree-sitter TypeScript package

The `tree_sitter_typescript` pip package does not expose a plain `language()` function. It exposes two grammars:

- `language_typescript()` — `.ts` files
- `language_tsx()` — `.tsx` files

Loader must probe both. The loader pattern:

```python
lang_func = (
    getattr(mod, "language_typescript", None)
    or getattr(mod, "language", None)
)
```

This is the only language where the getter function name differs from `language()`. Implementers copying the Python/JavaScript/C pattern for TypeScript will fail silently — the grammar won't load and `.ts` files will produce no symbols.

### Grammar package names

| Language | Wheel package | Module | Getter |
|---|---|---|---|
| Python | `tree-sitter-python` | `tree_sitter_python` | `language()` |
| JavaScript | `tree-sitter-javascript` | `tree_sitter_javascript` | `language()` |
| TypeScript | `tree-sitter-typescript` | `tree_sitter_typescript` | `language_typescript()` |
| C | `tree-sitter-c` | `tree_sitter_c` | `language()` |
| C++ | `tree-sitter-cpp` | `tree_sitter_cpp` | `language()` |

Each module is imported lazily on first use for the corresponding language. Missing packages cause the language to be silently unavailable (no exception at service construction).

### `tree-sitter` binding version

Requires `tree-sitter >= 0.21` for the `Language(callable)` wrapping API. Earlier versions required pre-built shared libraries.

## Cross-references

- Reference graph shape and connected-component clustering: `specs-reference/2-indexing/reference-graph.md` (when created)
- Prompt assembly consumes the map via `get_symbol_map(exclude_files=...)` — consumer detail lives with prompt assembly, not duplicated here