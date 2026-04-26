# Layer 2 — indexing

Symbol index (all 5 tree-sitter languages), document index (markdown + SVG, through sub-commit 2.8.2), reference graph, keyword enrichment.

Historical delivery record. Moved from `IMPLEMENTATION_NOTES.md` during the docs refactor.

---

## Layer 2 — in progress

Current status: 2.1 parser + model delivered, 2.2 extractors complete for all five tree-sitter languages, 2.3 cache next.

### 2.1 — Parser + data model — **delivered**

- `src/ac_dc/symbol_index/__init__.py` — package marker exporting the public surface (`Symbol`, `CallSite`, `Import`, `FileSymbols`, `Parameter`, `LANGUAGE_MAP`, `TreeSitterParser`, `language_for_file`).
- `src/ac_dc/symbol_index/models.py` — plain dataclasses for the symbol data model. `Symbol`, `CallSite`, `Import`, `Parameter`, `FileSymbols`. `FileSymbols.all_symbols_flat` walks nested children. Range tuples are 0-indexed (tree-sitter native); callers add 1 at the UI boundary.
- `src/ac_dc/symbol_index/parser.py` — `LanguageSpec` frozen dataclass + `LANGUAGE_MAP` registry for Python, JavaScript, TypeScript, C, C++. Extension → language reverse map built once at import. `language_for_file(path)` does the lookup with case-insensitive suffix matching. `TreeSitterParser` is a lazy-loading per-language cache — grammars load on first request, missing grammars cache `None` so repeated lookups don't re-probe. `instance()`/`reset_instance()` classmethods for shared-instance management. `parse(source, language)` and `parse_file(path)` convenience entry points. `available_languages()` / `is_available(name)` for introspection.
- `tests/test_symbol_index_parser.py` — covers `LANGUAGE_MAP` structure (TypeScript quirk enforced — `language_typescript` probed first), `language_for_file` resolution (known extensions, case-insensitivity, unknown extensions, PathLike acceptance), singleton lifecycle, grammar loading (unknown language, missing grammar via monkeypatched `importlib.import_module`, None-caching, Language+Parser identity across calls, `available_languages` / `is_available`), integration (real grammars parse real snippets — Python, JavaScript, TypeScript, C, C++), `parse_file` (extension dispatch, unknown extension skips, missing file raises OSError, str paths), edge cases (empty source, invalid UTF-8 bytes don't crash, unknown-language parse returns None).

Known quirks documented in code:

- **TypeScript function name** — `tree_sitter_typescript` exposes `language_typescript()` and `language_tsx()`, NOT a plain `language()`. The probe order in `LANGUAGE_MAP` covers this; a future wheel adding a plain `language()` still works via the fallback.
- **Extension collisions** — `.h` is claimed by C, not C++. Deliberate choice from specs4 — in mixed repos the C parser handles both and only C++-exclusive extensions route to the C++ grammar.
- **Grammar unavailability is silent** — debug log only for missing packages (expected case), warning log for installed-but-broken grammars (user install is in a confusing state).
- **Singleton is a convenience, not a constraint** — tests construct isolated parsers via `TreeSitterParser()` when they need a clean cache per test.

### 2.2 — Language extractors — **complete**

Per-language extractor classes under `src/ac_dc/symbol_index/extractors/`. Each extractor walks a tree-sitter AST and produces a `FileSymbols`. Shared base class handles the common "walk children, recurse into classes" pattern; per-language subclasses override node-type handling.

All five tree-sitter languages are delivered with test coverage: Python, JavaScript, TypeScript, C, C++. MATLAB is deferred per D1 — no maintained tree-sitter grammar, would need the regex-based `tree_optional = True` path.

Order:

1. **`base.py` — `BaseExtractor` — delivered.** Plumbing only: text decoding, range extraction, child lookup, tree walking. `tree_optional` flag for regex-based extractors.
2. **`python.py` — `PythonExtractor` — delivered.** Classes, functions (sync + async), methods, decorators (`@property`), instance vars from `self.x = ...` in `__init__`, imports (absolute + relative with level, including aliased and wildcard), top-level variables (private skipped, dunders kept), call sites (with builtin filtering), parameters with defaults and type annotations. Comprehensive test suite in `tests/test_symbol_index_python_extractor.py` — 10 test classes covering every public behaviour of the extractor.
3. `javascript.py` — `JavaScriptExtractor` — **delivered.** Classes with `extends`, methods (including getters/setters as `property` kind), async methods (including arrow async), top-level functions, `function*` generators, top-level const/let/var bindings (function-valued → kind='function', plain → 'variable', destructuring LHS skipped), ESM imports (default, named with alias, namespace, side-effect, mixed default+named), export unwrapping (named declarations flow through; anonymous default skipped; re-exports produce no new symbol), class fields (public and `#private`, static, uninitialised), call sites (identifier / member / optional chaining / `new Foo()` / with subscript and call-on-call skipped), builtin filtering (globals like `console`/`Array`/`parseInt`, CJS `require`, test-framework hooks `describe`/`it`/`expect`). Parameters include destructuring patterns (synthetic name from source text, whitespace-collapsed), rest params, defaults. Comprehensive test suite in `tests/test_symbol_index_javascript_extractor.py` — 9 test classes covering every public behaviour.
4. `typescript.py` — **delivered.** Inherits from JavaScript; adds parameter type annotations, return types, optional-parameter markers, interfaces (as kind='class' with method/property member children), type aliases (as kind='variable'), enums (as kind='class' with variable children). Test suite in `tests/test_symbol_index_typescript_extractor.py`.
5. `c.py` — **delivered.** Function definitions and prototypes, structs and unions (kind='class' with field children), enums (kind='class' with variable children), typedefs (as variable symbols, plus the struct/enum they wrap), `#include` as imports, global variables, call sites with stdlib-builtin filtering, parameters including pointer / array / variadic / function-pointer shapes. Test suite in `tests/test_symbol_index_c_extractor.py` — 10 test classes, 58 tests.
6. `cpp.py` — **delivered.** Inherits from C; adds `class_specifier` → Symbol(kind='class') with access modifiers silently passed through, base-class clause parsing, `namespace_definition` → Symbol(kind='class') with nested symbols as children, `using` declarations (both `using foo::bar` and `using namespace foo`) as Import entries, constructors / destructors / operator overloads via `_cpp_method_name` (handles `identifier`, `field_identifier`, `destructor_name`, `operator_name`, `qualified_identifier` — the last preserves the scope prefix for out-of-class definitions like `void Foo::bar() {}`), method prototypes vs data members inside class bodies (both use `field_declaration`; distinguish by unwrapping the first declarator and checking for `function_declarator`), `template_declaration` unwrapping (both top-level and nested — `_handle_nested_template` for inside-class templates), extended builtin filter including `std::` library (`cout`, `move`, `make_unique`, `sort`, `static_cast`, …), `qualified_identifier` callee resolution (tail component for builtin filter and reference tracking), `template_function` callee unwrapping (`std::make_unique<Foo>(...)`). Test suite in `tests/test_symbol_index_cpp_extractor.py` — 8 test classes covering extraction contract, classes, methods (inline, prototype, ctor, dtor, operator, mixed order), namespaces (named, anonymous, nested), using declarations, templates, out-of-class definitions, and call sites (std filtering, qualified_identifier tail, template_function unwrap, field-expression inheritance, source order).

Deliberate scope trims, documented in the file's module docstring:
- Templates preserved as source text only; template parameters not surfaced as symbols
- No SFINAE / concept analysis
- Private members surfaced (hiding them would surprise users)
- Imports from `using` declarations inside a namespace are discarded — they're namespace-scoped, not file-scoped

MATLAB deferred per user decision (see D1 context in earlier message).

Notes from delivering the Python extractor:

- `_children_by_field` helper was needed because tree-sitter's `child_by_field_name` returns only the first match, but `import_from_statement` assigns the same `name` field to multiple children (`from x import a, b`). Cursor walk collects them all.
- Relative-import level counting uses the `import_prefix` node's byte length — one byte per dot. Cleaner than iterating children looking for dot tokens.
- Async detection reads the first 5 bytes of the function node's source rather than iterating non-named children. The latter varies slightly across grammar versions.
- Decorator handling peels `call` nodes to reach the underlying identifier or attribute — handles both `@foo` and `@foo(args)` uniformly.
- Instance-var extraction only peeks inside methods named `__init__`. If the LLM later renames an init method to something else, we lose the annotation — acceptable tradeoff, matches specs3 behaviour.
- **Wildcard imports** (`from X import *`) — the `wildcard_import` node is NOT assigned to the `name` field in tree-sitter-python's grammar. It appears as an unfielded direct child of `import_from_statement`. The extractor falls back to scanning direct children when the field-based pass finds no names. Caught during test run; fix is defensive (only fires when `names` is empty, so a future grammar version that moves `wildcard_import` under the `name` field won't cause double-append).

Notes from delivering the JavaScript extractor:

- `new_expression` needs its own dispatch branch in call-site extraction. tree-sitter-javascript does NOT emit it as a `call_expression`; it's a sibling node type with a `constructor` field instead of `function`. Missing this would have lost every class-instantiation edge in the reference graph (likely the most common cross-file edge in OO-style codebases).
- Arrow function async detection checks for an `async` child node; function_declaration async detection does the same. Both go through a plain `any(c.type == "async" for c in node.children)` scan rather than relying on a specific field, because the grammar emits `async` as an anonymous-keyword child in both cases.
- Single-parameter arrow functions (`x => x + 1`) parse with the parameter on a `parameter` field (singular) rather than wrapped in a `formal_parameters` node. `_populate_function_from_value` checks both.
- Optional chaining (`obj?.foo()`) needs no special handling — tree-sitter-javascript uses the same `member_expression` shape as plain `obj.foo()`, just with an anonymous `?.` token between object and property. The `_callee_name` helper reads the `property` field and both shapes hit the same path.
- Destructuring parameter "names" are the source text with whitespace collapsed and capped at 60 characters. Less precise than modelling the pattern shape, but the alternative is recursing into `object_pattern` / `array_pattern` and synthesising identifier lists for every position — non-trivial code for a case where the symbol map renders something the LLM will treat as opaque anyway.
- `export { foo }` (re-export without a declaration) hits `_handle_export` with no `declaration` field and no inner declaration-typed child. The method returns without error, producing no symbol — correct behaviour since re-exports don't define anything new.
- `field_definition` (class fields) does NOT expose the field name through `child_by_field_name("name")` — my first assumption, wrong. The diagnostic dump showed the name appears as the first named child (a `property_identifier` for public fields, `private_property_identifier` for `#private`). Scan named children for the identifier-shaped type instead. `static` is an anonymous keyword child on the same node, naturally skipped by the `named_children` iteration. Five TestClassFields failures were all the same bug — `_extract_class_field` returning None on every field.
- Debug-by-diagnostic discipline: when grammar shape is unknown, add a `pytest.fail` test that dumps `body.named_child_count`, each child's `type`/`is_named`/`text`, and each grandchild's `type`/`text`. One run with `-s` gives the answer exactly. Three prior attempts guessed at node-type names (`public_field_definition`, `class_field_definition`) — none of which tree-sitter-javascript actually emits — and wasted time. The failing diagnostic costs one test run but produces the authoritative shape.

Notes from delivering the C extractor:

- **Type qualifiers are sibling nodes, not children of the type node.** For `const char *name`, tree-sitter-c emits the `parameter_declaration` with a `type_qualifier` sibling (`const`) and a `type` field (`char`). Calling `_node_text` on just the `type` field returns `"char"` and loses the `const`. The fix is to iterate the parameter node's direct children, collect `type_qualifier` children, and prepend them to the captured type text. This matches how the grammar represents storage-class specifiers on global declarations too, so the same pattern could extend to surfacing `static`/`extern` if we ever want it.

- **Function pointers wrap in `parenthesized_declarator`.** For `int (*cb)(int)`, the outer shape is `function_declarator` → `parenthesized_declarator` → `pointer_declarator` → `identifier`. The initial `_unwrap_declarator` only peeled `pointer_declarator` and `array_declarator`, so function-pointer struct fields (and function-pointer parameters in some grammar versions) never reached the inner identifier. Adding `parenthesized_declarator` to the wrapper-peeling set fixed it. One subtlety — `parenthesized_declarator` doesn't use the `"declarator"` field name for its payload; the code falls back to the first named child when the field lookup returns None. Grammar inconsistency rather than design intent.

- **`(void)` parameter lists are a `parameter_declaration` with no declarator field.** The extractor detects this single-child-with-no-declarator-and-type='void' shape and returns an empty parameter list, matching C semantics. Without this detection, the function would appear to have one parameter named `""` of type `void`.

- Diagnostic-by-grammar discipline still wins. Two failures surfaced only on the real test run against `tree_sitter_c`; both were grammar-shape assumptions I'd inferred without verifying. The cost was two extra test runs — cheaper than speculative pre-emptive handling of every possible wrapper node type.

Notes from delivering the TypeScript extractor:

- tree-sitter-typescript embeds the `extends` keyword as part of the `class_heritage` node's text rather than as a separate anonymous token child. JS's `_extract_class_bases` returns `"extends Bar"` verbatim when applied to TS source. Override strips a leading `extends ` or `implements ` keyword from each base expression. This is a surgical divergence — everything else about class-heritage parsing is shared.
- Rest parameters in TS are wrapped in `required_parameter` (not left as a bare `rest_pattern` like JS). The `required_parameter`'s pattern field is the `rest_pattern`, and the `...` token is anonymous so `_pattern_name` on the pattern returns `"...args"` verbatim. Fix is to detect `pattern_node.type == "rest_pattern"` inside `_build_required_parameter`, pull the identifier child's text for the name, and mark the parameter as vararg. The JS fallthrough path for bare `rest_pattern` still works — that's what `test_rest_parameter_still_works` confirms.
- Interface inheritance (`interface Foo extends Bar, Baz`) isn't assigned to a named field across grammar versions — it's a direct child named `extends_type_clause` (newer) or `extends_clause`. Scan direct children for either name. Multiple bases land in the same clause (unlike JS classes' single-inheritance model).
- Property signatures (`name: string`) lift the type annotation into `Symbol.return_type` rather than introducing a new `type` field on `Symbol`. The renderer already knows how to display a trailing type annotation via `return_type`, and adding a parallel field would just duplicate that path. Same treatment for optional markers — `?` appends to the name string rather than going to a separate `is_optional` field.
- Enum members come in two grammar shapes: bare identifiers (`property_identifier` for auto-numbered entries) and `enum_assignment` nodes (for `Red = 1` or `On = "on"`). The extractor handles both and ignores the assigned value — only the name matters for symbol-map purposes.
- Generic type parameters (`<T>`) are parsed as separate nodes on type aliases, interfaces, classes, functions — we don't surface them as symbols. Matches the module docstring's "what we deliberately don't model" list.
- Two grammar divergences found only by running the tests — a reminder that inheriting from a sibling-language extractor doesn't mean "all cases carry over." Diagnostic-first discipline catches these faster than guessing.

Notes from delivering the C++ extractor:

- **Method name extraction needed a dedicated helper.** The C extractor's function-definition path reads the identifier via `_unwrap_declarator` and assumes the inner node is an `identifier`. C++ methods break that assumption four different ways — `field_identifier` (in-class declarations), `destructor_name` (`~Foo`), `operator_name` (`operator+`), and `qualified_identifier` (`Foo::bar` for out-of-class definitions). The `_cpp_method_name` helper accepts all five node types and returns the verbatim source text. Callers that only accept `identifier` would silently drop every destructor, operator, and out-of-class definition from the symbol map.

- **Constructors have no return type.** The C extractor's `_extract_function_definition` requires a `type` field to compute `return_type`; the C grammar always has one. C++ constructors (`Foo(int x) {}`) do not, and the field lookup returns None. The C++ method extractor leaves `return_type` as None rather than erroring — matches the TypeScript interface-method treatment where `return_type` is optional metadata.

- **Class body uses `field_declaration` for both data members and method prototypes.** Same node type, distinguished only by whether the declarator (after unwrapping pointers/arrays) is a `function_declarator` or not. The dispatch happens in `_handle_cpp_field_declaration`: peel the first declarator, check its type. If it's a `function_declarator`, build a method prototype (no body, no call sites). Otherwise, fall through to the C extractor's `_extract_field_declaration` for data-member handling. Missing this would either drop every method prototype OR surface them as variables — either failure is silent, so the test suite was essential.

- **Nested templates need their own unwrap path.** The top-level `_handle_template` writes to a `FileSymbols`, but a `template_declaration` inside a class body (like `template<typename T> void method() {}` inside `class Box`) needs to attach the result as a child of the containing class. `_handle_nested_template` peels the template wrapper and calls the appropriate extractor (class, struct, or method), then appends to the parent class symbol. Without this branch, templated inner methods would be silently dropped.

- **Anonymous namespaces deliberately produce no symbols AND drop their contents.** Unlike anonymous structs where the containing declaration's variable (`struct {} foo;`) still produces a symbol, anonymous namespaces don't have a containing declaration — they are the declaration. Their contents have internal linkage only. The extractor returns None from `_extract_namespace` when the name field is absent, and the `_populate_namespace_body` call never fires. Inner functions defined inside anonymous namespaces are lost from the symbol map, which matches the semantic intent (not file-navigable).

- **The builtin filter operates on the tail of qualified_identifier.** `std::move(x)` parses as a call whose callee is a `qualified_identifier` with text `std::move`. The override of `_callee_name` resolves qualified callees to the tail component (`move`), which is then checked against the extended builtin set. Scope prefixes (`std::`) are noise for the reference graph — user calls through those namespaces still contribute edges via the tail name. The same approach works for `template_function` callees (`std::make_unique<Foo>` → `make_unique`).

- **Using declarations discard scope when inside a namespace.** A `using foo::bar;` at file top level produces a file-level Import. The same declaration inside `namespace mymod { ... }` is namespace-scoped, not file-scoped — surfacing it as a file import would be misleading. `_populate_namespace_body` builds a synthetic `FileSymbols` to collect symbols via the top-level dispatcher, then only copies `.symbols` onto the parent namespace (discarding `.imports`). This is a deliberate correctness trade-off — the namespace contents are preserved, just the import-scope semantics are lost, which is better than the alternative.

### 2.3 — Cache — **delivered**

- `src/ac_dc/base_cache.py` — `BaseCache[T]` generic abstract class. Mtime-based `get`/`put`/`invalidate`/`clear`, path normalisation matching `Repo._normalise_rel_path`, signature-hash accessor, hook points for subclasses (`_compute_signature_hash`, `_decorate_entry`, `_persist`, `_remove_persisted`, `_clear_persisted`, `_load_all`). Persistence hooks catch OSError and log — in-memory state is always authoritative even when disk writes fail.
- `src/ac_dc/symbol_index/cache.py` — `SymbolCache(BaseCache[FileSymbols])`. In-memory only (tree-sitter re-parse is cheap). Overrides `_compute_signature_hash` to produce a SHA-256 digest over structural data: imports by module, symbols by name/kind/params/bases/return-type/async-flag/instance-vars, recursively including children. Excludes ranges, call sites, and file paths. Adds a `cached_files` alias for readability.
- `tests/test_base_cache.py` — covers path normalisation, get/put round-trip, mtime mismatch handling, invalidate/clear, introspection (`cached_paths`, `has`, `get_signature_hash`), signature-hash subclass hook, persistence-hook contract (including OSError swallowing).
- `tests/test_symbol_index_cache.py` — covers round-trip of real FileSymbols, hash shape (64-char hex, determinism), structural sensitivity (name/kind/params/type/vararg/bases/return-type/async/children/instance-vars/imports/ordering), structural insensitivity (ranges, call sites, import lines, import aliases), and the `cached_files` alias contract.
- `src/ac_dc/symbol_index/__init__.py` updated to re-export `SymbolCache`.

Notes from delivery:

- The base class is generic over the entry type so subclasses get typed accessors. SymbolCache parameterises over `FileSymbols`; the future DocCache will parameterise over `DocOutline`.
- Persistence hooks are no-ops by default. SymbolCache leaves them alone — tree-sitter re-parse is fast enough that session-scoped caching is sufficient. DocCache will override them because KeyBERT enrichment is expensive (~500ms per file) and worth persisting across restarts.
- Signature hash explicitly excludes `range` tuples, call sites, and file paths. An unrelated edit earlier in the file shifts every following symbol's line number; if ranges were hashed, the tracker would demote every file on every edit. Call sites are body-level details that a refactor moving code between methods shouldn't flag as structural. File paths are already the cache key.
- A failing-test check caught an initial over-zealous insensitivity rule — the first draft excluded import order from the hash. Reordered imports are genuinely a structural change (even if rare), and the compact formatter is order-sensitive. The test was corrected to assert order-sensitivity and the implementation matched.

### 2.4 — Reference index — **delivered**

- `src/ac_dc/symbol_index/reference_index.py` — `ReferenceIndex`. Builds a cross-file reference graph from pre-resolved `FileSymbols`. Queries: `references_to_symbol(name)` (call-site locations by symbol name), `files_referencing(path)` (distinct incoming referrers), `file_dependencies(path)` (distinct outgoing targets), `file_ref_count(path)` (weighted incoming reference count, sums call sites + imports), `bidirectional_edges()` (canonical `(lo, hi)` pairs that reference each other mutually), `connected_components()` (union-find over the bidirectional edges, isolated files appear as singletons).
- `tests/test_symbol_index_reference_index.py` — 7 test classes covering empty inputs, call-site edges (including nested-symbol traversal via `all_symbols_flat`), import edges, rebuild idempotence, bidirectional edges (canonical ordering, mixed call/import satisfaction), connected components (singletons, pairs, transitive chains, one-way non-clustering), and `references_to_symbol` (empty for unknown, per-site granularity, returns copy not view).

Design decisions pinned in the module docstring:

- **Input is pre-resolved.** Call sites must carry `target_file`; imports must carry `resolved_target` (via setattr in Layer 2.4 tests; the Layer 2.5 resolver will populate the attribute directly). The index performs no resolution itself — keeps it single-purpose and lets the resolver evolve independently.
- **Edges are weighted but the graph is collapsed.** Multiple references from A to B (several call sites, or an import plus calls) accumulate into one weighted edge. `file_ref_count` returns the total weight; `files_referencing` returns the distinct referrer set. Both are needed — the formatter wants the count for `←N` annotations, clustering wants the set.
- **Same-file call sites populate the symbol-name index but not the file edge.** Without this, every file with internal calls would appear to reference itself, which would pollute the stability tracker's clustering pass.
- **Bidirectional edges only, for clustering.** `connected_components` uses union-find over mutual references only. One-way references (A imports B, B doesn't touch A) aren't a strong enough signal to cluster on — clustering noise would hurt the tier tracker more than losing weak signals would.
- **Isolated files appear as singleton components.** The orchestrator's clustering pass must see every file or newly-created files would never register in the tracker's init pass. The index records all input files in `_all_files` and treats missing-from-edges files as trivial components.
- **Rebuild is fully idempotent.** All state (`_refs_to_symbol`, `_incoming`, `_outgoing`, `_all_files`) is reset at the start of `build()`. The orchestrator calls `build()` after every re-index pass; accumulating state across rebuilds would inflate counts and retain edges to deleted files.

Deferred to Layer 2.5 (import resolver):

- The index reads `getattr(imp, "resolved_target", None)` to tolerate pre-resolver Import objects. Once the resolver lands and sets the attribute during extraction post-processing, tests can drop the `_with_resolved_import` setattr helper.

### 2.5 — Import resolver — **planned**
- Builtin identifier filtering lives in the extractors (each per-language extractor has its own builtin set, already filtering call-site output before it reaches the reference index). No filter in the reference index itself — it trusts its input.

`src/ac_dc/symbol_index/import_resolver.py` — maps import statements to repo-relative file paths.

Per-language rules (from specs4/2-indexing/symbol-index.md#import-resolution):

- Python — absolute paths, package `__init__.py`, relative paths with level-aware parent traversal
- JavaScript/TypeScript — relative resolution with extension probing, `index.*` fallback for directories
- C/C++ — `#include` search across repo

Cache the resolution graph at the module level so repeated import queries are O(1). Invalidated when new files are detected.

### 2.6 — Compact formatter — **delivered**

- `src/ac_dc/base_formatter.py` — `BaseFormatter` abstract class. Handles path aliasing (prefix → `@N/` with length, use-count, and savings thresholds; greedy assignment; ancestor-prefix suppression), legend assembly (subclass kind-code legend + alias block), file sorting, exclusion filtering, empty-input handling. Deterministic output — same input produces byte-identical bytes.
- `src/ac_dc/symbol_index/compact_format.py` — `CompactFormatter(BaseFormatter)` renders `FileSymbols` into the context and LSP variants of the symbol map. Context (default) has no line numbers; LSP adds `:N` (1-indexed) after each symbol name. Kind codes `c`/`m`/`f`/`af`/`am`/`v`/`p`/`i`, two-space indent per nesting level, instance vars render before methods (data before behaviour), `←N` suppressed when zero, `→name,name` dedupe preserves first-seen order.
- `tests/test_base_formatter.py` — 23 tests across empty inputs, basic rendering, reference counts, path aliasing (thresholds, sub-prefix suppression, greedy assignment, apply-to-path), legend retrieval, exclusion, determinism. Uses a minimal `_StubFormatter` subclass and `_FakeRefIndex` double.
- `tests/test_symbol_index_compact_format.py` — 11 test classes covering legend variants, top-level shape, imports (external vs local via `resolved_target`), kind codes for all 7 kinds, nesting and indentation, parameter and return-type rendering, inheritance, outgoing calls (single, multiple, dedupe, absence), incoming references (file header and symbol-level, zero suppression, no-ref-index), LSP line numbers (function, method, context vs LSP size), instance variables (nested under class, ordering, absence, coexistence with methods), exclusion, path aliases (integration), determinism (identical across calls, order-insensitive inputs, call-site order stability).

Notes from delivery:

- **Legend glyph conflict (D12).** The legend originally documented `←N=refs` and `→=calls` using the literal arrow glyphs. Three tests in `TestOutgoingCalls` and `TestIncomingReferences` iterate output lines with `next(line for line in result if "←" in line)` or `"→" in line` to find the single intended symbol line. Documenting the glyphs in the legend meant `next()` matched a legend line first — the actual symbol line was never selected. Resolution: the legend describes markers using ASCII prose (`->T=returns`, `?=optional`, `N=refs`), and the `←`/`→` glyphs appear only in rendered symbol lines. The LLM learns what `←3` and `→helper` mean from context rather than from an explicit legend entry. Cost: two characters of documentation per use become implicit; benefit: tests can reliably find the symbol line via a single-character glyph filter.

- **Instance-vars-before-methods ordering.** Specs3 shows instance vars as indented `v` lines under a class. The rendering order (data before behaviour) is a convention — either order works mechanically, but consistency across runs is what the stability tracker cares about. Pinned in `test_instance_vars_and_methods_coexist`.

- **Dedup preserves first-seen order (not set).** Python's set ordering varies across runs thanks to hash randomization of strings. The dedup step in `_render_annotations` uses a `seen` set plus a `targets` list — the set does membership checks, the list preserves order. Caught by `test_call_site_order_stable_across_input_shuffles` which would pass on a single run with either approach but flicker on repeated invocations with a set-based result.

- **Line numbers appended before signature.** For a class `Foo` at line 5 with base `Bar`, the output is `c Foo:5(Bar)` not `c Foo(Bar):5`. Matches specs3's LSP variant output. Subtle — it's easy to read the tests as accepting either order.
═══════ REPL

### 2.7 — Orchestrator — **delivered**

- `src/ac_dc/symbol_index/index.py` — `SymbolIndex` wires parser, per-language extractors, cache, import resolver, reference graph, and formatter instances (context + LSP) into a single entry point. Methods: `index_file`, `index_repo`, `invalidate_file`, `get_symbol_map`, `get_lsp_symbol_map`, `get_legend`, `get_file_symbol_block`, `get_signature_hash`.
- `tests/test_symbol_index_orchestrator.py` — 8 test classes covering construction, per-file pipeline (cache hit/miss, language dispatch, error paths), multi-file pipeline (build ref index, resolve call sites, resolve imports, skip unsupported), stale removal (memory + cache pruning, ordered before ref rebuild), invalidation, symbol map formatting (context vs LSP variants, exclude_files, legend, single-file block), signature hashing, and snapshot discipline (reads don't mutate).

Design decisions and lessons:

- **Per-file pipeline** — `index_file` normalises the path, dispatches to the matching extractor by language name, checks cache via `(rel, mtime)`, parses + extracts + resolves imports + stores. mtime-based caching makes unchanged files a no-op; cache hits return the stored `FileSymbols` by reference so identity is preserved across calls (pinned by `test_cache_hit_on_unchanged_mtime`).
- **Multi-file pipeline** — `index_repo` enforces the step ordering the spec calls out: normalise → update resolver → index each → prune stale → resolve call sites → rebuild ref graph. Pruning runs BEFORE the ref rebuild; otherwise the graph briefly contains edges to/from files that were supposed to be removed (`test_stale_removal_before_reference_build`).
- **Call-site resolution is modest.** `_resolve_call_sites` builds a per-file imported-name → target map from resolved imports and sets `target_file` on call sites whose name matches an imported name. It catches the common case of `from foo import bar; bar()` without attempting to resolve method calls on imported classes, aliased imports, or dotted namespaced calls — those go via import edges in the reference graph instead. This is the minimum surface required by Layer 2.4's tests; deeper resolution is deferred.
- **Two formatter instances.** The orchestrator holds both `CompactFormatter(include_line_numbers=False)` (context, LLM-facing) and `CompactFormatter(include_line_numbers=True)` (LSP, editor features). Consumers pick the variant they want. Keeping them as instances rather than constructed on-demand means alias computation is consistent across repeated calls (both formatters use the same input file set, so aliases stabilise).
- **`get_file_symbol_block` bypasses `format_files`.** The default `CompactFormatter.format_files(files, ...)` always emits a legend. For single-file rendering into a cached tier block, the legend lives separately in L0 so we must skip it. The base class's `format(paths, include_legend=False)` method does what we want, but it takes path strings (not `FileSymbols`) and reads file content via `_current_by_path`. The orchestrator stashes the single FileSymbols in `_current_by_path` for the duration of one `format()` call (in a try/finally so the dict is always cleared) and passes the path string. An earlier attempt passed `include_legend=False` to `format_files` directly — caught by failing tests since `format_files` doesn't accept that kwarg.
- **Snapshot discipline.** All read methods (`get_symbol_map`, `get_lsp_symbol_map`, `get_legend`, `get_file_symbol_block`, `get_signature_hash`) never mutate `_all_symbols` or the cache. Pinned by `test_reads_do_not_mutate_all_symbols` which exercises every query method and asserts `_all_symbols.keys()` is unchanged. Matters for Layer 3's streaming pipeline — within a single request's execution window, the index is a read-only snapshot.
- **Resolver file-set scope.** The resolver's `set_files()` receives the full normalised input list (before language filtering), not just the extractor-supported subset. C-style includes can reference files that have no extractor of their own; keeping the broader set in the resolver means those references still resolve correctly even though the target files produce no symbols.
- **Extractor errors are swallowed.** An extractor bug (grammar version mismatch, unexpected node shape) shouldn't take down the whole index pass. `_parse_and_store` wraps `extractor.extract()` in try/except, logs a warning, and returns None. The file is absent from `_all_symbols` but the rest of the repo indexes normally.
- **MATLAB hook preserved.** The orchestrator checks `extractor.tree_optional` and passes `tree=None` to extractors that declare it. When the regex-based MATLAB extractor eventually lands, no structural change to `index_file` is needed — the extractor just needs to be added to `_EXTRACTOR_CLASSES`.
- **Missing-file handling.** When `stat()` fails (file deleted between the walker producing the list and the orchestrator indexing it), both the in-memory entry and the cache entry are invalidated and `index_file` returns None. Keeps the index consistent with the filesystem even under concurrent modification.

## Layer 2 — complete

Layer 2 (Indexing) is complete. All of: parser + data model, five per-language extractors (Python, JavaScript, TypeScript, C, C++), cache, reference index, import resolver, compact formatter, and orchestrator. Ready to proceed to Layer 3 (LLM engine — context, history, cache tiering, prompt assembly, streaming, edits, modes).

Final test totals for Layer 2:
- Python: `uv run pytest tests/test_symbol_index_*.py tests/test_base_cache.py tests/test_base_formatter.py` — all pass.
- Full suite: `uv run pytest` — 968 tests passing across Layers 0–2.

## Layer 2.8 — Document index (planned)

Layer 2's deferred piece. specs4/2-indexing/document-index.md and specs4/2-indexing/keyword-enrichment.md spec the full design; the SVG section was revised in a recent commit to use geometric containment instead of font-size heuristics (see the latest state of document-index.md § SVG Extraction).

The frontend mode toggle (code/doc/cross-ref) is live in `app-shell.js` and calls `LLMService.switch_mode` and `LLMService.set_cross_reference` successfully. Both backend RPCs accept the call and broadcast `modeChanged`. However doc mode produces an empty context because no doc index exists, and cross-reference toggle logs "doc index not available; toggle will take effect once Layer 2 doc-index lands." Layer 2.8 fills these in.

### Motivation

The user's request — "doc indexing so I can click doc mode or code mode AND have the ability to add indexes or symbols depending on the mode" — is only half delivered. Backend accepts mode switching, frontend toggle works, but doc mode produces no content and cross-reference is a no-op. This layer makes both materially useful.

### Build order (one commit per numbered item)

**2.8.1 — Doc index scaffold (markdown only, no keyword enrichment).** The narrowest slice that puts content in doc mode.

Sub-commit progress:

**2.8.1a — Data model** (delivered, commit `5a99e3b`). `src/ac_dc/doc_index/__init__.py`, `src/ac_dc/doc_index/models.py` — `DocHeading`, `DocLink`, `DocSectionRef`, `DocProseBlock`, `DocOutline` dataclasses. Mutable (mirrors `Symbol`); caller code treats outline as read-only within a request boundary (D10 snapshot discipline). `tests/test_doc_index_models.py` pins the shape.

**2.8.1b — Markdown extractor** (delivered, commit `066e007`). `src/ac_dc/doc_index/extractors/__init__.py`, `src/ac_dc/doc_index/extractors/base.py`, `src/ac_dc/doc_index/extractors/markdown.py`. Single-pass regex line scanner. Heading extraction with correct level-based nesting, inline and reference-style links, image refs, content-type markers (code/table/formula via fence/separator/math detection), section line counts, doc-type classification via path and heading heuristics. Fenced code and math-block suppression for heading and link detection; inline code span stripping. `tests/test_doc_index_markdown_extractor.py` covers all of it.

Notes from 2.8.1b delivery:

- **Path classification is a heuristic, not a discovery filter.** The `_PATH_TYPE_KEYWORDS` table decides the `doc_type` tag (`spec`, `guide`, `readme`, etc.) based on conventional directory names. It does NOT exclude any file from indexing — file discovery is the orchestrator's job (2.8.1e) via `os.walk` with `.gitignore` and excluded-dir handling. Unclassified paths get `doc_type="unknown"` and are fully indexed. Pinned by `test_unclassified_paths_produce_valid_outlines`.

- **Path patterns are generic conventions, not repo-specific.** Earlier draft had `specs3/`, `specs4/` hardcoded — removed in favour of cross-repo conventions (`specs/`, `spec/`, `rfc/`, `rfcs/`, `design/`, `designs/`, `adr/`, `decisions/`, `guide/`, `guides/`, `tutorial/`, `howto/`, `reference/`, `references/`, `api/`, `notes/`, `meeting/`, `minutes/`, `journal/`). Per-repo customisation can land via config later if real-world usage shows gaps.

- **Section line off-by-one from trailing newline.** `content.split("\n")` on a file ending with `\n` produces a trailing empty string. Naive `len(lines)` would inflate the last heading's `section_lines` by one. Fixed by trimming a trailing empty line before computing the EOF boundary. Pinned by `TestSectionLines`.

- **Reference-style link resolution drops undefined labels.** A `[text][undef]` with no matching `[undef]: target` definition produces no DocLink rather than an empty-target placeholder. Cleaner for downstream consumers that would otherwise need to filter.

Delivered 2.8.1 sub-commits:

- **2.8.1c — DocCache** (delivered). `src/ac_dc/doc_index/cache.py` — `DocCache(BaseCache[DocOutline])` with JSON sidecar persistence at `{repo_root}/.ac-dc/doc_cache/{flattened-path}.json`. Filename translation replaces `/` with `__` for flat storage. Entries carry mtime, content_hash, keyword_model, and the serialized outline. Memory-only mode when `repo_root=None`. Crash-resilient load — corrupt sidecars are removed on discovery. `keyword_model=None` passes any cached entry; non-None requires match, forcing re-extraction when the stored model differs. `tests/test_doc_index_cache.py` pins round-trip, mtime semantics, signature-hash stability, crash recovery, and model-name plumbing.

- **2.8.1d — DocReferenceIndex** (delivered). `src/ac_dc/doc_index/reference_index.py` — exposes the `file_ref_count(path)` + `connected_components()` protocol the stability tracker consumes via `initialize_with_keys`. Builds incoming ref counts on `DocHeading` nodes via GitHub-style anchor slugging (lowercase, spaces→hyphens, strip punctuation). Unresolved anchors fall back to the document's top heading rather than dropping the link. Image references produce `DocLink` entries with `is_image=True` so doc→SVG edges cluster correctly. Bidirectional edges power clustering. `tests/test_doc_index_reference_index.py` pins slugging, incoming-count accumulation, bidirectional edge formation, connected-component isolation, and image-link edge handling.

- **2.8.1e — DocFormatter** (delivered). `src/ac_dc/doc_index/formatter.py` — `DocFormatter(BaseFormatter)`. Renders `path [type]:` header, indented heading tree with depth-based `#` count, `(kw1, kw2, …)` keywords (omitted in 2.8.1 since enrichment lands in 2.8.4), `[content-type]` bracketed markers, `~Nln` size (only when ≥5 lines), `←N` incoming refs (only when non-zero), `→target.md#Section` outgoing section refs indented one level below the source heading, final `links:` line with deduplicated document-level targets. Legend lists the doc-specific markers (no arrow glyphs, per D12). `tests/test_doc_index_formatter.py` covers every annotation rendering rule, heading nesting, outgoing-ref placement, path aliasing (inherited from base), exclusion, and determinism across calls.

- **2.8.1f — DocIndex orchestrator** (delivered, commit `f728bed`). `src/ac_dc/doc_index/index.py` — wires extractor registry, cache, reference index, and formatter into a single entry point. Mirrors `SymbolIndex` so the LLM service's tier builder dispatches between them via a simple mode check. Per-file pipeline: mtime → cache hit-or-extract → link-path validation against repo files → store. Multi-file pipeline: walk (or accept explicit list) → index each → prune stale entries → rebuild reference graph. Stale-prune-before-rebuild ordering matches the symbol index invariant (`test_stale_removal_before_reference_build` pins it). Snapshot discipline (D10) enforced for read methods — `get_doc_map`, `get_legend`, `get_file_doc_block`, `get_signature_hash` never mutate `_all_outlines`. `tests/test_doc_index_orchestrator.py` covers construction, per-file lifecycle (cache hit / miss / error paths), multi-file pipeline with discovery and excluded-directory handling, reference-graph integration, keyword-model plumbing, invalidation, read methods, and snapshot discipline.

Notes from 2.8.1f delivery:

- **Absolute-path defensive handling.** `index_file` accepts both repo-relative and absolute paths per its docstring. The original implementation normalised first (stripping any leading `/`) then resolved, which mangled POSIX absolute paths like `/tmp/.../repo/doc.md` into a repo-relative lookup against the wrong root. Fix: detect absolute-ness before normalisation. When absolute and within `repo_root`, use `relative_to` to produce the cache key. When absolute and outside `repo_root`, use the path as its own key (caller is doing something unusual but we don't crash). Pinned by `test_accepts_absolute_path`. Real callers pass repo-relative paths; this is the "defensive doorway" case where a caller has computed an absolute path from some other source.

- **`_walk_repo` skips hidden directories except `.github`.** Matches the `doc_convert` walker's rule for consistency — `.github/` conventionally holds CI docs that belong in the index, while other `.hidden/` dirs are scratch or state that doesn't. Combined with the module-level `_EXCLUDED_DIRS` set (`.git`, `.ac-dc`, `.ac-dc4`, `node_modules`, `__pycache__`, `.venv`, `venv`, `dist`, `build`), the walker returns only files that belong in the doc index.

- **Repo-file set is the union of walked files, not the filtered doc set.** Extractors that need to validate link targets (SVG's image extraction in 2.8.3, markdown's image refs in 2.8.1b) want to know whether `../assets/diagram.svg` exists on disk — not whether it's a doc. Passing the full walked set means image targets resolve even when the target's extension isn't registered with an extractor. 2.8.1's markdown extractor doesn't use this yet (syntax-only link extraction), so `repo_files` is forward-compatible plumbing; 2.8.3 activates it.

- **Stale prune runs before reference-graph rebuild.** Non-obvious regression case: if you rebuild the graph first, then prune, the graph briefly contains edges from/to files we're about to drop. The pruned version of the orchestrator correctly has no edge for deleted files. Matches the symbol index's Phase 0 → rebuild ordering. Pinned by `test_stale_removal_before_reference_build` which leaves `a.md` with an incoming link to a now-pruned `deleted.md` and asserts the graph sees no incoming edges on a.md.

- **Empty file list is not the same as None.** `index_repo([])` explicitly says "index nothing, prune everything"; `index_repo(None)` triggers a walk. Pinned by `test_explicit_empty_list_prunes_everything`. A future refactor that treated `None` and `[]` identically would make the pruning path unreachable.

### Layer 2.8.1 — complete

Layer 2.8.1 (doc index scaffold, markdown-only, no keyword enrichment) is complete. All of: data model (2.8.1a), markdown extractor (2.8.1b), cache with disk persistence (2.8.1c), reference index (2.8.1d), compact formatter (2.8.1e), orchestrator (2.8.1f). Ships a fully functional markdown-only doc index; SVG support lands with 2.8.3, keyword enrichment with 2.8.4. Next sub-commit is 2.8.2 — wire the doc index into `LLMService` so mode switching actually produces content in doc mode and cross-reference has material effect.

**2.8.2 — Wire doc index into LLMService.** Makes doc mode and cross-reference produce content.

Delivered as nine incremental sub-commits. Sub-commits order chosen so tests at each step have populated state to exercise — `_doc_index` constructed first, background build second, everything else plugs into a running index.

### Two-phase readiness — contract refinement

Per specs4/3-llm/modes.md § "Cross-Reference Readiness" and specs4/2-indexing/document-index.md § "Two-Phase Principle", the doc index has two distinct readiness phases:

- **Structure ready** — all markdown files parsed into outlines, reference graph built. Minimum state for doc mode and cross-reference to produce *something*. Happens synchronously during the background build; typically completes within a second for any reasonable repo size.
- **Enriched ready** — keyword enrichment complete for all files (2.8.4). Outlines get `(keyword1, keyword2)` annotations that the LLM uses for disambiguation. Can take minutes on large repos.

The cross-reference UI toggle is gated on **structure-ready only** (per user decision during 2.8.2 planning). Once structural extraction completes, the toggle works; when enrichment later completes, outlines re-hash (keywords contribute to signature) and the tracker demotes the affected items once. They then re-stabilize at their tiers over the next few requests.

Two separate flags exposed on `get_mode`:

- `doc_index_ready` — structure done, cross-reference can activate
- `doc_index_enriched` — enrichment done (always False in 2.8.2; flips in 2.8.4)

### Sub-commits

**2.8.2a — Construct DocIndex, attach to LLMService.** Constructor builds `DocIndex(repo_root=repo.root if repo else None)` alongside `SymbolIndex`. Never optional (unlike `_symbol_index` which can be None during deferred init) — DocIndex construction is cheap (no tree-sitter, no grammars). Stored as `self._doc_index`. Tests: constructor populates `_doc_index`, identity preserved across mode switches, present even when `symbol_index=None`.

**2.8.2b — Doc index background build.** New `_build_doc_index_background()` method called from `complete_deferred_init` after symbol-index wiring. Runs `doc_index.index_repo(file_list)` in `_aux_executor` (doc extraction is CPU-bound enough to deserve its own executor thread; pre-empts the event loop). Emits `startupProgress('doc_index', ...)` callback events per file. Sets `_doc_index_ready = True` on completion; `_doc_index_building = True` during. Errors logged but non-fatal — doc index failure doesn't block the service. Tests: background build fires on deferred-init completion, progress events emit per file, readiness flag flips, errors surface as warnings without crashing.

**2.8.2c — `get_mode` readiness fields.** Replace the hardcoded `False` for `doc_index_ready`, `doc_index_building`, `cross_ref_ready` with real state from `_doc_index_ready` / `_doc_index_building`. Add `doc_index_enriched` field (always False in 2.8.2). `cross_ref_ready` mirrors `doc_index_ready` — the minimum readiness for cross-reference to produce content is structural extraction. Tests: fields reflect actual state before/during/after doc index build; `doc_index_enriched` stays False.

**2.8.2d — Tier builder doc dispatch.** `_build_tiered_content` — replace the skip-with-TODO branch for `doc:{path}` with real dispatch to `doc_index.get_file_doc_block(path)`. Doc blocks concatenate alongside symbol blocks in the tier's `symbols` field — both render under the `TIER_SYMBOLS_HEADER` header in the same content section per specs4/3-llm/prompt-assembly.md § "L1–L3 Blocks". Fragment ordering sorted by key for determinism. Tests: doc prefix dispatch works, missing path returns None handled, mixed symbol+doc tier renders both kinds, blocks in sorted key order.

**2.8.2e — Legend dispatch in `_assemble_tiered`.** Pass `doc_legend = doc_index.get_legend() if (mode == DOC or cross_ref_enabled) else ""` so cross-reference mode and doc mode both get the appropriate legend in L0. Primary legend always goes to the `symbol_legend` parameter of `assemble_tiered_messages`; secondary (opposite-mode) always goes to the `doc_legend` parameter. The assembler (already implemented in 3.8) places each under the correct header per specs4/3-llm/prompt-assembly.md § "Cross-Reference Legend Headers". Tests: code mode no cross-ref → symbol legend only; doc mode no cross-ref → doc legend only; cross-ref → both legends with opposite-mode headers.

**2.8.2f — `_update_stability` doc entries.** When in doc mode: iterate `doc_index._all_outlines` for non-selected files, add `doc:{path}` entries with signature hash and formatted-block tokens. When cross-reference is active in code mode: also iterate doc outlines and add `doc:{path}` entries. When in doc mode with cross-reference: iterate symbol index for `symbol:{path}` entries. Removal for selected files already covers both `symbol:` and `doc:` prefixes (from 3.10's active-file entry removal). Tests: doc mode populates doc entries; code mode + cross-ref populates both; doc mode + cross-ref populates both.

**2.8.2g — Cross-reference enable/disable actually does something.** `set_cross_reference(True)` in code mode: add `doc:{path}` items to the active tracker (parallel to symbol items) — on the next `_update_stability` pass they'll be in active-items and flow through the normal tier machinery. `set_cross_reference(True)` in doc mode: add `symbol:{path}` items symmetrically. `set_cross_reference(False)`: remove cross-ref items from tracker via `tracker._items.pop()`, mark affected tiers broken. Readiness gate: enable returns `{error: "cross-reference not ready"}` when `doc_index_ready` is False. Tests: enable adds items, disable removes them, readiness gate works, enable during build is rejected cleanly.

**2.8.2h — Rebuild handles doc mode.** `_rebuild_cache_impl` — when `mode == Mode.DOC`, indexed_files comes from `doc_index._all_outlines.keys()` instead of `symbol_index._all_symbols`; key prefix is `doc:` (already handled by the dispatch logic). Orphan handling unchanged — selected non-doc files are still orphans and bin-pack into L1/L2/L3. Tests: rebuild in doc mode places `doc:` entries correctly; rebuild in doc mode with mixed selection (docs + non-docs) orphan-distributes correctly.

**2.8.2i — Lazy init in doc mode.** `_try_initialize_stability` — when starting in doc mode, seed from doc index instead of symbol index. Filter file list by `doc_index._all_outlines` keys, use `doc:` prefix, pass to `initialize_from_reference_graph`. When doc mode is active but `doc_index_ready` is False (session starts in doc mode before background build completes — edge case), skip initialization; the next request's lazy-init retry catches it. Tests: initialization in doc mode uses doc ref graph; skips gracefully when doc index not ready; retries on next request.

### Delivery order

- **2.8.2a** first — everything else depends on `_doc_index` existing
- **2.8.2b** second — populates `_doc_index._all_outlines` so subsequent sub-commits can test dispatch against real content
- **2.8.2c** third — readiness flags needed for 2.8.2g's gate
- **2.8.2d** → **2.8.2e** → **2.8.2f** — tier plumbing in dependency order (content → legend → tracker)
- **2.8.2g** — cross-ref toggle (depends on 2.8.2c's gate and 2.8.2f's tracker items)
- **2.8.2h** → **2.8.2i** — rebuild and lazy-init dispatch (both touch existing paths in subtle ways; kept last to minimize risk of cross-talk with earlier sub-commits)

After 2.8.2 ships, doc mode actually works and cross-reference toggle has material effect. User-visible. Enrichment is still deferred to 2.8.4 — outlines render with empty keyword slots but structure is fully navigable.

### Layer 2.8.2 — complete

All nine sub-commits delivered: DocIndex construction, background build, readiness flags, tier-builder dispatch, legend dispatch, stability-update dispatch, cross-reference lifecycle, rebuild-cache dispatch, lazy-init dispatch. Doc mode produces content via the doc index. Cross-reference toggle has material effect — enabling seeds items into the active tracker with the opposite prefix; disabling cleans them up.

### Layer 2.8.3 — complete

Delivered across two commits (`1ec1677`, `255f1e1`). SVG extractor lands with:

- **Containment tree from geometry** — shapes (rect, circle, ellipse, polygon, path) produce bounding boxes in root-canvas coordinates via transform composition. Text elements attach to their smallest containing box. Three-level labeling rule (aria-label → single-text inference → neutral `(box)`). Auto-id filtering for Inkscape / Illustrator patterns (`Group_42`, `g123`). Multi-line label joining via y-proximity. Reading order y-then-x at each level.
- **Shape-less fallback** — spatial clustering by vertical gap when the SVG has no shapes (text-only diagrams, ungrouped AI-generated layouts).
- **Prose blocks (2.8.3e)** — `<text>` elements over 80 chars become `DocProseBlock` entries with `container_heading_id` set to the enclosing box's label (or None for root-level prose). Shape-less path uses the cluster's first short label, or the root title as fallback. 2.8.4's keyword enricher will populate the `keywords` field post-hoc; 2.8.3e leaves it empty so the compact formatter renders `[prose]` bare.
- **Pure-function geometry module** (`svg_geometry.py`) — number parsing, transform parsing, matrix composition, point transformation, shape bbox computation, containment checks. Tested independently of the extractor.
- **Link extraction** — `<a xlink:href>` and SVG2 `<a href>` produce `DocLink` entries. External URLs and fragment-only refs are filtered.

Deliberately scope-trimmed per specs4:
- No font-size heuristics (fonts are unreliable semantic signals in SVG).
- No title detection inside ambiguous multi-text boxes — uses neutral `(box)` identifier and lets the LLM read via containment.
- No visual rendering (no playwright / resvg / Chromium).

### Post-layer bug fixes

**`8a49df8` — doc index scheduling on worker threads.** `complete_deferred_init` was called from `main.py`'s `_heavy_init` via `run_in_executor`, so `asyncio.get_event_loop()` inside it returned a fresh dead loop (Python 3.10+ behaviour on worker threads) rather than raising. `ensure_future(_build_doc_index_background())` scheduled the task on the dead loop and the task never ran — no error surfaced, just silence. Fix: split scheduling into `schedule_doc_index_build()` that uses `asyncio.get_running_loop()` (raises on worker threads rather than returning a dead loop), called separately from `main.py` on the event loop thread after the executor call returns. `complete_deferred_init` still attempts inline scheduling so the test path (pytest-asyncio on the event loop thread) doesn't need an extra call.

**`8e782db` — per-mode tracker initialization.** The stability-initialized flag was service-wide, so switching from code to doc mode swapped to a fresh empty tracker that `_try_initialize_stability` refused to populate (the flag was already True from code-mode init). Cache viewer showed an empty tier list in doc mode until the user clicked Rebuild. Fix: replaced `_stability_initialized: bool` with `_stability_initialized: dict[Mode, bool]`. `switch_mode` calls `_try_initialize_stability` after the tracker swap — the new mode's tracker runs full init against its reference graph; subsequent switches back to an initialized mode are no-ops. Rebuild and lazy-init retry paths updated to use the per-mode dict.

Spec updates for the init contract landed in the same commit (`8e782db`): `specs4/3-llm/cache-tiering.md` added a "Per-Tracker Initialization" section; `specs4/3-llm/modes.md` updated "Mode Switching Mechanics" and "Stability Tracker Lifecycle" to call out that init runs on first switch-into-mode.

**Notes from delivery:**

- **The readiness gate is structural-only.** `doc_index_ready` flips when structure extraction completes; `doc_index_enriched` is wired but always False in 2.8.2. Cross-reference gates on structure only, per specs4 — enrichment improves quality but isn't a prerequisite. When 2.8.4 lands, enrichment completion will re-hash affected outlines and the tracker will demote-and-restabilize them naturally across a few cycles.

- **The "never appears twice" invariant required three touchpoints.** Selected files' cross-reference entries are excluded in three places — the active-items build (step 2 of `_update_stability`), the cross-ref seeding pass (`_seed_cross_reference_items`), and rebuild's step 7 swap. All three must agree or selected files end up both as file: (full content) and doc:/symbol: (index block) in the tracker. Pinned by explicit tests for each path.

- **Mode switch cleanup ordering.** `switch_mode` calls `_remove_cross_reference_items` BEFORE swapping trackers. The removal strips items matching the OLD mode's opposite prefix (doc: in code mode, symbol: in doc mode) from the current tracker. After the swap, the new mode's tracker starts clean. Tests pin this — a naive implementation that swapped first then tried to strip would remove the wrong prefix.

- **`_doc_index._ref_index` is the reference graph contract.** Both lazy init (2.8.2i) and rebuild (2.8.2h) reach into this attribute. `DocReferenceIndex` exposes the same `file_ref_count` + `connected_components` protocol as `SymbolIndex._ref_index`, so the shared `initialize_with_keys` clustering algorithm works uniformly.

- **`initialize_with_keys` vs `initialize_from_reference_graph`.** The older `initialize_from_reference_graph` hardcodes `symbol:` prefix. Layer 2.8.2i switched lazy init to use `initialize_with_keys` with an explicit prefix parameter. Rebuild was already using the keyed variant from its 2.8.2h pass. The older method is kept for backward compatibility but every new caller should use the keyed variant.

## Layer 2.8 — next sub-commits

**2.8.3 — SVG extractor.** Adds architecture diagrams and flowcharts to the doc index. Specs4/2-indexing/document-index.md § "SVG Extraction" spec is detailed. Builds containment tree from bounding boxes, attaches text to smallest containing box, uses three-level labeling (explicit label > single-text box > neutral identifier), filters Inkscape auto-generated IDs, captures long text (>80 chars) as prose blocks for enrichment.

Independent of 2.8.4. Can ship before or after.

**2.8.4 — Keyword enrichment via KeyBERT.** Adds the disambiguation layer. specs4/2-indexing/keyword-enrichment.md. Optional dependency (`[project.optional-dependencies].docs`). Lazy model load, batched extraction, TF-IDF fallback for short sections, corpus-aware document-frequency filter, graceful degradation when KeyBERT unavailable.

Independent of 2.8.3. When both land, SVG prose blocks flow through the enrichment pipeline alongside markdown sections.

**2.8.3 — SVG extractor.** Adds architecture diagrams and flowcharts to doc mode.

- `src/ac_dc/doc_index/extractors/svg.py` — implement the design in specs4/2-indexing/document-index.md § SVG Extraction
  - Containment model: parse rects/circles/ellipses/polygons/paths, compute root-canvas bounding boxes via transform composition (translate, scale, rotate, matrix), build containment tree by sorting shapes by area descending
  - Text attachment: each text element attached to smallest containing box; root-level texts become document leaves
  - Labeling: three-level priority (aria-label > inkscape:label > filtered id, then single-text-in-box, then neutral `(box)` identifier for multi-text unlabeled boxes). Auto-id regex: `^(g|group|path|rect|text|layer)(_?)\d+$`
  - Long text handling: elements > 80 chars captured as prose blocks attached to the containing box (or at document root when no container exists). Prose blocks carry their raw text so 2.8.4's enrichment pipeline can process them. The outline structure itself emits `[prose]` leaves indented under their container; the text attachment lets enrichment round-trip keywords back without a separate data path
  - Reading order: y-then-x sort at each nesting level (applies to prose blocks too — prose is emitted in reading order alongside its sibling boxes and labels)
  - Shape-less fallback: spatial clustering by y-gap (2× median line height)
  - Image links (`<a xlink:href=...>`) captured as `DocLink` with non-fragment filtering
  - `DocOutline.prose_blocks` field — list of `{text, container_id, start_line?}` entries accessible to the enricher. Parallel to how markdown sections carry their text for enrichment
- `src/ac_dc/doc_index/models.py` — add `DocProseBlock` dataclass (text, container_heading_id, keywords list) and a `prose_blocks` field on `DocOutline`
- `src/ac_dc/doc_index/extractors/__init__.py` — register `.svg` → `SvgExtractor`
- `tests/test_doc_index_svg_extractor.py` — test the documented cases from specs4 (labeled box nesting example, shape-less clustering example), plus edge cases (nested transforms, rotated shapes, path bounding boxes, anonymous group transparency, prose block capture with correct container attachment, prose at document root when no container, polygon containment, circle containment)
- `src/ac_dc/doc_index/index.py` — SVG files with zero prose blocks skip the enrichment queue (common case — architecture diagrams are almost all short labels). Files with prose blocks go through enrichment just like markdown. Replace the originally-planned `is_enrichable(path)` with a per-outline check: `needs_enrichment(outline)` returns True when the outline has any markdown sections above `min_section_chars` OR any prose blocks
- `src/ac_dc/doc_index/compact_format.py` — render prose blocks as `[prose] (kw1, kw2, kw3)` entries indented under their container box, matching the indentation level used for label leaves. Unenriched prose (before 2.8.4 completes or when KeyBERT unavailable) renders as `[prose]` alone

After 2.8.3, doc mode includes architecture diagrams. Prose-bearing SVGs (rare — usually only in annotated tutorial diagrams) are ready for enrichment as soon as 2.8.4 lands. Label-only SVGs (the common case) produce enrichment-free outlines that ship immediately. Cross-reference mode in code mode shows markdown+SVG outlines alongside code symbols.

**2.8.4 — Keyword enrichment via KeyBERT.** Delivered across three sub-commits:

- **2.8.4a — enricher scaffold** (delivered). `src/ac_dc/doc_index/keyword_enricher.py` — `KeywordEnricher` class with tristate availability flag, lazy model load, `EnrichmentConfig` frozen dataclass. `is_available()` probes keybert + sentence-transformers imports with broad exception catch (ImportError, RuntimeError for CUDA / version mismatch). `ensure_loaded()` constructs the KeyBERT instance; idempotent, degrades cleanly on construction failure (network, invalid model, rate limit). `tests/test_doc_index_keyword_enricher.py` pins construction, probing + caching, load failure paths, code stripping helpers.

- **2.8.4b — extraction pipeline** (delivered). Same module — `enrich_outline` with the full batched pipeline: unit collection (markdown sections sliced from source via `start_line`, SVG prose blocks inline), code stripping (fenced + inline spans), batched KeyBERT extraction with MMR diversity, TF-IDF fallback for short units (requires scikit-learn, no-op without), corpus-aware document-frequency filter with bigram-constituent rule, adaptive top-n (+2 for sections ≥15 lines), min-score filter, keyword-less-section fallback (retains top keyword even if filtered). Graceful degradation when KeyBERT is unavailable (returns outline unchanged). Tests pin all of: happy-path extraction, eligibility filter, code stripping, min-score filter, adaptive top-n, prose block enrichment, mixed batches, corpus filter with three cross-section scenarios (pervasive unigram dropped, bigram survives via non-pervasive constituent, never-leave-empty fallback), KeyBERT exception handling.

- **2.8.4c — orchestrator integration** (delivered, commit `0a5c646`). `DocIndex` gains `needs_enrichment`, `queue_enrichment`, `enrich_single_file`. `LLMService._run_enrichment_background` chains after structural extraction — eager model load, per-file source-text read + enrich in the aux executor, per-file progress events (`doc_enrichment_queued`, `doc_enrichment_file_done`, `doc_enrichment_complete`), `await asyncio.sleep(0)` between files so WebSocket traffic flows. Cache entries re-tagged with `keyword_model` so structure-only lookups hit across mode switches and model-specific lookups correctly miss when the user changes their configured model. `tests/test_doc_index_enrichment.py` covers `needs_enrichment` (empty outlines, nested headings, prose blocks above/below threshold, mixed states), `queue_enrichment` (no enricher → empty, sorted ordering, excludes already-enriched, mixed states), `enrich_single_file` (no enricher / unknown file / missing on disk → None, mutates outline in place, re-caches with model name, bumps signature hash, subsequent structure-only lookups still hit, different-model lookup misses).

- **2.8.4d — enrichment UX surface** (delivered across `652d706` and `33f9fde`). Two sub-commits covering the frontend surface that exposes doc-index work to the user. **Step 2a (commit `652d706`)** — new `ac-doc-index-progress` overlay component alongside the existing compaction overlay. Handles both phases on a dedicated `doc-index-progress` window channel: indeterminate spinner for structural extraction (`doc_index` stage), determinate percent bar + per-file labels for enrichment (`doc_enrichment_queued` / `doc_enrichment_file_done` / `doc_enrichment_complete`). Success fades after 800ms; error (`doc_index_error`) lingers for 5s then fades. The app shell filters doc-index stages out of the startup-overlay path so they don't re-show the already-dismissed overlay on long builds; they're re-dispatched under the new channel instead. Compaction overlay re-anchored so the doc-index overlay (displayed longer and more frequently) takes the top slot. 48 tests in `webapp/src/doc-index-progress.test.js` cover every stage transition, timing, event filtering (compaction / url_fetch events ignored), defensive input handling (null detail, non-numeric percent), and cleanup (listener + timer removal on disconnect). **Step 2b (commit `33f9fde`)** — one-shot "enrichment unavailable" warning toast when KeyBERT probe or model load fails. Backend additions: `enrichment_status` field on `get_current_state()` snapshot (so reconnecting clients learn on first paint), plus a `_broadcast_enrichment_status()` helper that piggybacks on `modeChanged` (carries mode + cross_ref + status in one event so the frontend's existing handler routes it). Both `"unavailable"` paths in `_run_enrichment_background` (probe failure, model load failure) fire the broadcast so mid-session clients — e.g., browser reload during a build that subsequently fails model load — learn without polling. Frontend `_maybeShowEnrichmentUnavailableToast(status)` helper no-ops for other status values and suppresses repeats via `ac-dc-enrichment-unavailable-shown` localStorage flag (condition is effectively permanent for the session — repeated toasts would be noise). Wired into `_fetchCurrentState` (initial snapshot) and `_onModeChanged` (mid-session). Toast points users at `pip install 'ac-dc[docs]'`. 10 frontend tests pin the state dispatch, filtering by status, localStorage suppression across reloads, absent-field tolerance for older backends, and storage-error resilience (private-browsing quirks). 4 backend tests cover snapshot inclusion and broadcast firing on both failure paths.

**Post-2.8.4 audit (current state):**

- Optional dependency declaration in `pyproject.toml` — ✅ delivered. The `docs` extra already includes `keybert`, `sentence-transformers`, `scikit-learn`, and `huggingface_hub` alongside the document-conversion dependencies.
- Backend pipeline (2.8.4a, 2.8.4b, 2.8.4c) — ✅ delivered. Scaffold, extraction, orchestrator integration all in place.
- Backend emits progress events — ✅ delivered. Stages `doc_index`, `doc_enrichment_queued`, `doc_enrichment_file_done`, `doc_enrichment_complete` fire from `_build_doc_index_background` / `_run_enrichment_background`.

**Follow-up work (in progress, tracked in IMPLEMENTATION_NOTES.md § Keyword enrichment UX completion plan):**

- **Step 1 — Tristate `enrichment_status`.** Current `doc_index_enriched` boolean can't distinguish "KeyBERT unavailable" from "still building" — both report False. Add `enrichment_status` field with values `"unavailable" | "pending" | "building" | "complete"` to `get_mode()`. Flip appropriately in `_run_enrichment_background`'s early-return branches.
- **Step 2a — Frontend progress overlay.** New LitElement `ac-doc-index-progress` modeled after `ac-compaction-progress`, stacking above it so both kinds of progress are visible. Intercept `startupProgress` events with doc-index stages in `app-shell.js` so they route to the overlay rather than the (already-dismissed) startup screen.
- **Step 2b — One-shot unavailable toast.** When `enrichment_status === "unavailable"` on state load or mode change, show a warning toast pointing users at `pip install 'ac-dc[docs]'`. Use a localStorage flag to suppress repeats within a browser session.

**Originally-planned items that are now deferred indefinitely:**

- Frontend app-shell and dialog updates to show a header progress bar during enrichment. Replaced by the stacking floating overlay approach (B in the decision trail) for visual consistency with the existing compaction progress bar.
- `src/ac_dc/doc_index/keyword_enricher.py` — implement specs4/2-indexing/keyword-enrichment.md
  - Lazy model load with tristate `_available` flag (not-checked / True / False)
  - Cache probe via `huggingface_hub.try_to_load_from_cache` for distinct "downloading" vs "loading" progress messages
  - Batched extraction — single call to `KeyBERT.extract_keywords` with all eligible text (markdown sections AND SVG prose blocks) for transformer batch encoding. Prose blocks and sections mix freely in the batch; the enricher doesn't care about the source
  - MMR diversity via `diversity=0.5` parameter
  - Code stripping before extraction (fenced blocks, inline spans) — markdown only, prose blocks pass through verbatim
  - Corpus-aware document-frequency filter (max_doc_freq threshold) — corpus is all eligible text from the document (sections + prose blocks)
  - TF-IDF fallback for sections and prose blocks below `tfidf_fallback_chars`
  - Adaptive top_n (+2 for sections ≥ 15 lines) — applies to prose blocks too when they're long enough
  - Keywords attached back to source: markdown → `DocHeading.keywords`; SVG → `DocProseBlock.keywords`. The formatter reads from whichever field the outline carries
- `src/ac_dc/doc_index/index.py` — two-phase extraction. Structure-only pass (instant, always available), enrichment pass (per-file, yields between files via `await asyncio.sleep(0)`). `enrich_single_file` method for the per-file background loop, replaces unenriched cache entry in-place. `queue_enrichment` method returns files needing enrichment for the caller to drive — includes SVG files that have prose blocks, skips SVG files that are label-only
- `src/ac_dc/llm_service.py` — background enrichment loop after structure extraction. Progress events via `compactionEvent` with stages `doc_enrichment_queued`, `doc_enrichment_file_done`, `doc_enrichment_complete`. Eager pre-initialization of the model so first mode switch isn't blocked
- `tests/test_doc_index_keyword_enricher.py` — batched extraction (mixed sections + prose blocks in one batch), MMR diversity, code stripping (markdown only), corpus filter with mixed-source corpus, TF-IDF fallback, graceful degradation when KeyBERT unavailable, SVG prose block enrichment round-trip (extract → enrich → formatter output contains keywords)
- Frontend — app-shell and dialog updates to show header progress bar during enrichment (not a blocking overlay, specs4/5-webapp/shell.md § doc enrichment progress)

After 2.8.4, document mode reaches feature parity with the spec. Repeated subheadings (API references, spec suites) become disambiguated via keywords. Annotated SVG diagrams (flowcharts with paragraph-style explanations, architecture docs with prose callouts) surface their prose content as searchable keywords in the outline rather than appearing as opaque `[prose]` placeholders.

### Dependencies between commits

- 2.8.1 has no dependencies; can ship standalone
- 2.8.2 depends on 2.8.1 (wires the module into the service)
- 2.8.3 depends on 2.8.1 (adds a new extractor to the registry)
- 2.8.4 depends on 2.8.1 (enriches the outlines the extractor produced)

2.8.3 and 2.8.4 are independent of each other. Ship in any order after 2.8.2.

### Deferred for later (not part of 2.8)

- SVG indexing progress bar in frontend — enrichment progress only, since SVG doesn't enrich
- Alt+D keyboard shortcut for mode toggle — nice-to-have, specs4 doesn't mention it
- Doc convert integration — already a separate feature (Layer 4.6); doc index picks up converted `.md` files automatically
- Incremental re-enrichment on file save — users manually editing markdown get lazy re-extraction on next chat; specs4 calls this out as acceptable

### Resumption protocol for 2.8

A contributor restarting mid-Layer-2.8 reads this section, identifies which sub-commit is in progress from the file tree (e.g., `doc_index/extractors/markdown.py` present means 2.8.1 is underway), runs the relevant test file to see what's passing, and continues from the last known good state.

---

