// ─── IntelliSense Auto-Completion Providers for CodeForge IDE ────────────────
// Provides completion items for Python, JavaScript, C, C++, and Java.
// Registered alongside hover providers in CodeEditor.tsx.
// ──────────────────────────────────────────────────────────────────────────────

// ─── Completion Item Interface ───────────────────────────────────────────────

export interface CompletionEntry {
  label: string;
  kind: number; // Monaco CompletionItemKind value
  insertText: string;
  detail: string;
  documentation?: string;
  sortText: string; // Priority: 'a' = keywords, 'b' = functions, 'c' = modules/classes, 'd' = snippets
}

// ─── Python Completions ─────────────────────────────────────────────────────

const PYTHON_KEYWORDS: CompletionEntry[] = [
  { label: 'if', kind: 15, insertText: 'if ${1:condition}:\n\t${2:pass}', detail: 'Conditional statement', sortText: 'a0' },
  { label: 'elif', kind: 15, insertText: 'elif ${1:condition}:\n\t${2:pass}', detail: 'Else-if conditional branch', sortText: 'a0' },
  { label: 'else', kind: 15, insertText: 'else:\n\t${1:pass}', detail: 'Else branch', sortText: 'a0' },
  { label: 'for', kind: 15, insertText: 'for ${1:variable} in ${2:iterable}:\n\t${3:pass}', detail: 'For loop', sortText: 'a0' },
  { label: 'while', kind: 15, insertText: 'while ${1:condition}:\n\t${2:pass}', detail: 'While loop', sortText: 'a0' },
  { label: 'def', kind: 15, insertText: 'def ${1:function_name}(${2:params}):\n\t${3:pass}', detail: 'Define a function', documentation: 'Defines a function with the given name and parameters.', sortText: 'a0' },
  { label: 'class', kind: 15, insertText: 'class ${1:ClassName}(${2:object}):\n\tdef __init__(self${3:, params}):\n\t\t${4:super().__init__()}\n\t\t${5:pass}', detail: 'Define a class', sortText: 'a0' },
  { label: 'import', kind: 15, insertText: 'import ${1:module}', detail: 'Import a module', sortText: 'a0' },
  { label: 'from', kind: 15, insertText: 'from ${1:module} import ${2:name}', detail: 'Import from a module', sortText: 'a0' },
  { label: 'return', kind: 15, insertText: 'return ${1:value}', detail: 'Return a value from a function', sortText: 'a0' },
  { label: 'try', kind: 15, insertText: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}', detail: 'Exception handling block', sortText: 'a0' },
  { label: 'except', kind: 15, insertText: 'except ${1:Exception} as ${2:e}:\n\t${3:pass}', detail: 'Catch an exception', sortText: 'a0' },
  { label: 'finally', kind: 15, insertText: 'finally:\n\t${1:pass}', detail: 'Finally block (always executes)', sortText: 'a0' },
  { label: 'with', kind: 15, insertText: 'with ${1:expression} as ${2:variable}:\n\t${3:pass}', detail: 'Context manager', sortText: 'a0' },
  { label: 'as', kind: 15, insertText: 'as ${1:alias}', detail: 'Alias keyword', sortText: 'a0' },
  { label: 'lambda', kind: 15, insertText: 'lambda ${1:args}: ${2:expression}', detail: 'Anonymous function', sortText: 'a0' },
  { label: 'pass', kind: 15, insertText: 'pass', detail: 'Null statement (placeholder)', sortText: 'a0' },
  { label: 'break', kind: 15, insertText: 'break', detail: 'Break out of a loop', sortText: 'a0' },
  { label: 'continue', kind: 15, insertText: 'continue', detail: 'Continue to next iteration', sortText: 'a0' },
  { label: 'yield', kind: 15, insertText: 'yield ${1:value}', detail: 'Yield a value from a generator', sortText: 'a0' },
  { label: 'raise', kind: 15, insertText: 'raise ${1:Exception}(${2:message})', detail: 'Raise an exception', sortText: 'a0' },
  { label: 'assert', kind: 15, insertText: 'assert ${1:condition}, ${2:message}', detail: 'Assert a condition', sortText: 'a0' },
  { label: 'global', kind: 15, insertText: 'global ${1:variable}', detail: 'Declare a global variable', sortText: 'a0' },
  { label: 'nonlocal', kind: 15, insertText: 'nonlocal ${1:variable}', detail: 'Declare a nonlocal variable', sortText: 'a0' },
  { label: 'del', kind: 15, insertText: 'del ${1:variable}', detail: 'Delete a variable or item', sortText: 'a0' },
  { label: 'and', kind: 15, insertText: 'and ', detail: 'Logical AND operator', sortText: 'a0' },
  { label: 'or', kind: 15, insertText: 'or ', detail: 'Logical OR operator', sortText: 'a0' },
  { label: 'not', kind: 15, insertText: 'not ', detail: 'Logical NOT operator', sortText: 'a0' },
  { label: 'is', kind: 15, insertText: 'is ', detail: 'Identity operator', sortText: 'a0' },
  { label: 'in', kind: 15, insertText: 'in ', detail: 'Membership operator', sortText: 'a0' },
  { label: 'True', kind: 12, insertText: 'True', detail: 'Boolean True value', sortText: 'a0' },
  { label: 'False', kind: 12, insertText: 'False', detail: 'Boolean False value', sortText: 'a0' },
  { label: 'None', kind: 12, insertText: 'None', detail: 'Null value singleton', sortText: 'a0' },
];

const PYTHON_BUILTINS: CompletionEntry[] = [
  { label: 'print', kind: 2, insertText: 'print(${1:object})', detail: 'Prints to console', documentation: 'print(*objects, sep=" ", end="\\n", file=sys.stdout, flush=False)', sortText: 'b0' },
  { label: 'input', kind: 2, insertText: 'input(${1:prompt})', detail: 'Read a line from stdin', documentation: 'input(prompt="") -> str', sortText: 'b0' },
  { label: 'len', kind: 2, insertText: 'len(${1:object})', detail: 'Return the length of an object', sortText: 'b0' },
  { label: 'range', kind: 2, insertText: 'range(${1:stop})', detail: 'Generate a sequence of numbers', documentation: 'range(stop) or range(start, stop[, step])', sortText: 'b0' },
  { label: 'int', kind: 2, insertText: 'int(${1:value})', detail: 'Convert to integer', sortText: 'b0' },
  { label: 'float', kind: 2, insertText: 'float(${1:value})', detail: 'Convert to float', sortText: 'b0' },
  { label: 'str', kind: 2, insertText: 'str(${1:object})', detail: 'Convert to string', sortText: 'b0' },
  { label: 'list', kind: 2, insertText: 'list(${1:iterable})', detail: 'Create a list', sortText: 'b0' },
  { label: 'dict', kind: 2, insertText: 'dict(${1:kwargs})', detail: 'Create a dictionary', sortText: 'b0' },
  { label: 'set', kind: 2, insertText: 'set(${1:iterable})', detail: 'Create a set', sortText: 'b0' },
  { label: 'tuple', kind: 2, insertText: 'tuple(${1:iterable})', detail: 'Create a tuple', sortText: 'b0' },
  { label: 'type', kind: 2, insertText: 'type(${1:object})', detail: 'Return the type of an object', sortText: 'b0' },
  { label: 'isinstance', kind: 2, insertText: 'isinstance(${1:object}, ${2:classinfo})', detail: 'Check if object is an instance of a class', sortText: 'b0' },
  { label: 'enumerate', kind: 2, insertText: 'enumerate(${1:iterable}, start=0)', detail: 'Return enumerate object', sortText: 'b0' },
  { label: 'zip', kind: 2, insertText: 'zip(${1:*iterables})', detail: 'Aggregate elements from iterables', sortText: 'b0' },
  { label: 'map', kind: 2, insertText: 'map(${1:function}, ${2:iterable})', detail: 'Apply function to every item', sortText: 'b0' },
  { label: 'filter', kind: 2, insertText: 'filter(${1:function}, ${2:iterable})', detail: 'Filter items from iterable', sortText: 'b0' },
  { label: 'sorted', kind: 2, insertText: 'sorted(${1:iterable}, key=None, reverse=False)', detail: 'Return a sorted list', sortText: 'b0' },
  { label: 'reversed', kind: 2, insertText: 'reversed(${1:sequence})', detail: 'Return a reverse iterator', sortText: 'b0' },
  { label: 'open', kind: 2, insertText: "open(${1:file}, mode='${2:r}')", detail: 'Open a file', documentation: "open(file, mode='r', buffering=-1, encoding=None, errors=None, newline=None)", sortText: 'b0' },
  { label: 'abs', kind: 2, insertText: 'abs(${1:number})', detail: 'Return absolute value', sortText: 'b0' },
  { label: 'max', kind: 2, insertText: 'max(${1:iterable})', detail: 'Return the largest item', sortText: 'b0' },
  { label: 'min', kind: 2, insertText: 'min(${1:iterable})', detail: 'Return the smallest item', sortText: 'b0' },
  { label: 'sum', kind: 2, insertText: 'sum(${1:iterable}, start=0)', detail: 'Sum of items in an iterable', sortText: 'b0' },
  { label: 'round', kind: 2, insertText: 'round(${1:number}, ${2:ndigits})', detail: 'Round a number', sortText: 'b0' },
  { label: 'any', kind: 2, insertText: 'any(${1:iterable})', detail: 'Return True if any element is true', sortText: 'b0' },
  { label: 'all', kind: 2, insertText: 'all(${1:iterable})', detail: 'Return True if all elements are true', sortText: 'b0' },
  { label: 'hex', kind: 2, insertText: 'hex(${1:number})', detail: 'Convert to hexadecimal string', sortText: 'b0' },
  { label: 'oct', kind: 2, insertText: 'oct(${1:number})', detail: 'Convert to octal string', sortText: 'b0' },
  { label: 'bin', kind: 2, insertText: 'bin(${1:number})', detail: 'Convert to binary string', sortText: 'b0' },
  { label: 'chr', kind: 2, insertText: 'chr(${1:i})', detail: 'Return character for Unicode code point', sortText: 'b0' },
  { label: 'ord', kind: 2, insertText: 'ord(${1:character})', detail: 'Return Unicode code point for character', sortText: 'b0' },
  { label: 'id', kind: 2, insertText: 'id(${1:object})', detail: 'Return identity of an object', sortText: 'b0' },
  { label: 'super', kind: 2, insertText: 'super()', detail: 'Return a proxy object for parent class', sortText: 'b0' },
  { label: 'property', kind: 2, insertText: 'property(${1:fget}, ${2:fset}, ${3:fdel}, ${4:doc})', detail: 'Property decorator', sortText: 'b0' },
  { label: 'staticmethod', kind: 2, insertText: 'staticmethod(${1:function})', detail: 'Static method decorator', sortText: 'b0' },
  { label: 'classmethod', kind: 2, insertText: 'classmethod(${1:function})', detail: 'Class method decorator', sortText: 'b0' },
  { label: 'hash', kind: 2, insertText: 'hash(${1:object})', detail: 'Return hash value of an object', sortText: 'b0' },
  { label: 'repr', kind: 2, insertText: 'repr(${1:object})', detail: 'Return string representation', sortText: 'b0' },
  { label: 'format', kind: 2, insertText: 'format(${1:value}, ${2:format_spec})', detail: 'Format a value', sortText: 'b0' },
  { label: 'dir', kind: 2, insertText: 'dir(${1:object})', detail: 'Return list of attributes', sortText: 'b0' },
  { label: 'vars', kind: 2, insertText: 'vars(${1:object})', detail: 'Return __dict__ attribute', sortText: 'b0' },
  { label: 'help', kind: 2, insertText: 'help(${1:object})', detail: 'Interactive help system', sortText: 'b0' },
  { label: 'hasattr', kind: 2, insertText: 'hasattr(${1:object}, ${2:name})', detail: 'Check if object has attribute', sortText: 'b0' },
  { label: 'getattr', kind: 2, insertText: 'getattr(${1:object}, ${2:name}, ${3:default})', detail: 'Get named attribute', sortText: 'b0' },
  { label: 'setattr', kind: 2, insertText: 'setattr(${1:object}, ${2:name}, ${3:value})', detail: 'Set named attribute', sortText: 'b0' },
  { label: 'delattr', kind: 2, insertText: 'delattr(${1:object}, ${2:name})', detail: 'Delete named attribute', sortText: 'b0' },
  { label: 'callable', kind: 2, insertText: 'callable(${1:object})', detail: 'Check if object is callable', sortText: 'b0' },
  { label: 'iter', kind: 2, insertText: 'iter(${1:object})', detail: 'Return an iterator object', sortText: 'b0' },
  { label: 'next', kind: 2, insertText: 'next(${1:iterator}, ${2:default})', detail: 'Retrieve next item from iterator', sortText: 'b0' },
];

const PYTHON_MODULES: CompletionEntry[] = [
  { label: 'os', kind: 9, insertText: 'os', detail: 'Operating system interface', sortText: 'c0' },
  { label: 'sys', kind: 9, insertText: 'sys', detail: 'System-specific parameters', sortText: 'c0' },
  { label: 'json', kind: 9, insertText: 'json', detail: 'JSON encoder and decoder', sortText: 'c0' },
  { label: 're', kind: 9, insertText: 're', detail: 'Regular expressions', sortText: 'c0' },
  { label: 'math', kind: 9, insertText: 'math', detail: 'Mathematical functions', sortText: 'c0' },
  { label: 'random', kind: 9, insertText: 'random', detail: 'Random number generation', sortText: 'c0' },
  { label: 'datetime', kind: 9, insertText: 'datetime', detail: 'Date and time types', sortText: 'c0' },
  { label: 'collections', kind: 9, insertText: 'collections', detail: 'Specialized container datatypes', sortText: 'c0' },
  { label: 'itertools', kind: 9, insertText: 'itertools', detail: 'Iterator building functions', sortText: 'c0' },
  { label: 'functools', kind: 9, insertText: 'functools', detail: 'Higher-order functions', sortText: 'c0' },
  { label: 'pathlib', kind: 9, insertText: 'pathlib', detail: 'Object-oriented filesystem paths', sortText: 'c0' },
  { label: 'typing', kind: 9, insertText: 'typing', detail: 'Support for type hints', sortText: 'c0' },
  { label: 'dataclasses', kind: 9, insertText: 'dataclasses', detail: 'Data class decorator and functions', sortText: 'c0' },
];

const PYTHON_SNIPPETS: CompletionEntry[] = [
  { label: 'def (function)', kind: 16, insertText: 'def ${1:function_name}(${2:params}):\n\t"""${3:Docstring.}"""\n\t${4:pass}', detail: 'Function definition with docstring', sortText: 'd0' },
  { label: 'class (with init)', kind: 16, insertText: 'class ${1:ClassName}:\n\t"""${2:Class docstring.}"""\n\n\tdef __init__(self, ${3:params}):\n\t\t${4:pass}', detail: 'Class with __init__ method', sortText: 'd0' },
  { label: 'if __name__ == main', kind: 16, insertText: 'if __name__ == "__main__":\n\t${1:main()}', detail: 'Main guard idiom', sortText: 'd0' },
  { label: 'for (enumerate)', kind: 16, insertText: 'for ${1:i}, ${2:item} in enumerate(${3:iterable}):\n\t${4:pass}', detail: 'For loop with enumerate', sortText: 'd0' },
  { label: 'try-except', kind: 16, insertText: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:print(f"Error: {e}")}', detail: 'Try-except block', sortText: 'd0' },
  { label: 'try-except-finally', kind: 16, insertText: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}\nfinally:\n\t${5:pass}', detail: 'Try-except-finally block', sortText: 'd0' },
  { label: 'with open (read)', kind: 16, insertText: "with open('${1:file.txt}', 'r') as ${2:f}:\n\t${3:data = f.read()}", detail: 'Open file for reading', sortText: 'd0' },
  { label: 'with open (write)', kind: 16, insertText: "with open('${1:file.txt}', 'w') as ${2:f}:\n\t${3:f.write('')}", detail: 'Open file for writing', sortText: 'd0' },
  { label: 'list comprehension', kind: 16, insertText: '[${1:expression} for ${2:item} in ${3:iterable}]', detail: 'List comprehension', sortText: 'd0' },
  { label: 'dict comprehension', kind: 16, insertText: '{${1:key}: ${2:value} for ${3:item} in ${4:iterable}}', detail: 'Dictionary comprehension', sortText: 'd0' },
  { label: 'lambda', kind: 16, insertText: '${1:func} = lambda ${2:args}: ${3:expression}', detail: 'Lambda function assignment', sortText: 'd0' },
  { label: 'dataclass', kind: 16, insertText: '@dataclass\nclass ${1:ClassName}:\n\t${2:field}: ${3:type}', detail: 'Dataclass definition', sortText: 'd0' },
];

const PYTHON_COMPLETIONS: CompletionEntry[] = [
  ...PYTHON_KEYWORDS,
  ...PYTHON_BUILTINS,
  ...PYTHON_MODULES,
  ...PYTHON_SNIPPETS,
];

// ─── JavaScript Completions ─────────────────────────────────────────────────

const JAVASCRIPT_KEYWORDS: CompletionEntry[] = [
  { label: 'const', kind: 15, insertText: 'const ${1:name} = ${2:value};', detail: 'Block-scoped constant', sortText: 'a0' },
  { label: 'let', kind: 15, insertText: 'let ${1:name} = ${2:value};', detail: 'Block-scoped variable', sortText: 'a0' },
  { label: 'var', kind: 15, insertText: 'var ${1:name} = ${2:value};', detail: 'Function-scoped variable', sortText: 'a0' },
  { label: 'function', kind: 15, insertText: 'function ${1:name}(${2:params}) {\n\t${3:// body}\n}', detail: 'Function declaration', sortText: 'a0' },
  { label: 'return', kind: 15, insertText: 'return ${1:value};', detail: 'Return from function', sortText: 'a0' },
  { label: 'if', kind: 15, insertText: 'if (${1:condition}) {\n\t${2:// body}\n}', detail: 'If statement', sortText: 'a0' },
  { label: 'else', kind: 15, insertText: 'else {\n\t${1:// body}\n}', detail: 'Else clause', sortText: 'a0' },
  { label: 'for', kind: 15, insertText: 'for (${1:let i = 0}; ${2:i < length}; ${3:i++}) {\n\t${4:// body}\n}', detail: 'For loop', sortText: 'a0' },
  { label: 'while', kind: 15, insertText: 'while (${1:condition}) {\n\t${2:// body}\n}', detail: 'While loop', sortText: 'a0' },
  { label: 'do', kind: 15, insertText: 'do {\n\t${1:// body}\n} while (${2:condition});', detail: 'Do-while loop', sortText: 'a0' },
  { label: 'switch', kind: 15, insertText: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t${3:// body}\n\t\tbreak;\n\tdefault:\n\t\t${4:// default}\n}', detail: 'Switch statement', sortText: 'a0' },
  { label: 'case', kind: 15, insertText: 'case ${1:value}:\n\t${2:// body}\n\tbreak;', detail: 'Case clause in switch', sortText: 'a0' },
  { label: 'break', kind: 15, insertText: 'break;', detail: 'Break out of loop or switch', sortText: 'a0' },
  { label: 'continue', kind: 15, insertText: 'continue;', detail: 'Continue to next iteration', sortText: 'a0' },
  { label: 'new', kind: 15, insertText: 'new ${1:Constructor}(${2:args})', detail: 'Create new object instance', sortText: 'a0' },
  { label: 'this', kind: 15, insertText: 'this', detail: 'Current context reference', sortText: 'a0' },
  { label: 'class', kind: 15, insertText: 'class ${1:ClassName} {\n\tconstructor(${2:params}) {\n\t\t${3:// body}\n\t}\n}', detail: 'Class declaration', sortText: 'a0' },
  { label: 'extends', kind: 15, insertText: 'extends ${1:ParentClass}', detail: 'Class inheritance', sortText: 'a0' },
  { label: 'import', kind: 15, insertText: "import { ${1:name} } from '${2:module}';", detail: 'Import from module', sortText: 'a0' },
  { label: 'export', kind: 15, insertText: 'export ${1:declaration};', detail: 'Export declaration', sortText: 'a0' },
  { label: 'default', kind: 15, insertText: 'export default ${1:declaration};', detail: 'Default export', sortText: 'a0' },
  { label: 'from', kind: 15, insertText: "from '${1:module}'", detail: 'Module source specifier', sortText: 'a0' },
  { label: 'async', kind: 15, insertText: 'async ${1:function}(${2:params}) {\n\t${3:// body}\n}', detail: 'Async function modifier', sortText: 'a0' },
  { label: 'await', kind: 15, insertText: 'await ${1:promise}', detail: 'Wait for promise resolution', sortText: 'a0' },
  { label: 'try', kind: 15, insertText: 'try {\n\t${1:// body}\n} catch (${2:error}) {\n\t${3:// handle error}\n}', detail: 'Try block', sortText: 'a0' },
  { label: 'catch', kind: 15, insertText: 'catch (${1:error}) {\n\t${2:// handle error}\n}', detail: 'Catch clause', sortText: 'a0' },
  { label: 'finally', kind: 15, insertText: 'finally {\n\t${1:// cleanup}\n}', detail: 'Finally clause', sortText: 'a0' },
  { label: 'throw', kind: 15, insertText: 'throw ${1:new Error(message)};', detail: 'Throw an exception', sortText: 'a0' },
  { label: 'typeof', kind: 15, insertText: 'typeof ${1:operand}', detail: 'Return type of operand', sortText: 'a0' },
  { label: 'instanceof', kind: 15, insertText: '${1:object} instanceof ${2:Constructor}', detail: 'Check instance type', sortText: 'a0' },
  { label: 'void', kind: 15, insertText: 'void ${1:expression}', detail: 'Evaluate expression and return undefined', sortText: 'a0' },
  { label: 'delete', kind: 15, insertText: 'delete ${1:object.property}', detail: 'Delete a property', sortText: 'a0' },
  { label: 'in', kind: 15, insertText: '${1:key} in ${2:object}', detail: 'Property in operator', sortText: 'a0' },
  { label: 'of', kind: 15, insertText: 'of ${1:iterable}', detail: 'For-of iterable specifier', sortText: 'a0' },
  { label: 'yield', kind: 15, insertText: 'yield ${1:value}', detail: 'Yield value from generator', sortText: 'a0' },
];

const JAVASCRIPT_BUILTINS: CompletionEntry[] = [
  { label: 'console.log', kind: 1, insertText: 'console.log(${1:object})', detail: 'Log to console', sortText: 'b0' },
  { label: 'console.error', kind: 1, insertText: 'console.error(${1:object})', detail: 'Log error to console', sortText: 'b0' },
  { label: 'console.warn', kind: 1, insertText: 'console.warn(${1:object})', detail: 'Log warning to console', sortText: 'b0' },
  { label: 'console.info', kind: 1, insertText: 'console.info(${1:object})', detail: 'Log info to console', sortText: 'b0' },
  { label: 'console.table', kind: 1, insertText: 'console.table(${1:data})', detail: 'Display tabular data in console', sortText: 'b0' },
  { label: 'console.time', kind: 1, insertText: "console.time('${1:label}')", detail: 'Start a timer', sortText: 'b0' },
  { label: 'console.timeEnd', kind: 1, insertText: "console.timeEnd('${1:label}')", detail: 'End a timer and log duration', sortText: 'b0' },
  { label: 'Math.random', kind: 1, insertText: 'Math.random()', detail: 'Random number [0, 1)', sortText: 'b0' },
  { label: 'Math.floor', kind: 1, insertText: 'Math.floor(${1:number})', detail: 'Round down to integer', sortText: 'b0' },
  { label: 'Math.ceil', kind: 1, insertText: 'Math.ceil(${1:number})', detail: 'Round up to integer', sortText: 'b0' },
  { label: 'Math.round', kind: 1, insertText: 'Math.round(${1:number})', detail: 'Round to nearest integer', sortText: 'b0' },
  { label: 'Math.max', kind: 1, insertText: 'Math.max(${1:...values})', detail: 'Return largest value', sortText: 'b0' },
  { label: 'Math.min', kind: 1, insertText: 'Math.min(${1:...values})', detail: 'Return smallest value', sortText: 'b0' },
  { label: 'Math.abs', kind: 1, insertText: 'Math.abs(${1:number})', detail: 'Return absolute value', sortText: 'b0' },
  { label: 'Math.pow', kind: 1, insertText: 'Math.pow(${1:base}, ${2:exponent})', detail: 'Return base^exponent', sortText: 'b0' },
  { label: 'Math.sqrt', kind: 1, insertText: 'Math.sqrt(${1:number})', detail: 'Return square root', sortText: 'b0' },
  { label: 'Math.PI', kind: 22, insertText: 'Math.PI', detail: 'Pi constant (3.14159...)', sortText: 'b0' },
  { label: 'JSON.stringify', kind: 1, insertText: 'JSON.stringify(${1:object}, ${2:null}, ${3:2})', detail: 'Convert object to JSON string', sortText: 'b0' },
  { label: 'JSON.parse', kind: 1, insertText: 'JSON.parse(${1:string})', detail: 'Parse JSON string to object', sortText: 'b0' },
  { label: 'Array.isArray', kind: 1, insertText: 'Array.isArray(${1:value})', detail: 'Check if value is an Array', sortText: 'b0' },
  { label: 'Array.from', kind: 1, insertText: 'Array.from(${1:iterable})', detail: 'Create array from iterable', sortText: 'b0' },
  { label: 'Promise.resolve', kind: 1, insertText: 'Promise.resolve(${1:value})', detail: 'Create resolved promise', sortText: 'b0' },
  { label: 'Promise.all', kind: 1, insertText: 'Promise.all(${1:iterable})', detail: 'Wait for all promises', sortText: 'b0' },
  { label: 'Promise.race', kind: 1, insertText: 'Promise.race(${1:iterable})', detail: 'Wait for first promise', sortText: 'b0' },
  { label: 'setTimeout', kind: 2, insertText: 'setTimeout(${1:callback}, ${2:delay})', detail: 'Set a timer', sortText: 'b0' },
  { label: 'setInterval', kind: 2, insertText: 'setInterval(${1:callback}, ${2:delay})', detail: 'Set a repeating timer', sortText: 'b0' },
  { label: 'clearTimeout', kind: 2, insertText: 'clearTimeout(${1:timerId})', detail: 'Clear a timeout', sortText: 'b0' },
  { label: 'clearInterval', kind: 2, insertText: 'clearInterval(${1:timerId})', detail: 'Clear an interval', sortText: 'b0' },
  { label: 'parseInt', kind: 2, insertText: "parseInt(${1:string}, ${2:10})", detail: 'Parse string to integer', sortText: 'b0' },
  { label: 'parseFloat', kind: 2, insertText: 'parseFloat(${1:string})', detail: 'Parse string to float', sortText: 'b0' },
  { label: 'isNaN', kind: 2, insertText: 'isNaN(${1:value})', detail: 'Check if value is NaN', sortText: 'b0' },
  { label: 'isFinite', kind: 2, insertText: 'isFinite(${1:value})', detail: 'Check if value is finite', sortText: 'b0' },
  { label: 'Object.keys', kind: 1, insertText: 'Object.keys(${1:object})', detail: 'Return array of own enumerable property names', sortText: 'b0' },
  { label: 'Object.values', kind: 1, insertText: 'Object.values(${1:object})', detail: 'Return array of own enumerable property values', sortText: 'b0' },
  { label: 'Object.entries', kind: 1, insertText: 'Object.entries(${1:object})', detail: 'Return array of [key, value] pairs', sortText: 'b0' },
  { label: 'Object.assign', kind: 1, insertText: 'Object.assign(${1:target}, ${2:source})', detail: 'Copy enumerable own properties', sortText: 'b0' },
];

const JAVASCRIPT_SNIPPETS: CompletionEntry[] = [
  { label: 'function', kind: 16, insertText: 'function ${1:name}(${2:params}) {\n\t${3:// body}\n}', detail: 'Function declaration', sortText: 'd0' },
  { label: 'arrow function', kind: 16, insertText: 'const ${1:name} = (${2:params}) => {\n\t${3:// body}\n};', detail: 'Arrow function', sortText: 'd0' },
  { label: 'arrow function (implicit return)', kind: 16, insertText: 'const ${1:name} = (${2:params}) => ${3:expression};', detail: 'Arrow function with implicit return', sortText: 'd0' },
  { label: 'class', kind: 16, insertText: 'class ${1:ClassName} {\n\tconstructor(${2:params}) {\n\t\t${3:this.property = value;}\n\t}\n\n\t${4:method() {\n\t\t// body\n\t}}\n}', detail: 'Class declaration', sortText: 'd0' },
  { label: 'if-else', kind: 16, insertText: 'if (${1:condition}) {\n\t${2:// if body}\n} else {\n\t${3:// else body}\n}', detail: 'If-else statement', sortText: 'd0' },
  { label: 'for loop', kind: 16, insertText: 'for (let ${1:i} = 0; ${1:i} < ${2:length}; ${1:i}++) {\n\t${3:// body}\n}', detail: 'Classic for loop', sortText: 'd0' },
  { label: 'forEach', kind: 16, insertText: '${1:array}.forEach((${2:item}) => {\n\t${3:// body}\n});', detail: 'Array forEach', sortText: 'd0' },
  { label: 'map', kind: 16, insertText: '${1:array}.map((${2:item}) => ${3:expression});', detail: 'Array map', sortText: 'd0' },
  { label: 'filter', kind: 16, insertText: '${1:array}.filter((${2:item}) => ${3:condition});', detail: 'Array filter', sortText: 'd0' },
  { label: 'reduce', kind: 16, insertText: '${1:array}.reduce((${2:acc}, ${3:item}) => ${4:expression}, ${5:initialValue});', detail: 'Array reduce', sortText: 'd0' },
  { label: 'try-catch', kind: 16, insertText: 'try {\n\t${1:// body}\n} catch (${2:error}) {\n\t${3:console.error(error);}\n}', detail: 'Try-catch block', sortText: 'd0' },
  { label: 'promise', kind: 16, insertText: 'new Promise((resolve, reject) => {\n\t${1:// body}\n});', detail: 'New Promise', sortText: 'd0' },
  { label: 'async function', kind: 16, insertText: 'async function ${1:name}(${2:params}) {\n\t${3:// body}\n}', detail: 'Async function declaration', sortText: 'd0' },
  { label: 'async arrow function', kind: 16, insertText: 'const ${1:name} = async (${2:params}) => {\n\t${3:// body}\n};', detail: 'Async arrow function', sortText: 'd0' },
  { label: 'fetch', kind: 16, insertText: "const response = await fetch('${1:url}');\nconst data = await response.json();", detail: 'Fetch API with await', sortText: 'd0' },
  { label: 'export default function', kind: 16, insertText: 'export default function ${1:name}(${2:params}) {\n\t${3:// body}\n}', detail: 'Export default function', sortText: 'd0' },
  { label: 'require', kind: 16, insertText: "const ${1:module} = require('${2:module-name}');", detail: 'CommonJS require', sortText: 'd0' },
];

const JAVASCRIPT_COMPLETIONS: CompletionEntry[] = [
  ...JAVASCRIPT_KEYWORDS,
  ...JAVASCRIPT_BUILTINS,
  ...JAVASCRIPT_SNIPPETS,
];

// ─── C Completions ──────────────────────────────────────────────────────────

const C_KEYWORDS: CompletionEntry[] = [
  { label: 'int', kind: 15, insertText: 'int ${1:name} = ${2:0};', detail: 'Integer type', sortText: 'a0' },
  { label: 'float', kind: 15, insertText: 'float ${1:name} = ${2:0.0f};', detail: 'Floating-point type', sortText: 'a0' },
  { label: 'double', kind: 15, insertText: 'double ${1:name} = ${2:0.0};', detail: 'Double precision float type', sortText: 'a0' },
  { label: 'char', kind: 15, insertText: "char ${1:name} = '${2:c}';", detail: 'Character type', sortText: 'a0' },
  { label: 'long', kind: 15, insertText: 'long ${1:name} = ${2:0L};', detail: 'Long integer type', sortText: 'a0' },
  { label: 'short', kind: 15, insertText: 'short ${1:name} = ${2:0};', detail: 'Short integer type', sortText: 'a0' },
  { label: 'unsigned', kind: 15, insertText: 'unsigned ${1:name} = ${2:0};', detail: 'Unsigned type modifier', sortText: 'a0' },
  { label: 'void', kind: 15, insertText: 'void', detail: 'Void type', sortText: 'a0' },
  { label: 'struct', kind: 15, insertText: 'struct ${1:Name} {\n\t${2:int field;}\n};', detail: 'Structure type', sortText: 'a0' },
  { label: 'enum', kind: 15, insertText: 'enum ${1:Name} {\n\t${2:VALUE1,}\n\t${3:VALUE2}\n};', detail: 'Enumeration type', sortText: 'a0' },
  { label: 'union', kind: 15, insertText: 'union ${1:Name} {\n\t${2:int i;}\n\t${3:float f;}\n};', detail: 'Union type', sortText: 'a0' },
  { label: 'typedef', kind: 15, insertText: 'typedef ${1:type} ${2:Name};', detail: 'Type definition', sortText: 'a0' },
  { label: 'const', kind: 15, insertText: 'const ${1:type} ${2:name} = ${3:value};', detail: 'Constant qualifier', sortText: 'a0' },
  { label: 'static', kind: 15, insertText: 'static ${1:type} ${2:name};', detail: 'Static storage class', sortText: 'a0' },
  { label: 'extern', kind: 15, insertText: 'extern ${1:type} ${2:name};', detail: 'External linkage', sortText: 'a0' },
  { label: 'register', kind: 15, insertText: 'register ${1:type} ${2:name};', detail: 'Register storage class', sortText: 'a0' },
  { label: 'volatile', kind: 15, insertText: 'volatile ${1:type} ${2:name};', detail: 'Volatile qualifier', sortText: 'a0' },
  { label: 'auto', kind: 15, insertText: 'auto ${1:type} ${2:name};', detail: 'Auto storage class', sortText: 'a0' },
  { label: 'signed', kind: 15, insertText: 'signed ${1:type} ${2:name};', detail: 'Signed type modifier', sortText: 'a0' },
  { label: 'if', kind: 15, insertText: 'if (${1:condition}) {\n\t${2:// body}\n}', detail: 'If statement', sortText: 'a0' },
  { label: 'else', kind: 15, insertText: 'else {\n\t${1:// body}\n}', detail: 'Else clause', sortText: 'a0' },
  { label: 'for', kind: 15, insertText: 'for (${1:int i = 0}; ${2:i < n}; ${3:i++}) {\n\t${4:// body}\n}', detail: 'For loop', sortText: 'a0' },
  { label: 'while', kind: 15, insertText: 'while (${1:condition}) {\n\t${2:// body}\n}', detail: 'While loop', sortText: 'a0' },
  { label: 'do', kind: 15, insertText: 'do {\n\t${1:// body}\n} while (${2:condition});', detail: 'Do-while loop', sortText: 'a0' },
  { label: 'switch', kind: 15, insertText: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t${3:// body}\n\t\tbreak;\n\tdefault:\n\t\t${4:// default}\n}', detail: 'Switch statement', sortText: 'a0' },
  { label: 'case', kind: 15, insertText: 'case ${1:value}:\n\t${2:// body}\n\tbreak;', detail: 'Case label', sortText: 'a0' },
  { label: 'default', kind: 15, insertText: 'default:\n\t${1:// body}\n\tbreak;', detail: 'Default case label', sortText: 'a0' },
  { label: 'break', kind: 15, insertText: 'break;', detail: 'Break statement', sortText: 'a0' },
  { label: 'continue', kind: 15, insertText: 'continue;', detail: 'Continue statement', sortText: 'a0' },
  { label: 'return', kind: 15, insertText: 'return ${1:value};', detail: 'Return statement', sortText: 'a0' },
  { label: 'goto', kind: 15, insertText: 'goto ${1:label};', detail: 'Goto statement', sortText: 'a0' },
  { label: 'sizeof', kind: 15, insertText: 'sizeof(${1:type})', detail: 'Size of type or expression', sortText: 'a0' },
];

const C_STDLIB: CompletionEntry[] = [
  { label: 'printf', kind: 2, insertText: 'printf("${1:%s}\\n", ${2:arg});', detail: 'Print formatted output to stdout', documentation: 'int printf(const char *format, ...);', sortText: 'b0' },
  { label: 'scanf', kind: 2, insertText: 'scanf("${1:%d}", &${2:var});', detail: 'Read formatted input from stdin', documentation: 'int scanf(const char *format, ...);', sortText: 'b0' },
  { label: 'fprintf', kind: 2, insertText: 'fprintf(${1:stream}, "${2:%s}\\n", ${3:arg});', detail: 'Print formatted output to stream', sortText: 'b0' },
  { label: 'fscanf', kind: 2, insertText: 'fscanf(${1:stream}, "${2:%d}", &${3:var});', detail: 'Read formatted input from stream', sortText: 'b0' },
  { label: 'sprintf', kind: 2, insertText: 'sprintf(${1:buffer}, "${2:%s}", ${3:arg});', detail: 'Print formatted to string', sortText: 'b0' },
  { label: 'sscanf', kind: 2, insertText: 'sscanf(${1:str}, "${2:%d}", &${3:var});', detail: 'Read formatted from string', sortText: 'b0' },
  { label: 'malloc', kind: 2, insertText: '(${1:type}*)malloc(${2:n} * sizeof(${1:type}))', detail: 'Allocate dynamic memory', documentation: 'void* malloc(size_t size);', sortText: 'b0' },
  { label: 'calloc', kind: 2, insertText: '(${1:type}*)calloc(${2:n}, sizeof(${1:type}))', detail: 'Allocate and zero-initialize memory', sortText: 'b0' },
  { label: 'realloc', kind: 2, insertText: '(${1:type}*)realloc(${2:ptr}, ${3:new_size} * sizeof(${1:type}))', detail: 'Reallocate memory', sortText: 'b0' },
  { label: 'free', kind: 2, insertText: 'free(${1:ptr});', detail: 'Free dynamically allocated memory', sortText: 'b0' },
  { label: 'memcpy', kind: 2, insertText: 'memcpy(${1:dest}, ${2:src}, ${3:n});', detail: 'Copy memory area', sortText: 'b0' },
  { label: 'memset', kind: 2, insertText: 'memset(${1:ptr}, ${2:value}, ${3:n});', detail: 'Fill memory with a byte value', sortText: 'b0' },
  { label: 'memmove', kind: 2, insertText: 'memmove(${1:dest}, ${2:src}, ${3:n});', detail: 'Copy memory area (overlapping safe)', sortText: 'b0' },
  { label: 'strcmp', kind: 2, insertText: 'strcmp(${1:str1}, ${2:str2})', detail: 'Compare two strings', sortText: 'b0' },
  { label: 'strncmp', kind: 2, insertText: 'strncmp(${1:str1}, ${2:str2}, ${3:n})', detail: 'Compare first n chars of strings', sortText: 'b0' },
  { label: 'strcpy', kind: 2, insertText: 'strcpy(${1:dest}, ${2:src});', detail: 'Copy string', sortText: 'b0' },
  { label: 'strncpy', kind: 2, insertText: 'strncpy(${1:dest}, ${2:src}, ${3:n});', detail: 'Copy first n chars of string', sortText: 'b0' },
  { label: 'strlen', kind: 2, insertText: 'strlen(${1:str})', detail: 'Return length of string', sortText: 'b0' },
  { label: 'strcat', kind: 2, insertText: 'strcat(${1:dest}, ${2:src});', detail: 'Concatenate strings', sortText: 'b0' },
  { label: 'strncat', kind: 2, insertText: 'strncat(${1:dest}, ${2:src}, ${3:n});', detail: 'Concatenate first n chars', sortText: 'b0' },
  { label: 'strchr', kind: 2, insertText: 'strchr(${1:str}, ${2:character})', detail: 'Find first occurrence of character', sortText: 'b0' },
  { label: 'strstr', kind: 2, insertText: 'strstr(${1:str}, ${2:substring})', detail: 'Find first occurrence of substring', sortText: 'b0' },
  { label: 'strtok', kind: 2, insertText: 'strtok(${1:str}, "${2:delimiters}")', detail: 'Tokenize string', sortText: 'b0' },
  { label: 'fopen', kind: 2, insertText: 'fopen("${1:filename}", "${2:r}")', detail: 'Open file', sortText: 'b0' },
  { label: 'fclose', kind: 2, insertText: 'fclose(${1:file});', detail: 'Close file', sortText: 'b0' },
  { label: 'fread', kind: 2, insertText: 'fread(${1:buffer}, ${2:size}, ${3:count}, ${4:file});', detail: 'Read from file', sortText: 'b0' },
  { label: 'fwrite', kind: 2, insertText: 'fwrite(${1:buffer}, ${2:size}, ${3:count}, ${4:file});', detail: 'Write to file', sortText: 'b0' },
  { label: 'fgets', kind: 2, insertText: 'fgets(${1:buffer}, ${2:size}, ${3:file});', detail: 'Read line from file', sortText: 'b0' },
  { label: 'fputs', kind: 2, insertText: 'fputs(${1:str}, ${2:file});', detail: 'Write string to file', sortText: 'b0' },
  { label: 'fseek', kind: 2, insertText: 'fseek(${1:file}, ${2:offset}, ${3:SEEK_SET});', detail: 'Set file position', sortText: 'b0' },
  { label: 'ftell', kind: 2, insertText: 'ftell(${1:file})', detail: 'Get current file position', sortText: 'b0' },
  { label: 'rewind', kind: 2, insertText: 'rewind(${1:file});', detail: 'Reset file position to beginning', sortText: 'b0' },
  { label: 'exit', kind: 2, insertText: 'exit(${1:0});', detail: 'Terminate program', sortText: 'b0' },
  { label: 'abort', kind: 2, insertText: 'abort();', detail: 'Abort program abnormally', sortText: 'b0' },
  { label: 'atoi', kind: 2, insertText: 'atoi(${1:str})', detail: 'Convert string to integer', sortText: 'b0' },
  { label: 'atof', kind: 2, insertText: 'atof(${1:str})', detail: 'Convert string to double', sortText: 'b0' },
  { label: 'atol', kind: 2, insertText: 'atol(${1:str})', detail: 'Convert string to long', sortText: 'b0' },
  { label: 'rand', kind: 2, insertText: 'rand()', detail: 'Generate random number', sortText: 'b0' },
  { label: 'srand', kind: 2, insertText: 'srand(${1:seed});', detail: 'Seed random number generator', sortText: 'b0' },
  { label: 'qsort', kind: 2, insertText: 'qsort(${1:array}, ${2:n}, sizeof(${3:type}), ${4:compare});', detail: 'Sort array with quicksort', sortText: 'b0' },
  { label: 'bsearch', kind: 2, insertText: 'bsearch(${1:key}, ${2:array}, ${3:n}, sizeof(${4:type}), ${5:compare})', detail: 'Binary search in sorted array', sortText: 'b0' },
  { label: 'abs', kind: 2, insertText: 'abs(${1:n})', detail: 'Absolute value of integer', sortText: 'b0' },
  { label: 'labs', kind: 2, insertText: 'labs(${1:n})', detail: 'Absolute value of long', sortText: 'b0' },
];

const C_SNIPPETS: CompletionEntry[] = [
  { label: '#include <stdio.h>', kind: 16, insertText: '#include <stdio.h>', detail: 'Standard I/O header', sortText: 'd0' },
  { label: '#include <stdlib.h>', kind: 16, insertText: '#include <stdlib.h>', detail: 'Standard library header', sortText: 'd0' },
  { label: '#include <string.h>', kind: 16, insertText: '#include <string.h>', detail: 'String operations header', sortText: 'd0' },
  { label: '#include <math.h>', kind: 16, insertText: '#include <math.h>', detail: 'Math functions header', sortText: 'd0' },
  { label: '#include <ctype.h>', kind: 16, insertText: '#include <ctype.h>', detail: 'Character type header', sortText: 'd0' },
  { label: '#include <time.h>', kind: 16, insertText: '#include <time.h>', detail: 'Date and time header', sortText: 'd0' },
  { label: '#include <stdbool.h>', kind: 16, insertText: '#include <stdbool.h>', detail: 'Boolean type header', sortText: 'd0' },
  { label: '#include <assert.h>', kind: 16, insertText: '#include <assert.h>', detail: 'Assertions header', sortText: 'd0' },
  { label: '#include <errno.h>', kind: 16, insertText: '#include <errno.h>', detail: 'Error numbers header', sortText: 'd0' },
  { label: '#include <limits.h>', kind: 16, insertText: '#include <limits.h>', detail: 'Size limits header', sortText: 'd0' },
  { label: 'main', kind: 16, insertText: 'int main(${1:int argc, char *argv[]}) {\n\t${2:// code}\n\treturn 0;\n}', detail: 'Main function template', sortText: 'd0' },
  { label: 'for loop', kind: 16, insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3:// body}\n}', detail: 'For loop', sortText: 'd0' },
  { label: 'if-else', kind: 16, insertText: 'if (${1:condition}) {\n\t${2:// if body}\n} else {\n\t${3:// else body}\n}', detail: 'If-else statement', sortText: 'd0' },
  { label: 'struct definition', kind: 16, insertText: 'typedef struct {\n\t${1:int field;}\n} ${2:StructName};', detail: 'Struct with typedef', sortText: 'd0' },
  { label: 'malloc array', kind: 16, insertText: '${1:int} *${2:arr} = (${1:int}*)malloc(${3:n} * sizeof(${1:int}));\nif (${2:arr} == NULL) {\n\tfprintf(stderr, "Memory allocation failed\\n");\n\texit(1);\n}', detail: 'Malloc with null check', sortText: 'd0' },
];

const C_COMPLETIONS: CompletionEntry[] = [
  ...C_KEYWORDS,
  ...C_STDLIB,
  ...C_SNIPPETS,
];

// ─── C++ Completions ────────────────────────────────────────────────────────

const CPP_EXTRA_KEYWORDS: CompletionEntry[] = [
  { label: 'namespace', kind: 15, insertText: 'namespace ${1:name} {\n\t${2:// body}\n}', detail: 'Namespace declaration', sortText: 'a0' },
  { label: 'using', kind: 15, insertText: 'using ${1:namespace};', detail: 'Using directive/declaration', sortText: 'a0' },
  { label: 'template', kind: 15, insertText: 'template<${1:typename T}>\n${2:// declaration}', detail: 'Template declaration', sortText: 'a0' },
  { label: 'typename', kind: 15, insertText: 'typename ${1:T}', detail: 'Template type parameter', sortText: 'a0' },
  { label: 'public', kind: 15, insertText: 'public:', detail: 'Public access specifier', sortText: 'a0' },
  { label: 'private', kind: 15, insertText: 'private:', detail: 'Private access specifier', sortText: 'a0' },
  { label: 'protected', kind: 15, insertText: 'protected:', detail: 'Protected access specifier', sortText: 'a0' },
  { label: 'virtual', kind: 15, insertText: 'virtual ${1:return_type} ${2:method}(${3:params});', detail: 'Virtual function', sortText: 'a0' },
  { label: 'override', kind: 15, insertText: 'override', detail: 'Override specifier', sortText: 'a0' },
  { label: 'friend', kind: 15, insertText: 'friend ${1:declaration};', detail: 'Friend declaration', sortText: 'a0' },
  { label: 'inline', kind: 15, insertText: 'inline ${1:declaration}', detail: 'Inline specifier', sortText: 'a0' },
  { label: 'explicit', kind: 15, insertText: 'explicit ${1:constructor}', detail: 'Explicit constructor specifier', sortText: 'a0' },
  { label: 'mutable', kind: 15, insertText: 'mutable ${1:type} ${2:name};', detail: 'Mutable member specifier', sortText: 'a0' },
  { label: 'constexpr', kind: 15, insertText: 'constexpr ${1:type} ${2:name} = ${3:value};', detail: 'Constant expression', sortText: 'a0' },
  { label: 'noexcept', kind: 15, insertText: 'noexcept', detail: 'No-exception specifier', sortText: 'a0' },
  { label: 'auto', kind: 15, insertText: 'auto ${1:name} = ${2:value};', detail: 'Auto type deduction', sortText: 'a0' },
  { label: 'new', kind: 15, insertText: 'new ${1:Type}(${2:args})', detail: 'Dynamic memory allocation', sortText: 'a0' },
  { label: 'delete', kind: 15, insertText: 'delete ${1:ptr};', detail: 'Deallocate dynamic memory', sortText: 'a0' },
  { label: 'try', kind: 15, insertText: 'try {\n\t${1:// body}\n} catch (${2:const std::exception& e}) {\n\t${3:std::cerr << e.what() << std::endl;}\n}', detail: 'Try block', sortText: 'a0' },
  { label: 'catch', kind: 15, insertText: 'catch (${1:const std::exception& e}) {\n\t${2:// handle}\n}', detail: 'Catch clause', sortText: 'a0' },
  { label: 'throw', kind: 15, insertText: 'throw ${1:exception};', detail: 'Throw an exception', sortText: 'a0' },
  { label: 'bool', kind: 15, insertText: 'bool ${1:name} = ${2:true};', detail: 'Boolean type', sortText: 'a0' },
  { label: 'true', kind: 12, insertText: 'true', detail: 'Boolean true', sortText: 'a0' },
  { label: 'false', kind: 12, insertText: 'false', detail: 'Boolean false', sortText: 'a0' },
  { label: 'nullptr', kind: 12, insertText: 'nullptr', detail: 'Null pointer constant', sortText: 'a0' },
  { label: 'static_cast', kind: 15, insertText: 'static_cast<${1:type}>(${2:expression})', detail: 'Static type cast', sortText: 'a0' },
  { label: 'dynamic_cast', kind: 15, insertText: 'dynamic_cast<${1:type}>(${2:expression})', detail: 'Dynamic type cast (polymorphic)', sortText: 'a0' },
  { label: 'reinterpret_cast', kind: 15, insertText: 'reinterpret_cast<${1:type}>(${2:expression})', detail: 'Reinterpret type cast', sortText: 'a0' },
  { label: 'const_cast', kind: 15, insertText: 'const_cast<${1:type}>(${2:expression})', detail: 'Const type cast', sortText: 'a0' },
];

const CPP_STL: CompletionEntry[] = [
  { label: 'cout', kind: 2, insertText: 'std::cout << ${1:value} << std::endl;', detail: 'Standard output stream', sortText: 'b0' },
  { label: 'cin', kind: 2, insertText: 'std::cin >> ${1:variable};', detail: 'Standard input stream', sortText: 'b0' },
  { label: 'endl', kind: 22, insertText: 'std::endl', detail: 'End line + flush', sortText: 'b0' },
  { label: 'cerr', kind: 2, insertText: 'std::cerr << ${1:value} << std::endl;', detail: 'Standard error stream', sortText: 'b0' },
  { label: 'vector', kind: 7, insertText: 'std::vector<${1:int}> ${2:name};', detail: 'Dynamic array container', documentation: '#include <vector>\nstd::vector<int> v = {1, 2, 3};', sortText: 'c0' },
  { label: 'string', kind: 7, insertText: 'std::string ${1:name} = "${2:value}";', detail: 'String class', documentation: '#include <string>', sortText: 'c0' },
  { label: 'map', kind: 7, insertText: 'std::map<${1:Key}, ${2:Value}> ${3:name};', detail: 'Sorted key-value container', documentation: '#include <map>', sortText: 'c0' },
  { label: 'set', kind: 7, insertText: 'std::set<${1:Type}> ${2:name};', detail: 'Sorted unique element container', documentation: '#include <set>', sortText: 'c0' },
  { label: 'unordered_map', kind: 7, insertText: 'std::unordered_map<${1:Key}, ${2:Value}> ${3:name};', detail: 'Hash map container', documentation: '#include <unordered_map>', sortText: 'c0' },
  { label: 'unordered_set', kind: 7, insertText: 'std::unordered_set<${1:Type}> ${2:name};', detail: 'Hash set container', documentation: '#include <unordered_set>', sortText: 'c0' },
  { label: 'stack', kind: 7, insertText: 'std::stack<${1:Type}> ${2:name};', detail: 'LIFO container adapter', documentation: '#include <stack>', sortText: 'c0' },
  { label: 'queue', kind: 7, insertText: 'std::queue<${1:Type}> ${2:name};', detail: 'FIFO container adapter', documentation: '#include <queue>', sortText: 'c0' },
  { label: 'deque', kind: 7, insertText: 'std::deque<${1:Type}> ${2:name};', detail: 'Double-ended queue', documentation: '#include <deque>', sortText: 'c0' },
  { label: 'pair', kind: 7, insertText: 'std::pair<${1:First}, ${2:Second}> ${3:name};', detail: 'Pair of values', documentation: '#include <utility>', sortText: 'c0' },
  { label: 'tuple', kind: 7, insertText: 'std::tuple<${1:Types...}> ${2:name};', detail: 'Tuple of values', documentation: '#include <tuple>', sortText: 'c0' },
  { label: 'array', kind: 7, insertText: 'std::array<${1:Type}, ${2:N}> ${3:name};', detail: 'Fixed-size array container', documentation: '#include <array>', sortText: 'c0' },
  { label: 'priority_queue', kind: 7, insertText: 'std::priority_queue<${1:Type}> ${2:name};', detail: 'Max-heap container adapter', documentation: '#include <queue>', sortText: 'c0' },
  { label: 'algorithm', kind: 9, insertText: '#include <algorithm>', detail: 'STL algorithms header', sortText: 'c0' },
  { label: 'iterator', kind: 9, insertText: '#include <iterator>', detail: 'STL iterators header', sortText: 'c0' },
];

const CPP_SNIPPETS: CompletionEntry[] = [
  { label: '#include <iostream>', kind: 16, insertText: '#include <iostream>', detail: 'I/O stream header', sortText: 'd0' },
  { label: '#include <vector>', kind: 16, insertText: '#include <vector>', detail: 'Vector container header', sortText: 'd0' },
  { label: '#include <string>', kind: 16, insertText: '#include <string>', detail: 'String header', sortText: 'd0' },
  { label: '#include <map>', kind: 16, insertText: '#include <map>', detail: 'Map container header', sortText: 'd0' },
  { label: '#include <algorithm>', kind: 16, insertText: '#include <algorithm>', detail: 'Algorithm header', sortText: 'd0' },
  { label: '#include <bits/stdc++.h>', kind: 16, insertText: '#include <bits/stdc++.h>', detail: 'All standard headers (competitive programming)', sortText: 'd0' },
  { label: 'main', kind: 16, insertText: 'int main() {\n\t${1:// code}\n\treturn 0;\n}', detail: 'Main function template', sortText: 'd0' },
  { label: 'main (with args)', kind: 16, insertText: 'int main(${1:int argc, char *argv[]}) {\n\t${2:// code}\n\treturn 0;\n}', detail: 'Main function with arguments', sortText: 'd0' },
  { label: 'class template', kind: 16, insertText: 'class ${1:ClassName} {\nprivate:\n\t${2:// private members}\n\npublic:\n\t${1:ClassName}(${3:params});\n\t~${1:ClassName}();\n\n\t${4:// public methods}\n};', detail: 'Class template', sortText: 'd0' },
  { label: 'template class', kind: 16, insertText: 'template<${1:typename T}>\nclass ${2:ClassName} {\npublic:\n\t${3:// members}\n};', detail: 'Template class', sortText: 'd0' },
  { label: 'vector iteration', kind: 16, insertText: 'for (const auto& ${1:item} : ${2:vec}) {\n\t${3:// body}\n}', detail: 'Range-based for loop', sortText: 'd0' },
  { label: 'sort vector', kind: 16, insertText: 'std::sort(${1:vec}.begin(), ${1:vec}.end());', detail: 'Sort a vector', sortText: 'd0' },
  { label: 'using namespace std', kind: 16, insertText: 'using namespace std;', detail: 'Using namespace std', sortText: 'd0' },
];

const CPP_COMPLETIONS: CompletionEntry[] = [
  ...C_KEYWORDS,
  ...C_STDLIB,
  ...CPP_EXTRA_KEYWORDS,
  ...CPP_STL,
  ...CPP_SNIPPETS,
];

// ─── Java Completions ───────────────────────────────────────────────────────

const JAVA_KEYWORDS: CompletionEntry[] = [
  { label: 'public', kind: 15, insertText: 'public ', detail: 'Public access modifier', sortText: 'a0' },
  { label: 'private', kind: 15, insertText: 'private ', detail: 'Private access modifier', sortText: 'a0' },
  { label: 'protected', kind: 15, insertText: 'protected ', detail: 'Protected access modifier', sortText: 'a0' },
  { label: 'static', kind: 15, insertText: 'static ', detail: 'Static modifier', sortText: 'a0' },
  { label: 'final', kind: 15, insertText: 'final ', detail: 'Final modifier', sortText: 'a0' },
  { label: 'abstract', kind: 15, insertText: 'abstract ', detail: 'Abstract modifier', sortText: 'a0' },
  { label: 'class', kind: 15, insertText: 'class ${1:ClassName} {\n\t${2:// body}\n}', detail: 'Class declaration', sortText: 'a0' },
  { label: 'interface', kind: 15, insertText: 'interface ${1:InterfaceName} {\n\t${2:// methods}\n}', detail: 'Interface declaration', sortText: 'a0' },
  { label: 'extends', kind: 15, insertText: 'extends ${1:ParentClass}', detail: 'Class inheritance', sortText: 'a0' },
  { label: 'implements', kind: 15, insertText: 'implements ${1:Interface}', detail: 'Interface implementation', sortText: 'a0' },
  { label: 'new', kind: 15, insertText: 'new ${1:Type}(${2:args})', detail: 'Create new object instance', sortText: 'a0' },
  { label: 'this', kind: 15, insertText: 'this', detail: 'Current object reference', sortText: 'a0' },
  { label: 'super', kind: 15, insertText: 'super(${1:args})', detail: 'Parent class reference', sortText: 'a0' },
  { label: 'return', kind: 15, insertText: 'return ${1:value};', detail: 'Return statement', sortText: 'a0' },
  { label: 'if', kind: 15, insertText: 'if (${1:condition}) {\n\t${2:// body}\n}', detail: 'If statement', sortText: 'a0' },
  { label: 'else', kind: 15, insertText: 'else {\n\t${1:// body}\n}', detail: 'Else clause', sortText: 'a0' },
  { label: 'for', kind: 15, insertText: 'for (${1:int i = 0}; ${2:i < n}; ${3:i++}) {\n\t${4:// body}\n}', detail: 'For loop', sortText: 'a0' },
  { label: 'while', kind: 15, insertText: 'while (${1:condition}) {\n\t${2:// body}\n}', detail: 'While loop', sortText: 'a0' },
  { label: 'do', kind: 15, insertText: 'do {\n\t${1:// body}\n} while (${2:condition});', detail: 'Do-while loop', sortText: 'a0' },
  { label: 'switch', kind: 15, insertText: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t${3:// body}\n\t\tbreak;\n\tdefault:\n\t\t${4:// default}\n}', detail: 'Switch statement', sortText: 'a0' },
  { label: 'case', kind: 15, insertText: 'case ${1:value}:\n\t${2:// body}\n\tbreak;', detail: 'Case label', sortText: 'a0' },
  { label: 'default', kind: 15, insertText: 'default:\n\t${1:// body}\n\tbreak;', detail: 'Default case label', sortText: 'a0' },
  { label: 'break', kind: 15, insertText: 'break;', detail: 'Break statement', sortText: 'a0' },
  { label: 'continue', kind: 15, insertText: 'continue;', detail: 'Continue statement', sortText: 'a0' },
  { label: 'try', kind: 15, insertText: 'try {\n\t${1:// body}\n} catch (${2:Exception e}) {\n\t${3:e.printStackTrace();}\n}', detail: 'Try block', sortText: 'a0' },
  { label: 'catch', kind: 15, insertText: 'catch (${1:Exception} ${2:e}) {\n\t${3:// handle}\n}', detail: 'Catch clause', sortText: 'a0' },
  { label: 'finally', kind: 15, insertText: 'finally {\n\t${1:// cleanup}\n}', detail: 'Finally clause', sortText: 'a0' },
  { label: 'throw', kind: 15, insertText: 'throw new ${1:Exception}(${2:message});', detail: 'Throw an exception', sortText: 'a0' },
  { label: 'throws', kind: 15, insertText: 'throws ${1:Exception}', detail: 'Declare thrown exceptions', sortText: 'a0' },
  { label: 'void', kind: 15, insertText: 'void', detail: 'Void return type', sortText: 'a0' },
  { label: 'int', kind: 15, insertText: 'int ${1:name} = ${2:0};', detail: 'Integer type (32-bit)', sortText: 'a0' },
  { label: 'long', kind: 15, insertText: 'long ${1:name} = ${2:0L};', detail: 'Long integer type (64-bit)', sortText: 'a0' },
  { label: 'short', kind: 15, insertText: 'short ${1:name} = ${2:0};', detail: 'Short integer type (16-bit)', sortText: 'a0' },
  { label: 'byte', kind: 15, insertText: 'byte ${1:name} = ${2:0};', detail: 'Byte type (8-bit)', sortText: 'a0' },
  { label: 'float', kind: 15, insertText: 'float ${1:name} = ${2:0.0f};', detail: 'Float type (32-bit)', sortText: 'a0' },
  { label: 'double', kind: 15, insertText: 'double ${1:name} = ${2:0.0};', detail: 'Double type (64-bit)', sortText: 'a0' },
  { label: 'char', kind: 15, insertText: "char ${1:name} = '${2:c}';", detail: 'Character type (16-bit Unicode)', sortText: 'a0' },
  { label: 'boolean', kind: 15, insertText: 'boolean ${1:name} = ${2:true};', detail: 'Boolean type', sortText: 'a0' },
  { label: 'true', kind: 12, insertText: 'true', detail: 'Boolean true literal', sortText: 'a0' },
  { label: 'false', kind: 12, insertText: 'false', detail: 'Boolean false literal', sortText: 'a0' },
  { label: 'null', kind: 12, insertText: 'null', detail: 'Null reference literal', sortText: 'a0' },
  { label: 'import', kind: 15, insertText: 'import ${1:package}.${2:Class};', detail: 'Import declaration', sortText: 'a0' },
  { label: 'package', kind: 15, insertText: 'package ${1:com.example};', detail: 'Package declaration', sortText: 'a0' },
  { label: 'instanceof', kind: 15, insertText: '${1:object} instanceof ${2:Type}', detail: 'Type comparison operator', sortText: 'a0' },
  { label: 'synchronized', kind: 15, insertText: 'synchronized (${1:lock}) {\n\t${2:// body}\n}', detail: 'Synchronized block', sortText: 'a0' },
  { label: 'volatile', kind: 15, insertText: 'volatile ', detail: 'Volatile field modifier', sortText: 'a0' },
  { label: 'transient', kind: 15, insertText: 'transient ', detail: 'Transient field modifier', sortText: 'a0' },
  { label: 'native', kind: 15, insertText: 'native ', detail: 'Native method modifier', sortText: 'a0' },
  { label: 'strictfp', kind: 15, insertText: 'strictfp ', detail: 'Strict floating-point modifier', sortText: 'a0' },
  { label: 'enum', kind: 15, insertText: 'enum ${1:Name} {\n\t${2:VALUE1,}\n\t${3:VALUE2}\n}', detail: 'Enum type', sortText: 'a0' },
  { label: 'assert', kind: 15, insertText: 'assert ${1:condition} : ${2:message};', detail: 'Assert statement', sortText: 'a0' },
];

const JAVA_CLASSES: CompletionEntry[] = [
  { label: 'System', kind: 7, insertText: 'System', detail: 'System class (I/O, exit, etc.)', documentation: 'System.out.println(), System.in, System.exit()', sortText: 'c0' },
  { label: 'System.out.println', kind: 1, insertText: 'System.out.println(${1:object});', detail: 'Print line to stdout', sortText: 'b0' },
  { label: 'System.out.printf', kind: 1, insertText: 'System.out.printf("${1:%s}\\n", ${2:arg});', detail: 'Formatted print to stdout', sortText: 'b0' },
  { label: 'String', kind: 7, insertText: 'String ${1:name} = "${2:value}";', detail: 'String class', sortText: 'c0' },
  { label: 'Integer', kind: 7, insertText: 'Integer', detail: 'Integer wrapper class', sortText: 'c0' },
  { label: 'Long', kind: 7, insertText: 'Long', detail: 'Long wrapper class', sortText: 'c0' },
  { label: 'Double', kind: 7, insertText: 'Double', detail: 'Double wrapper class', sortText: 'c0' },
  { label: 'Float', kind: 7, insertText: 'Float', detail: 'Float wrapper class', sortText: 'c0' },
  { label: 'Boolean', kind: 7, insertText: 'Boolean', detail: 'Boolean wrapper class', sortText: 'c0' },
  { label: 'Character', kind: 7, insertText: 'Character', detail: 'Character wrapper class', sortText: 'c0' },
  { label: 'Object', kind: 7, insertText: 'Object', detail: 'Root of class hierarchy', sortText: 'c0' },
  { label: 'Class', kind: 7, insertText: 'Class', detail: 'Class metadata object', sortText: 'c0' },
  { label: 'Math', kind: 7, insertText: 'Math', detail: 'Mathematical functions', sortText: 'c0' },
  { label: 'Arrays', kind: 7, insertText: 'Arrays', detail: 'Array utility methods', documentation: 'Arrays.sort(), Arrays.toString(), Arrays.asList()', sortText: 'c0' },
  { label: 'Collections', kind: 7, insertText: 'Collections', detail: 'Collection utility methods', sortText: 'c0' },
  { label: 'ArrayList', kind: 7, insertText: 'ArrayList<${1:Type}> ${2:name} = new ArrayList<>();', detail: 'Resizable array implementation', documentation: 'import java.util.ArrayList;', sortText: 'c0' },
  { label: 'HashMap', kind: 7, insertText: 'HashMap<${1:Key}, ${2:Value}> ${3:name} = new HashMap<>();', detail: 'Hash table map implementation', documentation: 'import java.util.HashMap;', sortText: 'c0' },
  { label: 'HashSet', kind: 7, insertText: 'HashSet<${1:Type}> ${2:name} = new HashSet<>();', detail: 'Hash set implementation', documentation: 'import java.util.HashSet;', sortText: 'c0' },
  { label: 'LinkedList', kind: 7, insertText: 'LinkedList<${1:Type}> ${2:name} = new LinkedList<>();', detail: 'Doubly-linked list implementation', documentation: 'import java.util.LinkedList;', sortText: 'c0' },
  { label: 'TreeMap', kind: 7, insertText: 'TreeMap<${1:Key}, ${2:Value}> ${3:name} = new TreeMap<>();', detail: 'Red-black tree map implementation', documentation: 'import java.util.TreeMap;', sortText: 'c0' },
  { label: 'TreeSet', kind: 7, insertText: 'TreeSet<${1:Type}> ${2:name} = new TreeSet<>();', detail: 'Red-black tree set implementation', documentation: 'import java.util.TreeSet;', sortText: 'c0' },
  { label: 'StringBuilder', kind: 7, insertText: 'StringBuilder ${1:sb} = new StringBuilder();', detail: 'Mutable character sequence', documentation: 'import java.lang.StringBuilder;', sortText: 'c0' },
  { label: 'StringBuffer', kind: 7, insertText: 'StringBuffer ${1:sb} = new StringBuffer();', detail: 'Thread-safe mutable character sequence', sortText: 'c0' },
  { label: 'Exception', kind: 7, insertText: 'Exception', detail: 'Base exception class', sortText: 'c0' },
  { label: 'RuntimeException', kind: 7, insertText: 'RuntimeException', detail: 'Runtime exception class', sortText: 'c0' },
  { label: 'Thread', kind: 7, insertText: 'Thread', detail: 'Thread of execution', sortText: 'c0' },
  { label: 'Runnable', kind: 8, insertText: 'Runnable', detail: 'Runnable interface', sortText: 'c0' },
  { label: 'Comparable', kind: 8, insertText: 'Comparable<${1:Type}>', detail: 'Comparable interface', sortText: 'c0' },
  { label: 'Comparator', kind: 8, insertText: 'Comparator<${1:Type}>', detail: 'Comparator interface', sortText: 'c0' },
  { label: 'Iterator', kind: 8, insertText: 'Iterator<${1:Type}>', detail: 'Iterator interface', sortText: 'c0' },
  { label: 'List', kind: 8, insertText: 'List<${1:Type}>', detail: 'List interface', documentation: 'import java.util.List;', sortText: 'c0' },
  { label: 'Map', kind: 8, insertText: 'Map<${1:Key}, ${2:Value}>', detail: 'Map interface', documentation: 'import java.util.Map;', sortText: 'c0' },
  { label: 'Set', kind: 8, insertText: 'Set<${1:Type}>', detail: 'Set interface', documentation: 'import java.util.Set;', sortText: 'c0' },
  { label: 'Scanner', kind: 7, insertText: 'Scanner ${1:sc} = new Scanner(System.in);', detail: 'Input scanner class', documentation: 'import java.util.Scanner;', sortText: 'c0' },
  { label: 'File', kind: 7, insertText: 'File ${1:file} = new File("${2:path}");', detail: 'File representation', documentation: 'import java.io.File;', sortText: 'c0' },
  { label: 'IOException', kind: 7, insertText: 'IOException', detail: 'I/O exception', documentation: 'import java.io.IOException;', sortText: 'c0' },
];

const JAVA_SNIPPETS: CompletionEntry[] = [
  { label: 'main method', kind: 16, insertText: 'public static void main(String[] ${1:args}) {\n\t${2:// code}\n}', detail: 'Main method', sortText: 'd0' },
  { label: 'class', kind: 16, insertText: 'public class ${1:ClassName} {\n\t${2:// fields and methods}\n}', detail: 'Public class', sortText: 'd0' },
  { label: 'class (full)', kind: 16, insertText: 'public class ${1:ClassName} {\n\n\t// Fields\n\tprivate ${2:Type} ${3:field};\n\n\t// Constructor\n\tpublic ${1:ClassName}(${4:Type} ${3:field}) {\n\t\tthis.${3:field} = ${3:field};\n\t}\n\n\t// Methods\n\tpublic ${5:void} ${6:methodName}() {\n\t\t${7:// body}\n\t}\n}', detail: 'Full class template', sortText: 'd0' },
  { label: 'interface', kind: 16, insertText: 'public interface ${1:InterfaceName} {\n\t${2:void methodName();}\n}', detail: 'Interface declaration', sortText: 'd0' },
  { label: 'abstract class', kind: 16, insertText: 'public abstract class ${1:ClassName} {\n\t${2:// abstract methods}\n\n\tpublic abstract ${3:void} ${4:methodName}();\n}', detail: 'Abstract class declaration', sortText: 'd0' },
  { label: 'for-each', kind: 16, insertText: 'for (${1:Type} ${2:item} : ${3:collection}) {\n\t${4:// body}\n}', detail: 'Enhanced for loop', sortText: 'd0' },
  { label: 'try-catch', kind: 16, insertText: 'try {\n\t${1:// body}\n} catch (${2:Exception} ${3:e}) {\n\t${3:e}.printStackTrace();\n}', detail: 'Try-catch block', sortText: 'd0' },
  { label: 'try-with-resources', kind: 16, insertText: 'try (${1:Type} ${2:resource} = new ${1:Type}()) {\n\t${3:// body}\n} catch (${4:Exception} ${5:e}) {\n\t${5:e}.printStackTrace();\n}', detail: 'Try-with-resources', sortText: 'd0' },
  { label: 'ArrayList creation', kind: 16, insertText: 'ArrayList<${1:Type}> ${2:list} = new ArrayList<>();', detail: 'Create ArrayList', sortText: 'd0' },
  { label: 'HashMap creation', kind: 16, insertText: 'HashMap<${1:Key}, ${2:Value}> ${3:map} = new HashMap<>();', detail: 'Create HashMap', sortText: 'd0' },
  { label: 'method', kind: 16, insertText: 'public ${1:void} ${2:methodName}(${3:Type} ${4:param}) {\n\t${5:// body}\n}', detail: 'Public method', sortText: 'd0' },
  { label: 'getter', kind: 16, insertText: 'public ${1:Type} get${2:Property}() {\n\treturn this.${3:field};\n}', detail: 'Getter method', sortText: 'd0' },
  { label: 'setter', kind: 16, insertText: 'public void set${1:Property}(${2:Type} ${3:field}) {\n\tthis.${3:field} = ${3:field};\n}', detail: 'Setter method', sortText: 'd0' },
  { label: 'if-else', kind: 16, insertText: 'if (${1:condition}) {\n\t${2:// if body}\n} else {\n\t${3:// else body}\n}', detail: 'If-else statement', sortText: 'd0' },
  { label: 'System.out.println', kind: 16, insertText: 'System.out.println(${1:object});', detail: 'Print to stdout', sortText: 'd0' },
];

const JAVA_COMPLETIONS: CompletionEntry[] = [
  ...JAVA_KEYWORDS,
  ...JAVA_CLASSES,
  ...JAVA_SNIPPETS,
];

// ─── Completion Data Map ────────────────────────────────────────────────────

const COMPLETION_DATA: Record<string, CompletionEntry[]> = {
  python: PYTHON_COMPLETIONS,
  javascript: JAVASCRIPT_COMPLETIONS,
  c: C_COMPLETIONS,
  cpp: CPP_COMPLETIONS,
  java: JAVA_COMPLETIONS,
};

// Map our internal language key to Monaco language ID
const LANGUAGE_MAP: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
};

// ─── Provider Registration ──────────────────────────────────────────────────

/**
 * Register completion item providers for all 5 languages on the given Monaco instance.
 * Should be called once from `handleEditorMount` in CodeEditor.tsx.
 */
export function registerCompletionProviders(monaco: any): void {
  const triggerCharacters = ['.', '(', '<', ' '];

  for (const [langKey, entries] of Object.entries(COMPLETION_DATA)) {
    const monacoLang = LANGUAGE_MAP[langKey];
    if (!monacoLang) continue;

    monaco.languages.registerCompletionItemProvider(monacoLang, {
      triggerCharacters,

      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions = entries.map((entry) => {
          // Determine if this is a snippet (contains $ placeholders)
          const isSnippet = entry.insertText.includes('$');

          return {
            label: entry.label,
            kind: entry.kind,
            insertText: entry.insertText,
            insertTextRules: isSnippet
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            detail: entry.detail,
            documentation: entry.documentation || undefined,
            sortText: entry.sortText,
            range,
          };
        });

        return { suggestions };
      },
    });
  }
}
