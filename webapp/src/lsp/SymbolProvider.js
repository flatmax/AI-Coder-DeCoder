/**
 * Monaco LSP provider bridge.
 * 
 * Registers Monaco language providers that call back to the Python server
 * via JSON-RPC for hover, definition, references, and completions.
 */

/**
 * Register all symbol providers for Monaco.
 * 
 * @param {Function} rpcCall - Function to make JSON-RPC calls (e.g., this.call from JRPCClient)
 * @param {string[]} languages - Languages to register providers for
 */
export function registerSymbolProviders(rpcClient, languages = ['python', 'javascript', 'typescript']) {
  if (!window.monaco) {
    console.warn('Monaco not loaded, cannot register symbol providers');
    return;
  }

  for (const language of languages) {
    registerHoverProvider(rpcClient, language);
    registerDefinitionProvider(rpcClient, language);
    registerReferencesProvider(rpcClient, language);
    registerCompletionProvider(rpcClient, language);
  }
}

/**
 * Register hover provider for a language.
 */
function registerHoverProvider(rpcClient, language) {
  window.monaco.languages.registerHoverProvider(language, {
    async provideHover(model, position) {
      try {
        const filePath = getFilePath(model);
        if (!filePath) return null;

        const response = await rpcClient.call['LiteLLM.lsp_get_hover'](
          filePath,
          position.lineNumber,
          position.column
        );
        const result = response ? Object.values(response)[0] : null;

        if (result && result.contents) {
          return {
            contents: [{ value: result.contents }]
          };
        }
      } catch (e) {
        console.error('Hover provider error:', e);
      }
      return null;
    }
  });
}

/**
 * Register definition provider for a language.
 */
function registerDefinitionProvider(rpcClient, language) {
  window.monaco.languages.registerDefinitionProvider(language, {
    async provideDefinition(model, position) {
      try {
        const filePath = getFilePath(model);
        if (!filePath) return null;

        const response = await rpcClient.call['LiteLLM.lsp_get_definition'](
          filePath,
          position.lineNumber,
          position.column
        );
        const result = response ? Object.values(response)[0] : null;

        if (result && result.file && result.range) {
          const targetUri = window.monaco.Uri.file(result.file);
          const startLine = result.range.start_line ?? result.range.start?.line;
          const startCol = result.range.start_col ?? result.range.start?.col ?? 0;
          const endLine = result.range.end_line ?? result.range.end?.line ?? startLine;
          const endCol = result.range.end_col ?? result.range.end?.col ?? startCol;
          
          const targetRange = new window.monaco.Range(
            startLine,
            startCol + 1,
            endLine,
            endCol + 1
          );
          
          // Dispatch event to request file navigation
          window.dispatchEvent(new CustomEvent('lsp-navigate-to-file', {
            detail: {
              file: result.file,
              line: startLine,
              column: startCol + 1
            }
          }));
          
          return {
            uri: targetUri,
            range: targetRange
          };
        }
      } catch (e) {
        console.error('Definition provider error:', e);
      }
      return null;
    }
  });
}

/**
 * Register references provider for a language.
 */
function registerReferencesProvider(rpcClient, language) {
  window.monaco.languages.registerReferenceProvider(language, {
    async provideReferences(model, position, context) {
      try {
        const filePath = getFilePath(model);
        if (!filePath) return [];

        const response = await rpcClient.call['LiteLLM.lsp_get_references'](
          filePath,
          position.lineNumber,
          position.column
        );
        const result = response ? Object.values(response)[0] : null;

        if (Array.isArray(result)) {
          return result.map(loc => ({
            uri: window.monaco.Uri.file(loc.file_path),
            range: new window.monaco.Range(
              loc.line,
              loc.col + 1,
              loc.line,
              loc.col + 1
            )
          }));
        }
      } catch (e) {
        console.error('References provider error:', e);
      }
      return [];
    }
  });
}

/**
 * Register completion provider for a language.
 */
function registerCompletionProvider(rpcClient, language) {
  window.monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['.', '_'],
    
    async provideCompletionItems(model, position) {
      try {
        const filePath = getFilePath(model);
        if (!filePath) return { suggestions: [] };

        // Get the word at current position for prefix
        const word = model.getWordUntilPosition(position);
        const prefix = word ? word.word : '';

        const response = await rpcClient.call['LiteLLM.lsp_get_completions'](
          filePath,
          position.lineNumber,
          position.column,
          prefix
        );
        const result = response ? Object.values(response)[0] : null;

        if (Array.isArray(result)) {
          const suggestions = result.map(item => ({
            label: item.label,
            kind: item.kind,
            detail: item.detail,
            documentation: item.documentation ? { value: item.documentation } : undefined,
            insertText: item.insertText,
            insertTextRules: item.insertText?.includes('$0') 
              ? window.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            sortText: item.sortText,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: word ? word.startColumn : position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column
            }
          }));
          
          return { suggestions };
        }
      } catch (e) {
        console.error('Completion provider error:', e);
      }
      return { suggestions: [] };
    }
  });
}

/**
 * Extract file path from Monaco model URI.
 * 
 * @param {object} model - Monaco text model
 * @returns {string|null} File path or null
 */
function getFilePath(model) {
  const uri = model.uri;
  if (!uri) return null;
  
  // Handle file:// URIs
  if (uri.scheme === 'file') {
    return uri.path;
  }
  
  // Handle custom schemes - try to extract path from model's associated data
  // This may need adjustment based on how files are identified in DiffViewer
  if (model._associatedFilePath) {
    return model._associatedFilePath;
  }
  
  // Fallback: use the path component
  return uri.path || null;
}

/**
 * Associate a file path with a Monaco model.
 * Call this when creating models to enable LSP features.
 * 
 * @param {object} model - Monaco text model
 * @param {string} filePath - Relative file path
 */
export function setModelFilePath(model, filePath) {
  model._associatedFilePath = filePath;
}
