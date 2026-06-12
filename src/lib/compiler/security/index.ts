/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CodeForge Security Analyzer — AST-Based Detection Engine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces the previous regex-based scanner with a true AST walker that
 * understands code structure, import chains, and variable aliases.
 *
 * Key advantages over regex:
 *   - Distinguishes function calls from strings containing function names
 *   - Tracks import aliases (`import os as x` → `x.system()` is flagged)
 *   - Ignores code inside comments (already filtered by the lexer)
 *   - Understands scope: local variable `eval` doesn't shadow builtin
 *   - Traces member expression chains: `os.system`, `subprocess.call`
 */

import {
  ASTNode,
  ASTNodeType,
  SecuritySeverity,
  SecurityCategory,
  SecurityFinding,
  SecurityReport,
  SecurityStats,
  SupportedLanguage,
  normalizeLanguage,
  InferredType,
  TypeKind,
} from '../types';

// ─── Import Tracking ─────────────────────────────────────────────────────────

interface ImportEntry {
  /** The original module path (e.g., "os", "child_process") */
  module: string;
  /** The local alias used in code (e.g., "operating_system" for `import os as operating_system`) */
  localName: string;
  /** Whether this is a wildcard import (from X import *) */
  isWildcard: boolean;
  /** Specific names imported (for `from os import system, path`) */
  importedNames: string[];
  /** Whether this import is from a `from` statement */
  isFromImport: boolean;
}

// ─── Dangerous Pattern Definitions ───────────────────────────────────────────

interface DangerousCall {
  /** Full qualified name to match (e.g., "os.system", "subprocess.call") */
  qualifiedName: string;
  /** Simple name for direct calls (e.g., "eval", "system") */
  simpleName: string;
  /** The module this belongs to (for import-tracking, e.g., "os") */
  module: string;
  /** Category of the security violation */
  category: SecurityCategory;
  /** Severity level */
  severity: SecuritySeverity;
  /** Human-readable description */
  message: string;
  /** Languages this applies to */
  languages: SupportedLanguage[];
}

interface DangerousMember {
  /** Full qualified name (e.g., "process.env", "os.environ") */
  qualifiedName: string;
  /** Module part (e.g., "process", "os") */
  module: string;
  /** Property part (e.g., "env", "environ") */
  property: string;
  /** Category */
  category: SecurityCategory;
  /** Severity */
  severity: SecuritySeverity;
  /** Description */
  message: string;
  /** Languages */
  languages: SupportedLanguage[];
}

interface DangerousImport {
  /** Module name (e.g., "os", "subprocess", "child_process") */
  module: string;
  /** Category */
  category: SecurityCategory;
  /** Severity */
  severity: SecuritySeverity;
  /** Description */
  message: string;
  /** Languages */
  languages: SupportedLanguage[];
}

interface DangerousConstructor {
  /** Class name (e.g., "Socket", "ProcessBuilder") */
  className: string;
  /** Qualified name including package (e.g., "java.net.Socket") */
  qualifiedName: string;
  /** Category */
  category: SecurityCategory;
  /** Severity */
  severity: SecuritySeverity;
  /** Description */
  message: string;
  /** Languages */
  languages: SupportedLanguage[];
}

// ─── Rule Databases ──────────────────────────────────────────────────────────

const DANGEROUS_CALLS: DangerousCall[] = [
  // ── System Execution ──
  { qualifiedName: 'os.system', simpleName: 'system', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.system() executes shell commands and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.popen', simpleName: 'popen', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.popen() executes shell commands and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.fork', simpleName: 'fork', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.fork() creates processes and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.kill', simpleName: 'kill', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.kill() sends signals to processes and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execl', simpleName: 'execl', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execle', simpleName: 'execle', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execlp', simpleName: 'execlp', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execlpe', simpleName: 'execlpe', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execv', simpleName: 'execv', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execve', simpleName: 'execve', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execvp', simpleName: 'execvp', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'os.execvpe', simpleName: 'execvpe', module: 'os', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'os.exec*() replaces the current process and is forbidden', languages: ['python'] },
  { qualifiedName: 'subprocess.call', simpleName: 'call', module: 'subprocess', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'subprocess.call() executes processes and is forbidden', languages: ['python'] },
  { qualifiedName: 'subprocess.run', simpleName: 'run', module: 'subprocess', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'subprocess.run() executes processes and is forbidden', languages: ['python'] },
  { qualifiedName: 'subprocess.Popen', simpleName: 'Popen', module: 'subprocess', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'subprocess.Popen() executes processes and is forbidden', languages: ['python'] },
  { qualifiedName: 'subprocess.check_output', simpleName: 'check_output', module: 'subprocess', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'subprocess.check_output() executes processes and is forbidden', languages: ['python'] },
  { qualifiedName: 'subprocess.check_call', simpleName: 'check_call', module: 'subprocess', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'subprocess.check_call() executes processes and is forbidden', languages: ['python'] },
  // JavaScript system execution
  { qualifiedName: 'child_process.exec', simpleName: 'exec', module: 'child_process', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'child_process.exec() executes shell commands and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'child_process.spawn', simpleName: 'spawn', module: 'child_process', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'child_process.spawn() launches processes and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'child_process.execSync', simpleName: 'execSync', module: 'child_process', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'child_process.execSync() executes shell commands synchronously and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'child_process.spawnSync', simpleName: 'spawnSync', module: 'child_process', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'child_process.spawnSync() launches processes synchronously and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'child_process.execFile', simpleName: 'execFile', module: 'child_process', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'child_process.execFile() executes files and is forbidden', languages: ['javascript'] },
  // Java system execution
  { qualifiedName: 'Runtime.exec', simpleName: 'exec', module: 'Runtime', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'Runtime.exec() executes system commands and is forbidden', languages: ['java'] },
  // C/C++ system execution
  { qualifiedName: 'system', simpleName: 'system', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'system() executes shell commands and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'popen', simpleName: 'popen', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'popen() executes shell commands and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'fork', simpleName: 'fork', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'fork() creates child processes and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'execl', simpleName: 'execl', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'execl() replaces the current process and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'execle', simpleName: 'execle', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'execle() replaces the current process and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'execlp', simpleName: 'execlp', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'execlp() replaces the current process and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'execv', simpleName: 'execv', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'execv() replaces the current process and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'execve', simpleName: 'execve', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'execve() replaces the current process and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'execvp', simpleName: 'execvp', module: '', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'execvp() replaces the current process and is forbidden', languages: ['c', 'cpp'] },

  // ── Dynamic Code ──
  { qualifiedName: 'eval', simpleName: 'eval', module: '', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'eval() executes arbitrary code and is forbidden', languages: ['python', 'javascript'] },
  { qualifiedName: 'exec', simpleName: 'exec', module: '', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'exec() executes arbitrary code and is forbidden', languages: ['python'] },
  { qualifiedName: 'compile', simpleName: 'compile', module: '', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'compile() dynamically compiles code and is forbidden', languages: ['python'] },
  { qualifiedName: '__import__', simpleName: '__import__', module: '', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: '__import__() dynamically imports modules and is forbidden', languages: ['python'] },
  { qualifiedName: 'vm.runInNewContext', simpleName: 'runInNewContext', module: 'vm', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'vm.runInNewContext() executes arbitrary code and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'vm.runInThisContext', simpleName: 'runInThisContext', module: 'vm', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'vm.runInThisContext() executes arbitrary code and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'vm.runInContext', simpleName: 'runInContext', module: 'vm', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'vm.runInContext() executes arbitrary code and is forbidden', languages: ['javascript'] },
  { qualifiedName: 'vm.compileFunction', simpleName: 'compileFunction', module: 'vm', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'vm.compileFunction() compiles arbitrary code and is forbidden', languages: ['javascript'] },

  // ── File Access ──
  { qualifiedName: 'os.remove', simpleName: 'remove', module: 'os', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'os.remove() deletes files and is restricted', languages: ['python'] },
  { qualifiedName: 'os.rename', simpleName: 'rename', module: 'os', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'os.rename() renames files and is restricted', languages: ['python'] },
  { qualifiedName: 'shutil.rmtree', simpleName: 'rmtree', module: 'shutil', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'shutil.rmtree() deletes directory trees and is restricted', languages: ['python'] },
  { qualifiedName: 'Files.delete', simpleName: 'delete', module: 'Files', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'Files.delete() deletes files and is restricted', languages: ['java'] },
  // C/C++ file access
  { qualifiedName: 'remove', simpleName: 'remove', module: '', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'remove() deletes files and is restricted', languages: ['c', 'cpp'] },
  { qualifiedName: 'rename', simpleName: 'rename', module: '', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'rename() renames files and is restricted', languages: ['c', 'cpp'] },

  // ── Network Access ──
  { qualifiedName: 'socket.socket', simpleName: 'socket', module: 'socket', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'socket.socket() creates network sockets and is forbidden', languages: ['python'] },
  { qualifiedName: 'socket.connect', simpleName: 'connect', module: 'socket', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'socket.connect() initiates network connections and is forbidden', languages: ['python'] },
  { qualifiedName: 'socket.bind', simpleName: 'bind', module: 'socket', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'socket.bind() binds to network addresses and is forbidden', languages: ['python'] },
  { qualifiedName: 'urllib.request.urlopen', simpleName: 'urlopen', module: 'urllib', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'urllib.request.urlopen() makes network requests and is forbidden', languages: ['python'] },
  { qualifiedName: 'requests.get', simpleName: 'get', module: 'requests', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'requests.get() makes HTTP requests and is forbidden', languages: ['python'] },
  { qualifiedName: 'requests.post', simpleName: 'post', module: 'requests', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'requests.post() makes HTTP requests and is forbidden', languages: ['python'] },
  { qualifiedName: 'http.client.HTTPConnection', simpleName: 'HTTPConnection', module: 'http', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'http.client.HTTPConnection creates HTTP connections and is forbidden', languages: ['python'] },
  // C/C++ network access
  { qualifiedName: 'connect', simpleName: 'connect', module: '', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'connect() initiates network connections and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'bind', simpleName: 'bind', module: '', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'bind() binds to network addresses and is forbidden', languages: ['c', 'cpp'] },

  // ── Memory Manipulation ──
  { qualifiedName: 'ptrace', simpleName: 'ptrace', module: '', category: SecurityCategory.MemoryManipulation, severity: SecuritySeverity.High, message: 'ptrace() manipulates process memory and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'mmap', simpleName: 'mmap', module: '', category: SecurityCategory.MemoryManipulation, severity: SecuritySeverity.High, message: 'mmap() maps memory regions and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'mprotect', simpleName: 'mprotect', module: '', category: SecurityCategory.MemoryManipulation, severity: SecuritySeverity.High, message: 'mprotect() changes memory protections and is forbidden', languages: ['c', 'cpp'] },

  // ── Privilege Escalation ──
  { qualifiedName: 'setuid', simpleName: 'setuid', module: '', category: SecurityCategory.PrivilegeEscalation, severity: SecuritySeverity.High, message: 'setuid() changes user ID and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'setgid', simpleName: 'setgid', module: '', category: SecurityCategory.PrivilegeEscalation, severity: SecuritySeverity.High, message: 'setgid() changes group ID and is forbidden', languages: ['c', 'cpp'] },
  { qualifiedName: 'seteuid', simpleName: 'seteuid', module: '', category: SecurityCategory.PrivilegeEscalation, severity: SecuritySeverity.High, message: 'seteuid() changes effective user ID and is forbidden', languages: ['c', 'cpp'] },

  // ── Unsafe Operations ──
  { qualifiedName: 'signal.alarm', simpleName: 'alarm', module: 'signal', category: SecurityCategory.UnsafeOperation, severity: SecuritySeverity.Low, message: 'signal.alarm() schedules signals and is restricted', languages: ['python'] },
  { qualifiedName: 'signal.kill', simpleName: 'kill', module: 'signal', category: SecurityCategory.UnsafeOperation, severity: SecuritySeverity.Low, message: 'signal.kill() sends signals to processes and is restricted', languages: ['python'] },
  { qualifiedName: 'process.exit', simpleName: 'exit', module: 'process', category: SecurityCategory.UnsafeOperation, severity: SecuritySeverity.Low, message: 'process.exit() terminates the process and is restricted', languages: ['javascript'] },
];

const DANGEROUS_MEMBERS: DangerousMember[] = [
  // ── Information Leak ──
  { qualifiedName: 'os.environ', module: 'os', property: 'environ', category: SecurityCategory.InformationLeak, severity: SecuritySeverity.Low, message: 'os.environ exposes environment variables', languages: ['python'] },
  { qualifiedName: 'sys.path', module: 'sys', property: 'path', category: SecurityCategory.InformationLeak, severity: SecuritySeverity.Low, message: 'sys.path exposes system paths', languages: ['python'] },
  { qualifiedName: 'process.env', module: 'process', property: 'env', category: SecurityCategory.InformationLeak, severity: SecuritySeverity.Low, message: 'process.env exposes environment variables', languages: ['javascript'] },
  { qualifiedName: 'process.argv', module: 'process', property: 'argv', category: SecurityCategory.InformationLeak, severity: SecuritySeverity.Low, message: 'process.argv exposes command-line arguments', languages: ['javascript'] },
];

const DANGEROUS_IMPORTS: DangerousImport[] = [
  // Python
  { module: 'os', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "os" provides system access capabilities', languages: ['python'] },
  { module: 'subprocess', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "subprocess" provides process execution capabilities', languages: ['python'] },
  { module: 'ctypes', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "ctypes" provides FFI/memory manipulation capabilities', languages: ['python'] },
  { module: 'socket', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "socket" provides network access capabilities', languages: ['python'] },
  { module: 'signal', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "signal" provides signal handling capabilities', languages: ['python'] },
  { module: 'shutil', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "shutil" provides file manipulation capabilities', languages: ['python'] },
  // JavaScript
  { module: 'child_process', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "child_process" provides process execution capabilities', languages: ['javascript'] },
  { module: 'fs', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "fs" provides filesystem access capabilities', languages: ['javascript'] },
  { module: 'net', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "net" provides network access capabilities', languages: ['javascript'] },
  { module: 'http', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "http" provides HTTP server/client capabilities', languages: ['javascript'] },
  { module: 'https', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "https" provides HTTPS capabilities', languages: ['javascript'] },
  { module: 'os', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "os" provides operating system capabilities', languages: ['javascript'] },
  { module: 'vm', category: SecurityCategory.DangerousImport, severity: SecuritySeverity.Medium, message: 'Importing "vm" provides dynamic code execution capabilities', languages: ['javascript'] },
];

const DANGEROUS_CONSTRUCTORS: DangerousConstructor[] = [
  // JavaScript
  { className: 'Function', qualifiedName: 'Function', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'new Function() creates dynamic code and is forbidden', languages: ['javascript'] },
  // Java
  { className: 'ProcessBuilder', qualifiedName: 'ProcessBuilder', category: SecurityCategory.SystemExecution, severity: SecuritySeverity.Critical, message: 'ProcessBuilder executes system commands and is forbidden', languages: ['java'] },
  { className: 'Socket', qualifiedName: 'java.net.Socket', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'Socket creates network connections and is forbidden', languages: ['java'] },
  { className: 'ServerSocket', qualifiedName: 'java.net.ServerSocket', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'ServerSocket listens for network connections and is forbidden', languages: ['java'] },
  { className: 'FileWriter', qualifiedName: 'FileWriter', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'FileWriter writes to the filesystem and is restricted', languages: ['java'] },
  { className: 'FileOutputStream', qualifiedName: 'FileOutputStream', category: SecurityCategory.FileAccess, severity: SecuritySeverity.Medium, message: 'FileOutputStream writes to the filesystem and is restricted', languages: ['java'] },
  { className: 'URL', qualifiedName: 'java.net.URL', category: SecurityCategory.NetworkAccess, severity: SecuritySeverity.High, message: 'URL can open network connections and is forbidden', languages: ['java'] },
  // C/C++
  { className: 'dlopen', qualifiedName: 'dlopen', category: SecurityCategory.DynamicCode, severity: SecuritySeverity.Critical, message: 'dlopen() loads dynamic libraries and is forbidden', languages: ['c', 'cpp'] },
];

// ─── AST Helper Functions ────────────────────────────────────────────────────

/**
 * Safely extract a string property from an AST node's props.
 * Returns null if the property doesn't exist or isn't a string.
 */
function getStringProp(node: ASTNode, key: string): string | null {
  const val = node.props[key];
  return typeof val === 'string' ? val : null;
}

/**
 * Safely extract a number property from an AST node's props.
 * Returns null if the property doesn't exist or isn't a number.
 */
function getNumberProp(node: ASTNode, key: string): number | null {
  const val = node.props[key];
  return typeof val === 'number' ? val : null;
}

/**
 * Safely extract a boolean property from an AST node's props.
 * Returns null if the property doesn't exist or isn't a boolean.
 */
function getBooleanProp(node: ASTNode, key: string): boolean | null {
  const val = node.props[key];
  return typeof val === 'boolean' ? val : null;
}

/**
 * Safely extract an ASTNode property from another AST node's props.
 * Returns null if the property doesn't exist or isn't an ASTNode-like object.
 */
function getNodeProp(node: ASTNode, key: string): ASTNode | null {
  const val = node.props[key];
  if (val && typeof val === 'object' && 'type' in val && 'props' in val) {
    return val as ASTNode;
  }
  return null;
}

/**
 * Safely extract an array of ASTNodes from a node's props.
 */
function getNodeArrayProp(node: ASTNode, key: string): ASTNode[] {
  const val = node.props[key];
  if (Array.isArray(val)) {
    return val.filter((item): item is ASTNode =>
      item != null && typeof item === 'object' && 'type' in item && 'props' in item
    );
  }
  return [];
}

/**
 * Get the name of an identifier node, or null if it's not an identifier.
 */
function getIdentifierName(node: ASTNode): string | null {
  if (node.type === ASTNodeType.Identifier) {
    return getStringProp(node, 'name');
  }
  return null;
}

/**
 * Resolve a chain of member accesses into a dotted qualified name.
 * For example: os.system → "os.system"
 * Also returns the object name for import tracking.
 */
function resolveQualifiedName(node: ASTNode): { qualified: string; objectName: string; propertyName: string } | null {
  if (node.type === ASTNodeType.Identifier) {
    const name = getStringProp(node, 'name');
    if (name) {
      return { qualified: name, objectName: name, propertyName: name };
    }
    return null;
  }

  if (node.type === ASTNodeType.MemberExpression) {
    // Try props first, then fall back to children
    let objectNode = getNodeProp(node, 'object');
    let propertyNode = getNodeProp(node, 'property');

    if (!objectNode || !propertyNode) {
      const children = node.children ?? [];
      if (children.length >= 2) {
        objectNode = objectNode ?? children[0];
        propertyNode = propertyNode ?? children[1];
      }
    }

    if (!objectNode || !propertyNode) return null;

    const objectRes = resolveQualifiedName(objectNode);
    if (!objectRes) return null;

    const propName = getIdentifierName(propertyNode) ?? getStringProp(propertyNode, 'name');
    if (!propName) return null;

    return {
      qualified: `${objectRes.qualified}.${propName}`,
      objectName: objectRes.qualified.split('.')[0],
      propertyName: propName,
    };
  }

  return null;
}

/**
 * Check if a node represents a truthy constant value (true, 1, non-zero number).
 * Used for infinite loop detection.
 */
function isTruthyConstant(node: ASTNode): boolean {
  if (node.type === ASTNodeType.BooleanLiteral) {
    const val = getBooleanProp(node, 'value');
    return val === true;
  }
  if (node.type === ASTNodeType.NumberLiteral) {
    const val = getNumberProp(node, 'value');
    return val !== null && val !== 0;
  }
  if (node.type === ASTNodeType.Identifier) {
    const name = getStringProp(node, 'name');
    // Python's True
    return name === 'True';
  }
  return false;
}

/**
 * Check if a while/for test condition indicates an infinite loop.
 */
function isInfiniteLoopCondition(node: ASTNode | null): boolean {
  if (!node) return false;

  // while(true), while(1), while True
  if (isTruthyConstant(node)) return true;

  // for(;;) — the ForStatement with no test condition
  // This is handled in the ForStatement visitor itself

  return false;
}

// ─── Security Analyzer Class ─────────────────────────────────────────────────

class SecurityAnalyzer {
  private findings: SecurityFinding[] = [];
  private imports: ImportEntry[] = [];
  private language: SupportedLanguage;
  /** Map from local alias to module path for import tracking */
  private importAliasMap: Map<string, string> = new Map();
  /** Map from imported name to source module (for from-imports) */
  private fromImportMap: Map<string, string> = new Map();
  /** Set of modules that have wildcard imports */
  private wildcardImports: Set<string> = new Set();
  /** Count of total nodes checked for stats */
  private totalChecks = 0;

  constructor(language: SupportedLanguage) {
    this.language = language;
  }

  /**
   * Main analysis entry point. Walks the AST tree and collects findings.
   */
  analyze(ast: ASTNode): SecurityReport {
    this.findings = [];
    this.imports = [];
    this.importAliasMap = new Map();
    this.fromImportMap = new Map();
    this.wildcardImports = new Set();
    this.totalChecks = 0;

    // Phase 1: Collect all imports first so we can track aliases
    this.collectImports(ast);

    // Phase 2: Walk the AST for security violations
    this.walk(ast);

    // Phase 3: Build and return the report
    return this.buildReport();
  }

  // ── Phase 1: Import Collection ───────────────────────────────────────────

  /**
   * First pass: collect all import declarations to build alias maps.
   */
  private collectImports(node: ASTNode): void {
    if (node.type === ASTNodeType.ImportDecl) {
      this.processImportNode(node);
    }

    // Recurse into children
    const children = node.children ?? [];
    for (const child of children) {
      this.collectImports(child);
    }
  }

  /**
   * Process a single ImportDecl node and record its information.
   */
  private processImportNode(node: ASTNode): void {
    // Source module name — try multiple prop names, then fall back to children
    let source = getStringProp(node, 'source') ?? getStringProp(node, 'module') ?? '';

    // Import kind: "import" vs "from"
    const kind = getStringProp(node, 'importKind') ?? getStringProp(node, 'kind') ?? 'import';

    // For simple `import X`, extract the module name from children (Identifier nodes)
    if (!source && kind === 'import') {
      const children = node.children ?? [];
      for (const child of children) {
        const childName = getIdentifierName(child) ?? getStringProp(child, 'name') ?? '';
        if (childName) {
          source = childName;
          const childAlias = getStringProp(child, 'alias');
          // Register the alias mapping
          this.importAliasMap.set(childAlias ?? childName, childName);

          const entry: ImportEntry = {
            module: childName,
            localName: childAlias ?? childName,
            isWildcard: false,
            importedNames: [],
            isFromImport: false,
          };
          this.imports.push(entry);
        }
      }
      return;
    }

    if (!source) return;

    // Alias for the whole module (e.g., `import os as operating_system`)
    const alias = getStringProp(node, 'alias') ?? null;

    // Specifiers: individual imported names (e.g., `from os import system, path`)
    const specifiers = getNodeArrayProp(node, 'specifiers');

    const entry: ImportEntry = {
      module: source,
      localName: alias ?? source,
      isWildcard: false,
      importedNames: [],
      isFromImport: kind === 'from',
    };

    if (kind === 'from') {
      if (specifiers.length > 0) {
        for (const spec of specifiers) {
          const specName = getIdentifierName(spec) ?? getStringProp(spec, 'name') ?? '';
          const specAlias = getStringProp(spec, 'alias') ?? null;

          if (specName === '*') {
            entry.isWildcard = true;
            this.wildcardImports.add(source);
          } else {
            entry.importedNames.push(specName);
            this.fromImportMap.set(specAlias ?? specName, source);
          }
        }
      } else {
        // `from X import *` without explicit specifiers
        entry.isWildcard = true;
        this.wildcardImports.add(source);
      }
    }

    // Register the alias mapping
    this.importAliasMap.set(alias ?? source, source);

    this.imports.push(entry);
  }

  // ── Phase 2: AST Walking ─────────────────────────────────────────────────

  /**
   * Recursively walk the AST tree, checking each node for security violations.
   */
  private walk(node: ASTNode): void {
    this.totalChecks++;

    // Dispatch to specific checkers based on node type
    switch (node.type) {
      case ASTNodeType.CallExpression:
        this.checkCallExpression(node);
        break;
      case ASTNodeType.MemberExpression:
        this.checkMemberExpression(node);
        break;
      case ASTNodeType.ImportDecl:
        this.checkImportDeclaration(node);
        break;
      case ASTNodeType.NewExpression:
        this.checkNewExpression(node);
        break;
      case ASTNodeType.WhileStatement:
        this.checkWhileStatement(node);
        break;
      case ASTNodeType.ForStatement:
        this.checkForStatement(node);
        break;
      case ASTNodeType.VariableDecl:
        this.checkVariableDecl(node);
        break;
      case ASTNodeType.AssignmentExpression:
        this.checkAssignmentExpression(node);
        break;
      default:
        break;
    }

    // Recurse into children
    const children = node.children ?? [];
    for (const child of children) {
      this.walk(child);
    }
  }

  // ── Call Expression Checker ──────────────────────────────────────────────

  /**
   * Check a CallExpression for dangerous function calls.
   *
   * This is the core of the analyzer. It resolves the callee to a qualified
   * name and checks it against our dangerous patterns, considering:
   *   - Direct calls: eval(), system()
   *   - Member calls: os.system(), subprocess.call()
   *   - Import aliases: if `os` is aliased to `op_sys`, `op_sys.system()` is flagged
   *   - From-imports: if `from os import system`, then `system()` is flagged
   */
  private checkCallExpression(node: ASTNode): void {
    // Try to get callee from props first, then from first child
    let callee = getNodeProp(node, 'callee');
    if (!callee) {
      // Parser puts callee as first child (children[0])
      const children = node.children ?? [];
      if (children.length > 0) {
        callee = children[0];
      }
    }
    if (!callee) return;

    // Resolve the callee to a qualified name
    const resolved = resolveQualifiedName(callee);
    if (!resolved) return;

    const { qualified, objectName, propertyName } = resolved;

    // Check against dangerous calls database
    for (const rule of DANGEROUS_CALLS) {
      if (!rule.languages.includes(this.language)) continue;

      // Match by full qualified name (e.g., "os.system")
      if (qualified === rule.qualifiedName) {
        this.addFinding(rule.category, rule.severity, rule.message, `call.${rule.qualifiedName}`, node);
        return; // One finding per call
      }
    }

    // Check using import alias resolution
    // If objectName is an alias for a dangerous module, resolve it
    const resolvedModule = this.importAliasMap.get(objectName);
    if (resolvedModule) {
      const resolvedQualified = `${resolvedModule}.${propertyName}`;
      for (const rule of DANGEROUS_CALLS) {
        if (!rule.languages.includes(this.language)) continue;
        if (resolvedQualified === rule.qualifiedName) {
          this.addFinding(rule.category, rule.severity, rule.message, `call.alias.${rule.qualifiedName}`, node);
          return;
        }
      }
    }

    // Check from-imports: if the simple name was imported from a dangerous module
    const fromModule = this.fromImportMap.get(objectName === qualified ? objectName : '');
    if (fromModule) {
      const fromQualified = `${fromModule}.${propertyName}`;
      for (const rule of DANGEROUS_CALLS) {
        if (!rule.languages.includes(this.language)) continue;
        if (fromQualified === rule.qualifiedName) {
          this.addFinding(rule.category, rule.severity, rule.message, `call.from-import.${rule.qualifiedName}`, node);
          return;
        }
      }
    }

    // Check simple name matches for from-imported functions
    // e.g., `from os import system` → `system()` should be caught
    if (qualified === objectName && qualified === propertyName) {
      const fromSource = this.fromImportMap.get(qualified);
      if (fromSource) {
        const fromQualified = `${fromSource}.${qualified}`;
        for (const rule of DANGEROUS_CALLS) {
          if (!rule.languages.includes(this.language)) continue;
          if (fromQualified === rule.qualifiedName) {
            this.addFinding(rule.category, rule.severity, rule.message, `call.from-import-simple.${rule.qualifiedName}`, node);
            return;
          }
        }
      }
    }

    // Check wildcard imports: if any wildcard import module has this method
    for (const wildModule of Array.from(this.wildcardImports)) {
      const wildQualified = `${wildModule}.${qualified.includes('.') ? qualified.split('.').pop()! : qualified}`;
      for (const rule of DANGEROUS_CALLS) {
        if (!rule.languages.includes(this.language)) continue;
        if (wildQualified === rule.qualifiedName) {
          this.addFinding(rule.category, rule.severity, rule.message, `call.wildcard.${rule.qualifiedName}`, node);
          return;
        }
      }
    }

    // ── Python open() with write mode ──
    if (this.language === 'python' && qualified === 'open') {
      this.checkPythonOpenWriteMode(node);
    }

    // ── Python range() with very large values ──
    if (this.language === 'python' && qualified === 'range') {
      this.checkPythonLargeRange(node);
    }

    // ── JavaScript setInterval without clearInterval ──
    if (this.language === 'javascript' && qualified === 'setInterval') {
      this.addFinding(
        SecurityCategory.UnsafeOperation,
        SecuritySeverity.Low,
        'setInterval() may run indefinitely without clearInterval',
        'call.setInterval',
        node
      );
    }

    // ── JavaScript fs.* methods ──
    if (this.language === 'javascript') {
      const fsResolved = this.resolveFsCall(qualified, objectName);
      if (fsResolved) {
        this.addFinding(
          SecurityCategory.FileAccess,
          SecuritySeverity.Medium,
          `fs.${fsResolved}() accesses the filesystem and is restricted`,
          `call.fs.${fsResolved}`,
          node
        );
      }
    }

    // ── Python ctypes.* calls ──
    if (this.language === 'python') {
      const ctResolved = this.resolveCtypesCall(qualified, objectName);
      if (ctResolved) {
        this.addFinding(
          SecurityCategory.MemoryManipulation,
          SecuritySeverity.High,
          `ctypes.${ctResolved}() manipulates memory and is forbidden`,
          `call.ctypes.${ctResolved}`,
          node
        );
      }
    }

    // ── Java System.getenv() ──
    if (this.language === 'java' && qualified === 'System.getenv') {
      this.addFinding(
        SecurityCategory.InformationLeak,
        SecuritySeverity.Low,
        'System.getenv() exposes environment variables',
        'call.System.getenv',
        node
      );
    }

    // ── Java URL.openConnection() ──
    if (this.language === 'java' && qualified.endsWith('.openConnection')) {
      this.addFinding(
        SecurityCategory.NetworkAccess,
        SecuritySeverity.High,
        'URL.openConnection() creates network connections and is forbidden',
        'call.URL.openConnection',
        node
      );
    }

    // ── Java Thread.sleep() with very long timeout ──
    if (this.language === 'java' && qualified === 'Thread.sleep') {
      this.checkJavaThreadSleep(node);
    }

    // ── Java ScriptEngine ──
    if (this.language === 'java' && (qualified.endsWith('.eval') || qualified.includes('ScriptEngine'))) {
      const scriptEnginePattern = /ScriptEngine.*eval|eval.*ScriptEngine/;
      if (qualified.includes('ScriptEngine') || qualified.includes('eval')) {
        this.addFinding(
          SecurityCategory.DynamicCode,
          SecuritySeverity.Critical,
          'ScriptEngine.eval() executes dynamic code and is forbidden',
          'call.ScriptEngine.eval',
          node
        );
      }
    }

    // ── Java ClassLoader ──
    if (this.language === 'java' && qualified.includes('ClassLoader')) {
      this.addFinding(
        SecurityCategory.DynamicCode,
        SecuritySeverity.Critical,
        'ClassLoader dynamically loads classes and is forbidden',
        'call.ClassLoader',
        node
      );
    }

    // ── Java Reflection ──
    if (this.language === 'java' && qualified.includes('setAccessible')) {
      const args = getNodeArrayProp(node, 'arguments');
      if (args.length > 0) {
        const firstArg = args[0];
        if (firstArg.type === ASTNodeType.BooleanLiteral && getBooleanProp(firstArg, 'value') === true) {
          this.addFinding(
            SecurityCategory.PrivilegeEscalation,
            SecuritySeverity.High,
            'setAccessible(true) bypasses access controls and is forbidden',
            'call.setAccessible.true',
            node
          );
        }
      }
    }

    // ── C/C++ fopen() with write mode ──
    if ((this.language === 'c' || this.language === 'cpp') && qualified === 'fopen') {
      this.checkCFopenWriteMode(node);
    }

    // ── C/C++ socket() call ──
    if ((this.language === 'c' || this.language === 'cpp') && qualified === 'socket') {
      this.addFinding(
        SecurityCategory.NetworkAccess,
        SecuritySeverity.High,
        'socket() creates network sockets and is forbidden',
        'call.socket',
        node
      );
    }
  }

  // ── Member Expression Checker ────────────────────────────────────────────

  /**
   * Check a MemberExpression for dangerous property access.
   * Catches things like `process.env`, `os.environ`, `__dict__`.
   */
  private checkMemberExpression(node: ASTNode): void {
    const resolved = resolveQualifiedName(node);
    if (!resolved) return;

    const { qualified, objectName, propertyName } = resolved;

    // Check against dangerous member access database
    for (const rule of DANGEROUS_MEMBERS) {
      if (!rule.languages.includes(this.language)) continue;

      if (qualified === rule.qualifiedName) {
        this.addFinding(rule.category, rule.severity, rule.message, `member.${rule.qualifiedName}`, node);
        return;
      }
    }

    // Check via import alias
    const resolvedModule = this.importAliasMap.get(objectName);
    if (resolvedModule) {
      const resolvedQualified = `${resolvedModule}.${propertyName}`;
      for (const rule of DANGEROUS_MEMBERS) {
        if (!rule.languages.includes(this.language)) continue;
        if (resolvedQualified === rule.qualifiedName) {
          this.addFinding(rule.category, rule.severity, rule.message, `member.alias.${rule.qualifiedName}`, node);
          return;
        }
      }
    }

    // Python __dict__ access
    if (this.language === 'python' && propertyName === '__dict__') {
      this.addFinding(
        SecurityCategory.InformationLeak,
        SecuritySeverity.Low,
        '__dict__ exposes object internals',
        'member.__dict__',
        node
      );
    }

    // JavaScript fs.* member access (e.g., `fs.readFileSync`)
    if (this.language === 'javascript' && objectName === 'fs') {
      this.addFinding(
        SecurityCategory.FileAccess,
        SecuritySeverity.Medium,
        `fs.${propertyName} accesses the filesystem and is restricted`,
        `member.fs.${propertyName}`,
        node
      );
    }

    // JavaScript fs via alias
    if (this.language === 'javascript') {
      const fsResolved = this.importAliasMap.get(objectName);
      if (fsResolved === 'fs') {
        this.addFinding(
          SecurityCategory.FileAccess,
          SecuritySeverity.Medium,
          `fs.${propertyName} accesses the filesystem and is restricted`,
          `member.fs-alias.${propertyName}`,
          node
        );
      }
    }

    // Python ctypes.* member access
    if (this.language === 'python' && objectName === 'ctypes') {
      this.addFinding(
        SecurityCategory.MemoryManipulation,
        SecuritySeverity.High,
        `ctypes.${propertyName} manipulates memory and is forbidden`,
        `member.ctypes.${propertyName}`,
        node
      );
    }

    // Python ctypes via alias
    if (this.language === 'python') {
      const ctResolved = this.importAliasMap.get(objectName);
      if (ctResolved === 'ctypes') {
        this.addFinding(
          SecurityCategory.MemoryManipulation,
          SecuritySeverity.High,
          `ctypes.${propertyName} manipulates memory and is forbidden`,
          `member.ctypes-alias.${propertyName}`,
          node
        );
      }
    }

    // JavaScript net.* / http.* / https.* member access
    if (this.language === 'javascript') {
      const netModules = ['net', 'http', 'https'];
      if (netModules.includes(objectName)) {
        this.addFinding(
          SecurityCategory.NetworkAccess,
          SecuritySeverity.High,
          `${objectName}.${propertyName} accesses the network and is forbidden`,
          `member.${objectName}.${propertyName}`,
          node
        );
      }
      // Check via alias
      const aliasResolved = this.importAliasMap.get(objectName);
      if (aliasResolved && netModules.includes(aliasResolved)) {
        this.addFinding(
          SecurityCategory.NetworkAccess,
          SecuritySeverity.High,
          `${aliasResolved}.${propertyName} accesses the network and is forbidden`,
          `member.${aliasResolved}-alias.${propertyName}`,
          node
        );
      }
    }
  }

  // ── Import Declaration Checker ───────────────────────────────────────────

  /**
   * Check an ImportDecl node for dangerous imports.
   */
  private checkImportDeclaration(node: ASTNode): void {
    // Try to get source from props first, then from children
    let source = getStringProp(node, 'source') ?? getStringProp(node, 'module') ?? '';
    const kind = getStringProp(node, 'importKind') ?? getStringProp(node, 'kind') ?? 'import';

    // For simple `import X`, extract module name from children
    if (!source && kind === 'import') {
      const children = node.children ?? [];
      for (const child of children) {
        const childName = getIdentifierName(child) ?? getStringProp(child, 'name') ?? '';
        if (childName) {
          // Check each imported module name against dangerous imports
          this.checkModuleName(childName, node);
        }
      }
      return;
    }

    if (!source) return;

    this.checkModuleName(source, node);

    // Python: also check from-imports for submodules
    if (this.language === 'python') {
      const pythonDangerousRoots = ['os', 'subprocess', 'ctypes', 'socket', 'signal', 'shutil'];
      for (const root of pythonDangerousRoots) {
        if (source === root || source.startsWith(`${root}.`)) {
          const existingRule = DANGEROUS_IMPORTS.find(
            r => r.module === root && r.languages.includes('python')
          );
          if (existingRule) {
            this.addFinding(existingRule.category, existingRule.severity, existingRule.message, `import.from.${source}`, node);
            return;
          }
        }
      }
    }

    // JavaScript: check dynamic import() patterns
    if (this.language === 'javascript') {
      const jsDangerousModules = ['child_process', 'fs', 'net', 'http', 'https', 'os', 'vm'];
      if (jsDangerousModules.includes(source)) {
        const existingRule = DANGEROUS_IMPORTS.find(
          r => r.module === source && r.languages.includes('javascript')
        );
        if (existingRule) {
          this.addFinding(existingRule.category, existingRule.severity, existingRule.message, `import.dynamic.${source}`, node);
          return;
        }
      }
    }
  }

  private checkModuleName(moduleName: string, node: ASTNode): void {
    for (const rule of DANGEROUS_IMPORTS) {
      if (!rule.languages.includes(this.language)) continue;
      if (moduleName === rule.module) {
        this.addFinding(rule.category, rule.severity, rule.message, `import.${rule.module}`, node);
        return;
      }
    }
  }

  // ── New Expression Checker ───────────────────────────────────────────────

  /**
   * Check a NewExpression for dangerous constructor usage.
   * Catches `new Socket()`, `new ProcessBuilder()`, `new Function()`, etc.
   */
  private checkNewExpression(node: ASTNode): void {
    const callee = getNodeProp(node, 'callee');
    if (!callee) return;

    const className = getIdentifierName(callee) ?? null;
    const resolved = resolveQualifiedName(callee);

    // Check against dangerous constructors database
    for (const rule of DANGEROUS_CONSTRUCTORS) {
      if (!rule.languages.includes(this.language)) continue;

      if (className === rule.className) {
        this.addFinding(rule.category, rule.severity, rule.message, `new.${rule.className}`, node);
        return;
      }

      // Also check qualified name for things like `java.net.Socket`
      if (resolved && resolved.qualified === rule.qualifiedName) {
        this.addFinding(rule.category, rule.severity, rule.message, `new.${rule.qualifiedName}`, node);
        return;
      }
    }

    // Java native method declarations via new
    if (this.language === 'java') {
      // Check for Reflection usage
      if (resolved && (resolved.qualified.includes('Proxy') || resolved.qualified.includes('reflect'))) {
        this.addFinding(
          SecurityCategory.DynamicCode,
          SecuritySeverity.Critical,
          'Java Reflection dynamically accesses code and is forbidden',
          'new.reflection',
          node
        );
      }
    }
  }

  // ── While Statement Checker ─────────────────────────────────────────────

  /**
   * Check a WhileStatement for infinite loops.
   * Catches `while(true)`, `while(1)`, `while True`.
   */
  private checkWhileStatement(node: ASTNode): void {
    const test = getNodeProp(node, 'test');
    if (isInfiniteLoopCondition(test)) {
      this.addFinding(
        SecurityCategory.InfiniteLoop,
        SecuritySeverity.Low,
        'while loop with constant true condition may run indefinitely',
        'loop.while-true',
        node
      );
    }
  }

  // ── For Statement Checker ───────────────────────────────────────────────

  /**
   * Check a ForStatement for infinite loops.
   * Catches `for(;;)`.
   */
  private checkForStatement(node: ASTNode): void {
    // for(;;) is represented as a ForStatement with no test/init/update
    const test = getNodeProp(node, 'test');
    const init = getNodeProp(node, 'init');
    const update = getNodeProp(node, 'update');

    // C-style for(;;) — no test, no init, no update
    if (!test && !init && !update) {
      this.addFinding(
        SecurityCategory.InfiniteLoop,
        SecuritySeverity.Low,
        'for(;;) loop with no condition may run indefinitely',
        'loop.for-empty',
        node
      );
    }

    // Also check for for(;true;) or for(;1;)
    if (!init && !update && test && isInfiniteLoopCondition(test)) {
      this.addFinding(
        SecurityCategory.InfiniteLoop,
        SecuritySeverity.Low,
        'for loop with constant true condition may run indefinitely',
        'loop.for-true',
        node
      );
    }
  }

  // ── Variable Declaration Checker ─────────────────────────────────────────

  /**
   * Check variable declarations for dangerous assignments.
   * Catches `x = require('child_process')`, etc.
   */
  private checkVariableDecl(node: ASTNode): void {
    const init = getNodeProp(node, 'init');
    if (!init) return;

    // Check if the initializer is a require() call with a dangerous module
    if (init.type === ASTNodeType.CallExpression) {
      const callee = getNodeProp(init, 'callee');
      if (callee && getIdentifierName(callee) === 'require') {
        const args = getNodeArrayProp(init, 'arguments');
        if (args.length > 0 && args[0].type === ASTNodeType.StringLiteral) {
          const moduleName = getStringProp(args[0], 'value') ?? '';
          if (moduleName) {
            this.checkDangerousRequire(moduleName, init);
          }
        }
      }
    }
  }

  // ── Assignment Expression Checker ────────────────────────────────────────

  /**
   * Check assignment expressions for dangerous patterns.
   * Catches `x = require('child_process')`, etc.
   */
  private checkAssignmentExpression(node: ASTNode): void {
    const right = getNodeProp(node, 'right');
    if (!right) return;

    if (right.type === ASTNodeType.CallExpression) {
      const callee = getNodeProp(right, 'callee');
      if (callee && getIdentifierName(callee) === 'require') {
        const args = getNodeArrayProp(right, 'arguments');
        if (args.length > 0 && args[0].type === ASTNodeType.StringLiteral) {
          const moduleName = getStringProp(args[0], 'value') ?? '';
          if (moduleName) {
            this.checkDangerousRequire(moduleName, right);
          }
        }
      }
    }
  }

  // ── Helper: Check Python open() with write mode ─────────────────────────

  /**
   * Check if Python's open() is called with a write mode.
   */
  private checkPythonOpenWriteMode(node: ASTNode): void {
    const args = getNodeArrayProp(node, 'arguments');
    if (args.length < 2) {
      // open(file) defaults to read mode — informational only
      return;
    }

    const modeArg = args[1];
    if (modeArg.type === ASTNodeType.StringLiteral) {
      const mode = getStringProp(modeArg, 'value') ?? '';
      if (/[wWaAx+]/.test(mode)) {
        this.addFinding(
          SecurityCategory.FileAccess,
          SecuritySeverity.Medium,
          `open() with mode '${mode}' writes to the filesystem and is restricted`,
          'call.open-write',
          node
        );
      } else {
        // Read-only mode — informational
        this.addFinding(
          SecurityCategory.FileAccess,
          SecuritySeverity.Info,
          `open() with mode '${mode}' reads from the filesystem`,
          'call.open-read',
          node
        );
      }
    }
  }

  // ── Helper: Check Python range() with large values ──────────────────────

  /**
   * Check if Python's range() is called with a very large number.
   */
  private checkPythonLargeRange(node: ASTNode): void {
    const args = getNodeArrayProp(node, 'arguments');
    for (const arg of args) {
      if (arg.type === ASTNodeType.NumberLiteral) {
        const val = getNumberProp(arg, 'value');
        if (val !== null && Math.abs(val) >= 10_000_000) {
          this.addFinding(
            SecurityCategory.UnsafeOperation,
            SecuritySeverity.Low,
            `range() with large value (${val}) may be very slow`,
            'call.range-large',
            node
          );
          return;
        }
      }
      // Also check for computed expressions that might be large
      if (arg.type === ASTNodeType.BinaryExpression) {
        // Conservative: flag if any operand is >= 10M
        const left = getNodeProp(arg, 'left');
        const right = getNodeProp(arg, 'right');
        for (const operand of [left, right]) {
          if (operand && operand.type === ASTNodeType.NumberLiteral) {
            const val = getNumberProp(operand, 'value');
            if (val !== null && Math.abs(val) >= 10_000_000) {
              this.addFinding(
                SecurityCategory.UnsafeOperation,
                SecuritySeverity.Low,
                `range() with large computed value may be very slow`,
                'call.range-large-computed',
                node
              );
              return;
            }
          }
        }
      }
    }
  }

  // ── Helper: Check C/C++ fopen() with write mode ─────────────────────────

  /**
   * Check if C/C++ fopen() is called with a write mode.
   */
  private checkCFopenWriteMode(node: ASTNode): void {
    const args = getNodeArrayProp(node, 'arguments');
    if (args.length < 2) return;

    const modeArg = args[1];
    if (modeArg.type === ASTNodeType.StringLiteral) {
      const mode = getStringArgValue(modeArg) ?? '';
      if (/[wWaAx+]/.test(mode)) {
        this.addFinding(
          SecurityCategory.FileAccess,
          SecuritySeverity.Medium,
          `fopen() with mode '${mode}' writes to the filesystem and is restricted`,
          'call.fopen-write',
          node
        );
      } else {
        this.addFinding(
          SecurityCategory.FileAccess,
          SecuritySeverity.Info,
          `fopen() with mode '${mode}' reads from the filesystem`,
          'call.fopen-read',
          node
        );
      }
    }
  }

  // ── Helper: Check Java Thread.sleep() ────────────────────────────────────

  /**
   * Check if Java's Thread.sleep() is called with a very long timeout.
   */
  private checkJavaThreadSleep(node: ASTNode): void {
    const args = getNodeArrayProp(node, 'arguments');
    if (args.length > 0 && args[0].type === ASTNodeType.NumberLiteral) {
      const val = getNumberProp(args[0], 'value');
      if (val !== null && val > 60_000) {
        this.addFinding(
          SecurityCategory.UnsafeOperation,
          SecuritySeverity.Low,
          `Thread.sleep(${val}) with very long timeout may block execution`,
          'call.Thread.sleep-long',
          node
        );
      }
    }
  }

  // ── Helper: Resolve fs.* calls for JavaScript ────────────────────────────

  /**
   * Check if a qualified name refers to a fs module method.
   * Returns the method name if it's an fs call, null otherwise.
   */
  private resolveFsCall(qualified: string, objectName: string): string | null {
    const fsMethods = [
      'readFile', 'writeFile', 'appendFile', 'open', 'close', 'read',
      'write', 'rename', 'truncate', 'ftruncate', 'rmdir', 'mkdir',
      'readdir', 'unlink', 'stat', 'lstat', 'fstat', 'exists',
      'access', 'chmod', 'fchmod', 'chown', 'fchown', 'utimes',
      'futimes', 'createReadStream', 'createWriteStream', 'watch',
      'watchFile', 'unwatchFile', 'readFileSync', 'writeFileSync',
      'appendFileSync', 'openSync', 'closeSync', 'readSync',
      'writeSync', 'renameSync', 'truncateSync', 'ftruncateSync',
      'rmdirSync', 'mkdirSync', 'readdirSync', 'unlinkSync',
      'statSync', 'lstatSync', 'fstatSync', 'existsSync',
      'accessSync', 'chmodSync', 'fchmodSync', 'chownSync',
    ];

    // Direct: fs.readFile(...)
    if (objectName === 'fs' && fsMethods.includes(qualified.split('.').pop()!)) {
      return qualified.split('.').pop()!;
    }

    // Alias: const f = require('fs'); f.readFile(...)
    const aliasResolved = this.importAliasMap.get(objectName);
    if (aliasResolved === 'fs') {
      const method = qualified.split('.').pop()!;
      if (fsMethods.includes(method)) {
        return method;
      }
    }

    return null;
  }

  // ── Helper: Resolve ctypes.* calls for Python ───────────────────────────

  /**
   * Check if a qualified name refers to a ctypes method.
   */
  private resolveCtypesCall(qualified: string, objectName: string): string | null {
    if (objectName === 'ctypes') {
      return qualified.split('.').pop()!;
    }
    const aliasResolved = this.importAliasMap.get(objectName);
    if (aliasResolved === 'ctypes') {
      return qualified.split('.').pop()!;
    }
    return null;
  }

  // ── Helper: Check dangerous require() ────────────────────────────────────

  /**
   * Check if require() is called with a dangerous module name.
   */
  private checkDangerousRequire(moduleName: string, node: ASTNode): void {
    for (const rule of DANGEROUS_IMPORTS) {
      if (!rule.languages.includes(this.language)) continue;
      if (moduleName === rule.module) {
        this.addFinding(
          rule.category,
          rule.severity,
          `require('${rule.module}') provides ${rule.category.toLowerCase()} capabilities`,
          `require.${rule.module}`,
          node
        );
        return;
      }
    }
  }

  // ── Finding Management ───────────────────────────────────────────────────

  /**
   * Add a security finding, avoiding duplicate findings for the same
   * rule on the same node.
   */
  private addFinding(
    category: SecurityCategory,
    severity: SecuritySeverity,
    message: string,
    rule: string,
    node: ASTNode
  ): void {
    // Deduplicate: skip if we already have a finding with the same rule
    // at the same source location
    const isDuplicate = this.findings.some(
      f => f.rule === rule &&
           f.node.loc.startLine === node.loc.startLine &&
           f.node.loc.startCol === node.loc.startCol
    );
    if (isDuplicate) return;

    this.findings.push({
      rule,
      message,
      severity,
      node,
      category,
    });
  }

  // ── Report Building ──────────────────────────────────────────────────────

  /**
   * Build the final SecurityReport from collected findings.
   */
  private buildReport(): SecurityReport {
    const blockingFindings = this.findings.filter(
      f => f.severity === SecuritySeverity.Critical || f.severity === SecuritySeverity.High
    );
    const warningFindings = this.findings.filter(
      f => f.severity === SecuritySeverity.Medium ||
           f.severity === SecuritySeverity.Low ||
           f.severity === SecuritySeverity.Info
    );

    // Determine highest severity
    const severityOrder: SecuritySeverity[] = [
      SecuritySeverity.Critical,
      SecuritySeverity.High,
      SecuritySeverity.Medium,
      SecuritySeverity.Low,
      SecuritySeverity.Info,
    ];
    let riskLevel: SecuritySeverity = SecuritySeverity.Info;
    for (const sev of severityOrder) {
      if (this.findings.some(f => f.severity === sev)) {
        riskLevel = sev;
        break;
      }
    }
    if (this.findings.length === 0) {
      riskLevel = SecuritySeverity.Info;
    }

    // Build category stats
    const categories: Record<string, number> = {};
    for (const cat of Object.values(SecurityCategory)) {
      categories[cat] = 0;
    }
    for (const finding of this.findings) {
      categories[finding.category] = (categories[finding.category] ?? 0) + 1;
    }

    const stats: SecurityStats = {
      totalChecks: this.totalChecks,
      blocked: blockingFindings.length,
      warnings: warningFindings.length,
      categories,
    };

    return {
      safe: blockingFindings.length === 0,
      riskLevel,
      findings: this.findings,
      blockingFindings,
      warningFindings,
      stats,
    };
  }
}

// ─── Helper: Extract string value from a node ──────────────────────────────

/**
 * Try to extract a string value from a node, handling both StringLiteral
 * nodes and Identifier nodes that might hold string-like values.
 */
function getStringArgValue(node: ASTNode): string | null {
  if (node.type === ASTNodeType.StringLiteral) {
    return getStringProp(node, 'value');
  }
  if (node.type === ASTNodeType.Identifier) {
    return getIdentifierName(node);
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Analyze an AST for security violations.
 *
 * This is the main entry point for the AST-based security analyzer.
 * It walks the AST tree (not raw source code) to detect dangerous patterns,
 * which is fundamentally more accurate than regex because it understands
 * code structure.
 *
 * @param ast - The root ASTNode to analyze
 * @param language - The programming language of the source code
 * @returns A SecurityReport with all findings and risk assessment
 *
 * @example
 * ```typescript
 * import { analyzeSecurity } from './security';
 * import { SupportedLanguage } from '../types';
 *
 * const report = analyzeSecurity(ast, 'python');
 * if (!report.safe) {
 *   console.error('Code blocked due to security violations:');
 *   for (const finding of report.blockingFindings) {
 *     console.error(`  [${finding.severity}] ${finding.message} at line ${finding.node.loc.startLine}`);
 *   }
 * }
 * ```
 */
export function analyzeSecurity(ast: ASTNode, language: SupportedLanguage): SecurityReport {
  try {
    const normalizedLang = normalizeLanguage(language);
    const analyzer = new SecurityAnalyzer(normalizedLang);
    return analyzer.analyze(ast);
  } catch (error: unknown) {
    // If the analyzer itself throws, return a safe-but-flagged report
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorNode: ASTNode = {
      type: ASTNodeType.Program,
      children: [],
      props: { error: errorMessage },
      loc: { startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      id: 'error',
    };

    return {
      safe: false,
      riskLevel: SecuritySeverity.Critical,
      findings: [{
        rule: 'analyzer.internal-error',
        message: `Security analyzer internal error: ${errorMessage}`,
        severity: SecuritySeverity.Critical,
        node: errorNode,
        category: SecurityCategory.UnsafeOperation,
      }],
      blockingFindings: [{
        rule: 'analyzer.internal-error',
        message: `Security analyzer internal error: ${errorMessage}`,
        severity: SecuritySeverity.Critical,
        node: errorNode,
        category: SecurityCategory.UnsafeOperation,
      }],
      warningFindings: [],
      stats: {
        totalChecks: 0,
        blocked: 1,
        warnings: 0,
        categories: { [SecurityCategory.UnsafeOperation]: 1 },
      },
    };
  }
}
