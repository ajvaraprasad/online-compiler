'use client';

import React, { useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useIDEStore, type Diagnostic } from '@/store/useIDEStore';
import { LANGUAGE_MONACO, DEFAULT_CODE } from '@/lib/api';
import { validationManager } from '@/lib/validation';
import { registerCompletionProviders } from '@/lib/completions';
import { setEditorInstance } from '@/components/ide/ProblemsPanel';

// ─── Hover Documentation ────────────────────────────────────────────────────

const HOVER_DOCS: Record<string, Record<string, { description: string; syntax?: string; example?: string }>> = {
  python: {
    'print': { description: 'Prints the given object(s) to the console', syntax: 'print(*objects, sep=" ", end="\\n", file=sys.stdout, flush=False)', example: 'print("Hello, World!")\nprint(1, 2, 3)' },
    'def': { description: 'Defines a function', syntax: 'def function_name(parameters):\n    body', example: 'def greet(name):\n    return f"Hello, {name}!"' },
    'class': { description: 'Defines a class', syntax: 'class ClassName(BaseClass):\n    def __init__(self, params):\n        ...', example: 'class Dog:\n    def __init__(self, name):\n        self.name = name' },
    'if': { description: 'Conditional statement', syntax: 'if condition:\n    ...\nelif condition:\n    ...\nelse:\n    ...', example: 'if x > 0:\n    print("positive")' },
    'for': { description: 'For loop - iterates over a sequence', syntax: 'for variable in iterable:\n    ...', example: 'for i in range(10):\n    print(i)' },
    'while': { description: 'While loop - repeats while condition is true', syntax: 'while condition:\n    ...', example: 'while x > 0:\n    x -= 1' },
    'import': { description: 'Imports a module', syntax: 'import module\nfrom module import name', example: 'import os\nfrom datetime import datetime' },
    'return': { description: 'Returns a value from a function', syntax: 'return [expression]', example: 'def add(a, b):\n    return a + b' },
    'try': { description: 'Exception handling block', syntax: 'try:\n    ...\nexcept Exception as e:\n    ...\nfinally:\n    ...', example: 'try:\n    result = 1 / 0\nexcept ZeroDivisionError:\n    print("Cannot divide by zero")' },
    'lambda': { description: 'Creates an anonymous function', syntax: 'lambda arguments: expression', example: 'square = lambda x: x ** 2' },
    'len': { description: 'Returns the length of an object', syntax: 'len(s)', example: 'len([1, 2, 3])  # 3' },
    'range': { description: 'Generates a sequence of numbers', syntax: 'range(stop)\nrange(start, stop[, step])', example: 'list(range(5))  # [0, 1, 2, 3, 4]' },
    'input': { description: 'Reads a line from standard input', syntax: 'input(prompt="")', example: 'name = input("Enter name: ")' },
  },
  javascript: {
    'console': { description: 'Console object for debugging and logging', syntax: 'console.log(data)', example: 'console.log("Hello!")' },
    'function': { description: 'Declares a function', syntax: 'function name(params) {\n    // body\n}', example: 'function greet(name) {\n    return `Hello, ${name}!`;\n}' },
    'const': { description: 'Declares a block-scoped constant variable', syntax: 'const name = value;', example: 'const PI = 3.14159;' },
    'let': { description: 'Declares a block-scoped variable', syntax: 'let name = value;', example: 'let count = 0;' },
    'async': { description: 'Declares an asynchronous function', syntax: 'async function name(params) {\n    // body\n}', example: 'async function fetchData() {\n    const res = await fetch(url);\n}' },
    'await': { description: 'Waits for a Promise to resolve', syntax: 'const result = await promise;', example: 'const data = await fetch(url);' },
    'class': { description: 'Declares a class', syntax: 'class Name {\n    constructor(params) { ... }\n}', example: 'class Animal {\n    constructor(name) {\n        this.name = name;\n    }\n}' },
    'return': { description: 'Returns a value from a function', syntax: 'return expression;', example: 'return a + b;' },
    'if': { description: 'Conditional statement', syntax: 'if (condition) {\n    ...\n} else {\n    ...\n}', example: 'if (x > 0) {\n    console.log("positive");\n}' },
    'for': { description: 'For loop', syntax: 'for (init; condition; increment) {\n    ...\n}', example: 'for (let i = 0; i < 10; i++) {\n    console.log(i);\n}' },
    'map': { description: 'Creates a new array with results of calling a function on every element', syntax: 'array.map(callback)', example: '[1, 2, 3].map(x => x * 2);' },
    'filter': { description: 'Creates a new array with elements that pass a test', syntax: 'array.filter(callback)', example: '[1, 2, 3, 4].filter(x => x > 2);' },
  },
  c: {
    'printf': { description: 'Prints formatted output to stdout', syntax: 'int printf(const char *format, ...);', example: 'printf("Hello, %s!\\n", name);' },
    'scanf': { description: 'Reads formatted input from stdin', syntax: 'int scanf(const char *format, ...);', example: 'scanf("%d", &num);' },
    'malloc': { description: 'Allocates dynamic memory', syntax: 'void* malloc(size_t size);', example: 'int *arr = (int*)malloc(10 * sizeof(int));' },
    'free': { description: 'Frees dynamically allocated memory', syntax: 'void free(void *ptr);', example: 'free(arr);' },
    'sizeof': { description: 'Returns the size of a type or variable in bytes', syntax: 'sizeof(type)', example: 'printf("%zu", sizeof(int));' },
    'int': { description: 'Integer type (typically 4 bytes)', syntax: 'int variable_name = value;', example: 'int count = 0;' },
  },
  cpp: {
    'cout': { description: 'Standard output stream object', syntax: 'std::cout << data;', example: 'std::cout << "Hello!" << std::endl;' },
    'cin': { description: 'Standard input stream object', syntax: 'std::cin >> variable;', example: 'int x;\nstd::cin >> x;' },
    'vector': { description: 'Dynamic array container', syntax: 'std::vector<type> name;', example: 'std::vector<int> nums = {1, 2, 3};' },
    'string': { description: 'String class', syntax: 'std::string name = "value";', example: 'std::string greeting = "Hello";' },
    'class': { description: 'Declares a class', syntax: 'class Name {\npublic:\n    // members\n};', example: 'class Dog {\npublic:\n    std::string name;\n};' },
  },
  java: {
    'System': { description: 'System class for standard I/O', syntax: 'System.out.println(data);', example: 'System.out.println("Hello!");' },
    'public': { description: 'Access modifier - visible to all classes', syntax: 'public class Name { ... }', example: 'public class Main {\n    public static void main(String[] args) { }\n}' },
    'static': { description: 'Modifier for class-level members', syntax: 'static type name;', example: 'public static void main(String[] args) { }' },
    'String': { description: 'String class for text handling', syntax: 'String name = "value";', example: 'String greeting = "Hello";' },
    'class': { description: 'Declares a class', syntax: 'class Name {\n    // fields and methods\n}', example: 'class Person {\n    String name;\n}' },
  },
};

// ─── Diagnostics → Monaco Markers ───────────────────────────────────────────

function diagnosticsToMarkers(diagnostics: Diagnostic[], monaco: any): any[] {
  return diagnostics.map(d => ({
    severity:
      d.severity === 'error'
        ? monaco.MarkerSeverity.Error
        : d.severity === 'warning'
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
    startLineNumber: d.line,
    startColumn: d.column,
    endLineNumber: d.endLine || d.line,
    endColumn: d.endColumn || d.column + 1,
    message: d.message,
    source: d.source,
  }));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CodeEditor() {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const { tabs, activeTabId, language, updateTabContent, setDiagnostics, setValidationStatus } = useIDEStore();
  const activeTab = tabs.find(t => t.id === activeTabId);

  // ─── Apply diagnostics to Monaco editor + update store ────────────────
  const applyDiagnostics = useCallback((diagnostics: Diagnostic[]) => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    // 1. Set Monaco markers (red squiggly underlines, gutter icons, overview ruler)
    const markers = diagnosticsToMarkers(diagnostics, monaco);
    monaco.editor.setModelMarkers(model, 'codeforge-validator', markers);

    // 2. Update the store so ProblemsPanel can read them
    setDiagnostics(diagnostics);
  }, [setDiagnostics]);

  // ─── Schedule validation using the ValidationManager ──────────────────
  const scheduleValidation = useCallback((code: string, lang: string) => {
    setValidationStatus('validating');
    validationManager.scheduleValidation(code, lang, (diagnostics) => {
      applyDiagnostics(diagnostics);
    });
  }, [applyDiagnostics, setValidationStatus]);

  // ─── Editor Mount ─────────────────────────────────────────────────────
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register the editor instance globally so ProblemsPanel can navigate to errors
    setEditorInstance(editor);

    // Set editor options
    editor.updateOptions({
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: true, scale: 1 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: {
        bracketPairs: true,
        indentation: true,
      },
      padding: { top: 8 },
      lineHeight: 22,
      tabSize: 4,
      wordWrap: 'on',
      automaticLayout: true,
      suggest: {
        showKeywords: true,
        showSnippets: true,
      },
      quickSuggestions: {
        other: true,
        comments: false,
        strings: true,
      },
    });

    // ─── Configure JavaScript/TypeScript Diagnostics ────────────────────────
    // Enable Monaco's built-in JS validation
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: true,
      noEmit: true,
      strict: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
    });

    // ─── Register Completion Item Providers (IntelliSense) ──────────────────
    registerCompletionProviders(monaco);

    // ─── Register Hover Providers ───────────────────────────────────────────
    const languages = ['python', 'javascript', 'c', 'cpp', 'java'];

    languages.forEach((lang) => {
      const monacoLang = lang === 'cpp' ? 'cpp' :
                         lang === 'javascript' ? 'javascript' :
                         lang === 'python' ? 'python' :
                         lang === 'java' ? 'java' : 'c';

      monaco.languages.registerHoverProvider(monacoLang, {
        provideHover: (model: any, position: any) => {
          const word = model.getWordAtPosition(position);
          if (!word) return null;

          const wordText = word.word;
          const docs = HOVER_DOCS[lang]?.[wordText];

          if (!docs) return null;

          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          let contents: Array<{ value: string }> = [
            { value: `**${wordText}**\n\n${docs.description}` },
          ];

          if (docs.syntax) {
            contents.push({ value: `**Syntax:**\n\`\`\`${lang}\n${docs.syntax}\n\`\`\`` });
          }

          if (docs.example) {
            contents.push({ value: `**Example:**\n\`\`\`${lang}\n${docs.example}\n\`\`\`` });
          }

          return { range, contents };
        },
      });
    });

    // ─── Define Custom Dark Theme ───────────────────────────────────────────
    monaco.editor.defineTheme('codeforge-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'cba6f7' },
        { token: 'string', foreground: 'a6e3a1' },
        { token: 'number', foreground: 'fab387' },
        { token: 'type', foreground: 'f9e2af' },
        { token: 'function', foreground: '89b4fa' },
        { token: 'variable', foreground: 'cdd6f4' },
        { token: 'operator', foreground: '89dceb' },
        { token: 'delimiter', foreground: '6c7086' },
      ],
      colors: {
        'editor.background': '#1e1e2e',
        'editor.foreground': '#cdd6f4',
        'editor.lineHighlightBackground': '#313244',
        'editor.selectionBackground': '#45475a',
        'editorCursor.foreground': '#f5e0dc',
        'editorIndentGuide.background': '#313244',
        'editorIndentGuide.activeBackground': '#45475a',
        'editorLineNumber.foreground': '#6c7086',
        'editorLineNumber.activeForeground': '#cdd6f4',
        'editor.inactiveSelectionBackground': '#313244',
        'editorWhitespace.foreground': '#45475a',
        'editorBracketMatch.background': '#45475a',
        'editorBracketMatch.border': '#89b4fa',
        'editorOverviewRuler.border': '#313244',
        'minimap.background': '#181825',
        // Error and warning squiggly lines
        'editorError.foreground': '#f38ba8',
        'editorError.background': '#f38ba815',
        'editorWarning.foreground': '#f9e2af',
        'editorWarning.background': '#f9e2af15',
        'editorInfo.foreground': '#89b4fa',
        'editorInfo.background': '#89b4fa15',
        'editorHint.foreground': '#94e2d5',
        'editorHint.background': '#94e2d515',
        // Gutter markers
        'editorGutter.modifiedBackground': '#f9e2af',
        'editorGutter.addedBackground': '#a6e3a1',
        'editorGutter.deletedBackground': '#f38ba8',
        // Overview ruler markers — red marks on scrollbar
        'editorOverviewRuler.errorForeground': '#f38ba8',
        'editorOverviewRuler.warningForeground': '#f9e2af',
        'editorOverviewRuler.infoForeground': '#89b4fa',
        // Problems pane
        'problemsErrorIcon.foreground': '#f38ba8',
        'problemsWarningIcon.foreground': '#f9e2af',
        'problemsInfoIcon.foreground': '#89b4fa',
        // Squiggly line styling
        'editorUnnecessaryCode.opacity': '#00000066',
        'editorUnnecessaryCode.border': '#585b70',
        // Marker navigation
        'editorMarkerNavigationError.background': '#f38ba8',
        'editorMarkerNavigationWarning.background': '#f9e2af',
        'editorMarkerNavigationInfo.background': '#89b4fa',
        'editorMarkerNavigation.background': '#181825',
      },
    });

    monaco.editor.setTheme('codeforge-dark');

    // ─── Initial Validation ─────────────────────────────────────────────────
    const model = editor.getModel();
    if (model) {
      const currentCode = model.getValue();
      const currentLang = useIDEStore.getState().language;
      scheduleValidation(currentCode, currentLang);

      // Listen for model content changes → re-validate with debounce
      model.onDidChangeContent(() => {
        const code = model.getValue();
        const lang = useIDEStore.getState().language;
        scheduleValidation(code, lang);
      });
    }
  }, [scheduleValidation]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (activeTabId && value !== undefined) {
      updateTabContent(activeTabId, value);
    }
  }, [activeTabId, updateTabContent]);

  // Re-validate when language changes
  useEffect(() => {
    if (editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const code = model.getValue();
        scheduleValidation(code, language);
      }
    }
  }, [language, scheduleValidation]);

  // Cleanup validation on unmount
  useEffect(() => {
    return () => {
      validationManager.cancel();
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
      }
      // Ctrl+Shift+M — Toggle Problems panel
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        useIDEStore.getState().toggleProblemsPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!activeTab) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#1e1e2e]">
        <div className="text-center space-y-4">
          <div className="text-6xl font-bold text-[#313244]">{'<>'}</div>
          <h2 className="text-xl text-[#6c7086]">CodeForge IDE</h2>
          <p className="text-sm text-[#585b70]">
            Create a new file or open an existing one to start coding
          </p>
          <div className="flex gap-3 justify-center mt-6">
            {['python', 'javascript', 'cpp', 'c', 'java'].map((lang) => (
              <button
                key={lang}
                onClick={() => {
                  const { addTab } = useIDEStore.getState();
                  const ext = lang === 'python' ? '.py' : lang === 'javascript' ? '.js' : lang === 'cpp' ? '.cpp' : lang === 'c' ? '.c' : '.java';
                  addTab(`main${ext}`, lang, DEFAULT_CODE[lang]);
                }}
                className="px-3 py-1.5 bg-[#313244] text-[#cdd6f4] text-xs rounded-md hover:bg-[#45475a] transition-colors border border-[#45475a]"
              >
                {lang.charAt(0).toUpperCase() + lang.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const monacoLanguage = LANGUAGE_MONACO[activeTab.language] || 'plaintext';

  return (
    <div className="flex-1 overflow-hidden">
      <Editor
        height="100%"
        language={monacoLanguage}
        value={activeTab.content}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        theme="codeforge-dark"
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          padding: { top: 8 },
          lineHeight: 22,
          tabSize: 4,
          wordWrap: 'on',
          automaticLayout: true,
        }}
        loading={
          <div className="flex items-center justify-center h-full bg-[#1e1e2e]">
            <div className="text-[#6c7086] text-sm">Loading editor...</div>
          </div>
        }
      />
    </div>
  );
}
