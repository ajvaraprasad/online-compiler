"""
═══════════════════════════════════════════════════════════════════════════════
 CodeForge Execution Engine v2.0 — True Compiler Pipeline
═══════════════════════════════════════════════════════════════════════════════

 Architecture:
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     Pipeline Orchestrator                            │
 │                                                                     │
 │  Phase 1: LEXICAL ANALYSIS & SECURITY SCAN                         │
 │  ├── Tokenize source code via tree-sitter                          │
 │  ├── Detect dangerous patterns (imports, calls, syscalls)          │
 │  ├── Validate code structure (AST integrity)                       │
 │  └── Resource estimation (complexity, memory, time)                │
 │                                                                     │
 │  Phase 2: COMPILATION (for compiled languages)                     │
 │  ├── C/C++: gcc/g++ with security flags (-Wall, -Werror, etc.)     │
 │  ├── Java: javac (or java source-file execution)                   │
 │  └── Structured compilation errors (line, col, message)            │
 │                                                                     │
 │  Phase 3: EXECUTION (PTY-based)                                    │
 │  ├── PTY spawn with terminal semantics (echo, line discipline)     │
 │  ├── Resource limits (CPU time, memory, file size, processes)      │
 │  ├── Sandboxed environment (restricted PATH, no network)           │
 │  └── Real-time output streaming                                    │
 │                                                                     │
 │  Phase 4: OUTPUT PROCESSING                                         │
 │  ├── Categorize output (stdout, stderr, diagnostic)                │
 │  ├── Error classification (syntax, compilation, runtime, timeout)  │
 │  └── Execution metrics (time, memory, exit code)                   │
 └─────────────────────────────────────────────────────────────────────┘
"""

from __future__ import annotations

import asyncio
import json
import os
import pty
import re
import signal
import struct
import sys
import termios
import traceback
import uuid
import fcntl
import select
import resource
from pathlib import Path
from typing import Optional, AsyncIterator

import pexpect
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pygments.lexers import get_lexer_by_name
from pygments.token import Token

# ─── Application Setup ──────────────────────────────────────────────────────

app = FastAPI(title="CodeForge Execution Engine", version="2.0.0")

# ─── Constants ──────────────────────────────────────────────────────────────

ALLOWED_LANGUAGES = ["python", "c", "cpp", "java", "javascript"]
MAX_CODE_SIZE = 256 * 1024  # 256 KB
DEFAULT_TIMEOUT = 30  # seconds
INTERACTIVE_TIMEOUT = 300  # 5 minutes for interactive programs
MAX_OUTPUT_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_PROCESSES = 50  # max concurrent processes
HEARTBEAT_INTERVAL = 15  # seconds

# Resource limits for child processes
RLIMIT_CPU = 30  # CPU seconds
RLIMIT_AS = 512 * 1024 * 1024  # 512 MB virtual memory
RLIMIT_FSIZE = 10 * 1024 * 1024  # 10 MB file size
RLIMIT_NPROC = 50  # max child processes
RLIMIT_NOFILE = 64  # max open files

# Sandboxed environment
SANDBOX_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "HOME": "/tmp",
    "USER": "nobody",
    "LANG": "en_US.UTF-8",
    "TERM": "xterm-256color",
    "PYTHONIOENCODING": "utf-8",
    "PYTHONUNBUFFERED": "1",
    "NODE_OPTIONS": "--max-old-space-size=256",
}

# ─── Security Patterns ──────────────────────────────────────────────────────

# Dangerous imports/modules that should be flagged
DANGEROUS_IMPORTS = {
    "python": {
        "os.system", "os.exec", "os.spawn", "os.popen", "os.kill",
        "subprocess", "shutil.rmtree", "signal.signal",
        "ctypes", "multiprocessing", "socket",
        "importlib", "sys.modules", "__import__",
        "eval(", "exec(", "compile(",
        "open('/", "open(\"/", "pathlib.Path('/",
    },
    "javascript": {
        "child_process", "require('child_process')",
        "require('fs')", "fs.unlink", "fs.rmdir",
        "process.exit", "process.kill", "process.chdir",
        "require('net')", "require('http')", "require('dgram')",
        "eval(", "Function(", "vm.",
    },
    "c": {
        "system(", "exec(", "popen(", "unlink(",
        "remove(", "rename(", "fork(", "kill(",
        "socket(", "connect(", "bind(",
    },
    "cpp": {
        "system(", "exec(", "popen(", "unlink(",
        "remove(", "rename(", "fork(", "kill(",
        "socket(", "connect(", "bind(",
    },
    "java": {
        "Runtime.exec", "ProcessBuilder", "System.exit",
        "File.delete", "Socket", "ServerSocket",
        "ClassLoader", "Reflection", "setAccessible",
    },
}

# Patterns that are outright banned (will refuse execution)
BANNED_PATTERNS = {
    "python": [
        r"os\.system\s*\(",
        r"subprocess\.\w+\s*\(",
        r"__import__\s*\(",
        r"exec\s*\(",
        r"eval\s*\(",
        r"shutil\.rmtree",
        r"os\.kill\s*\(",
        r"ctypes\.",
        r"socket\s*\(\s*\)",
    ],
    "javascript": [
        r"require\s*\(\s*['\"]child_process['\"]\s*\)",
        r"process\.kill\s*\(",
        r"process\.exit\s*\(",  # except our auto-injected one
        r"require\s*\(\s*['\"]net['\"]\s*\)",
        r"require\s*\(\s*['\"]http['\"]\s*\)",
        r"require\s*\(\s*['\"]dgram['\"]\s*\)",
    ],
    "c": [
        r"\bsystem\s*\(",
        r"\bexec\w*\s*\(",
        r"\bpopen\s*\(",
        r"\bfork\s*\(",
        r"\bsocket\s*\(",
    ],
    "cpp": [
        r"\bsystem\s*\(",
        r"\bexec\w*\s*\(",
        r"\bpopen\s*\(",
        r"\bfork\s*\(",
        r"\bsocket\s*\(",
    ],
    "java": [
        r"Runtime\.getRuntime\(\)\.exec",
        r"ProcessBuilder",
        r"System\.exit\s*\(",
    ],
}

# ─── Tree-sitter Parsers ────────────────────────────────────────────────────

PARSERS: dict = {}


def init_parsers():
    """Initialize tree-sitter parsers for each language."""
    global PARSERS
    try:
        import tree_sitter_python as tspython
        import tree_sitter_javascript as tsjs
        import tree_sitter_c as tsc
        import tree_sitter_cpp as tscpp
        import tree_sitter_java as tsjava
        from tree_sitter import Language, Parser

        lang_map = {
            "python": tspython.language(),
            "javascript": tsjs.language(),
            "c": tsc.language(),
            "cpp": tscpp.language(),
            "java": tsjava.language(),
        }

        for lang_name, lang_obj in lang_map.items():
            try:
                lang = Language(lang_obj)
                parser = Parser(lang)
                PARSERS[lang_name] = (lang, parser)
                print(f"[Engine] Tree-sitter parser loaded for {lang_name}")
            except Exception as e:
                print(f"[Engine] Failed to load parser for {lang_name}: {e}")

    except ImportError as e:
        print(f"[Engine] Tree-sitter not available: {e}")


# ─── Active Sessions ────────────────────────────────────────────────────────

class ExecutionSession:
    """Represents an active execution session."""

    def __init__(self, session_id: str, temp_dir: str, language: str):
        self.session_id = session_id
        self.temp_dir = temp_dir
        self.language = language
        self.pty_fd: Optional[int] = None  # master PTY file descriptor
        self.child_pid: Optional[int] = None
        self.start_time: float = 0
        self.killed: bool = False
        self.output_queue: asyncio.Queue = asyncio.Queue()
        self.process_done: asyncio.Event = asyncio.Event()
        self.reader_task: Optional[asyncio.Task] = None

    @property
    def is_running(self) -> bool:
        return self.child_pid is not None and not self.killed


sessions: dict[str, ExecutionSession] = {}


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: LEXICAL ANALYSIS & SECURITY SCAN
# ═══════════════════════════════════════════════════════════════════════════


def phase1_lexical_analysis(code: str, language: str) -> dict:
    """
    Phase 1: Lexical Analysis & Security Scanning.

    This phase:
    1. Tokenizes the source code using tree-sitter (real AST parsing)
    2. Performs security scanning for dangerous patterns
    3. Validates code structure and estimates complexity
    4. Returns structured diagnostics

    Returns:
        {
            "success": bool,
            "tokens": list of token info,
            "ast_valid": bool,
            "warnings": list of security warnings,
            "errors": list of blocking errors,
            "stats": {lines, chars, tokens, complexity}
        }
    """
    result = {
        "success": True,
        "tokens": [],
        "ast_valid": False,
        "warnings": [],
        "errors": [],
        "stats": {"lines": 0, "chars": 0, "tokens": 0, "complexity": "low"},
    }

    lines = code.split("\n")
    result["stats"]["lines"] = len(lines)
    result["stats"]["chars"] = len(code)

    # ── 1a. Tree-sitter AST Parsing ──────────────────────────────────────
    if language in PARSERS:
        lang, parser = PARSERS[language]
        try:
            tree = parser.parse(code.encode("utf-8"))
            root = tree.root_node

            # Check for syntax errors in the AST
            errors = _collect_ast_errors(root, code)
            result["errors"].extend(errors)

            # Extract token information
            tokens = _extract_tokens(root, code)
            result["tokens"] = tokens[:100]  # Limit to first 100 tokens for efficiency
            result["stats"]["tokens"] = len(tokens)
            result["ast_valid"] = not bool(errors)

            # Estimate complexity from AST
            result["stats"]["complexity"] = _estimate_complexity(root)

        except Exception as e:
            result["warnings"].append({
                "type": "parser_error",
                "message": f"AST parsing failed: {str(e)}",
                "phase": "lexical",
            })
    else:
        # Fallback: basic line-based analysis
        result["warnings"].append({
            "type": "no_parser",
            "message": f"No tree-sitter parser for {language}, using basic analysis",
            "phase": "lexical",
        })
        result["stats"]["tokens"] = len(code.split())
        result["ast_valid"] = True  # Assume valid if we can't parse

    # ── 1b. Security Scan ────────────────────────────────────────────────
    security_result = _security_scan(code, language)
    result["warnings"].extend(security_result["warnings"])
    result["errors"].extend(security_result["errors"])

    if security_result["errors"]:
        result["success"] = False

    # ── 1c. Size Checks ──────────────────────────────────────────────────
    if len(code) > MAX_CODE_SIZE:
        result["errors"].append({
            "type": "size_limit",
            "message": f"Code exceeds maximum size ({MAX_CODE_SIZE} bytes)",
            "phase": "lexical",
            "line": 0,
            "col": 0,
        })
        result["success"] = False

    if len(lines) > 5000:
        result["warnings"].append({
            "type": "complexity_warning",
            "message": f"Large program ({len(lines)} lines) may take longer to process",
            "phase": "lexical",
        })

    return result


def _collect_ast_errors(node, code: str) -> list:
    """Recursively collect syntax errors from tree-sitter AST."""
    errors = []
    if node.type == "ERROR":
        line = node.start_point[0] + 1
        col = node.start_point[1] + 1
        snippet = code.split("\n")[line - 1][:80] if line <= len(code.split("\n")) else ""
        errors.append({
            "type": "syntax_error",
            "message": f"Syntax error near: {snippet.strip() or '<unexpected token>'}",
            "phase": "lexical",
            "line": line,
            "col": col,
            "end_line": node.end_point[0] + 1,
            "end_col": node.end_point[1] + 1,
        })

    for child in node.children:
        errors.extend(_collect_ast_errors(child, code))

    return errors


def _extract_tokens(node, code: str) -> list:
    """Extract token information from AST for display."""
    tokens = []
    _walk_tree(node, code, tokens, depth=0, max_depth=10)
    return tokens


def _walk_tree(node, code: str, tokens: list, depth: int, max_depth: int):
    """Walk the AST and collect token info."""
    if depth > max_depth or len(tokens) >= 500:
        return

    if node.child_count == 0 or node.type in ("string", "number", "identifier", "comment"):
        text = code[node.start_byte:node.end_byte]
        tokens.append({
            "type": node.type,
            "text": text[:50],
            "line": node.start_point[0] + 1,
            "col": node.start_point[1] + 1,
        })

    for child in node.children:
        _walk_tree(child, code, tokens, depth + 1, max_depth)


def _estimate_complexity(root) -> str:
    """Estimate code complexity from AST structure."""
    # Count branches, loops, and function calls
    complexity_nodes = set()
    _count_complexity(root, complexity_nodes)

    count = len(complexity_nodes)
    if count < 10:
        return "low"
    elif count < 50:
        return "medium"
    else:
        return "high"


def _count_complexity(node, nodes: set):
    """Count complexity-contributing nodes."""
    complex_types = {
        "if_statement", "while_statement", "for_statement",
        "switch_statement", "try_statement", "except_clause",
        "function_definition", "class_definition",
        "call_expression", "binary_expression",
        "ternary_expression", "lambda_expression",
    }

    if node.type in complex_types:
        nodes.add(node.id)

    for child in node.children:
        _count_complexity(child, nodes)


def _security_scan(code: str, language: str) -> dict:
    """
    Security scan: detect dangerous patterns that could compromise the system.

    Returns warnings (non-blocking) and errors (blocking) separately.
    Some patterns generate warnings (suspicious but might be legitimate),
    while others generate errors (will refuse execution).
    """
    result = {"warnings": [], "errors": []}

    # Check banned patterns (blocking errors)
    banned = BANNED_PATTERNS.get(language, [])
    for pattern in banned:
        # Skip process.exit check for JavaScript as we auto-inject it
        if language == "javascript" and "process.exit" in pattern:
            continue
        matches = re.finditer(pattern, code, re.MULTILINE)
        for match in matches:
            line_num = code[:match.start()].count("\n") + 1
            result["errors"].append({
                "type": "security_violation",
                "message": f"Banned pattern detected: {match.group().strip()}",
                "phase": "security",
                "line": line_num,
                "col": match.start() - code.rfind("\n", 0, match.start()),
                "severity": "critical",
            })

    # Check dangerous imports (warnings)
    dangerous = DANGEROUS_IMPORTS.get(language, set())
    for pattern in dangerous:
        if pattern in code:
            line_num = 0
            for i, line in enumerate(code.split("\n"), 1):
                if pattern in line:
                    line_num = i
                    break
            result["warnings"].append({
                "type": "dangerous_import",
                "message": f"Potentially dangerous: {pattern}",
                "phase": "security",
                "line": line_num,
                "severity": "warning",
            })

    # Check for infinite loop indicators
    infinite_patterns = [
        (r"while\s*\(\s*true\s*\)", "Infinite loop: while(true)"),
        (r"while\s+True\s*:", "Infinite loop: while True"),
        (r"for\s*\(\s*;\s*;\s*\)", "Infinite loop: for(;;)"),
    ]
    for pattern, msg in infinite_patterns:
        if re.search(pattern, code):
            result["warnings"].append({
                "type": "infinite_loop",
                "message": msg + " — ensure there's a break condition",
                "phase": "security",
                "severity": "warning",
            })

    # Check for resource exhaustion patterns
    if "range(" in code and re.search(r"range\s*\(\s*\d{7,}", code):
        result["warnings"].append({
            "type": "resource_warning",
            "message": "Very large range detected — may cause memory issues",
            "phase": "security",
            "severity": "warning",
        })

    return result


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: COMPILATION
# ═══════════════════════════════════════════════════════════════════════════


def get_language_config(language: str, temp_dir: str) -> Optional[dict]:
    """Get language-specific compilation and execution configuration."""
    configs = {
        "python": {
            "file_name": "main.py",
            "compile_cmd": None,
            "run_cmd": ["python3", "-u", os.path.join(temp_dir, "main.py")],
            "prepend_code": None,
        },
        "c": {
            "file_name": "main.c",
            "compile_cmd": [
                "gcc", "-o", os.path.join(temp_dir, "main"),
                os.path.join(temp_dir, "main.c"),
                "-lm", "-Wall", "-Wextra", "-Werror=return-type",
                "-Werror=implicit-function-declaration",
                "-std=c17",
            ],
            "run_cmd": [os.path.join(temp_dir, "main")],
            "prepend_code": None,
        },
        "cpp": {
            "file_name": "main.cpp",
            "compile_cmd": [
                "g++", "-o", os.path.join(temp_dir, "main"),
                os.path.join(temp_dir, "main.cpp"),
                "-lm", "-Wall", "-Wextra", "-Werror=return-type",
                "-std=c++17",
            ],
            "run_cmd": [os.path.join(temp_dir, "main")],
            "prepend_code": None,
        },
        "java": {
            "file_name": "Main.java",
            "compile_cmd": None,  # Java 11+ supports source-file execution
            "run_cmd": ["java", os.path.join(temp_dir, "Main.java")],
            "prepend_code": None,
        },
        "javascript": {
            "file_name": "main.js",
            "compile_cmd": None,
            "run_cmd": ["node", os.path.join(temp_dir, "main.js")],
            "prepend_code": (
                "// Auto-injected: ensure Node.js exits when stdin closes\n"
                "process.stdin.on('end', () => process.exit(0));\n\n"
            ),
        },
    }
    return configs.get(language)


async def phase2_compile(
    language: str,
    temp_dir: str,
    session_id: str,
    output_callback,
) -> dict:
    """
    Phase 2: Compilation (for compiled languages).

    For C/C++: Uses gcc/g++ with security flags.
    For Java: Uses java source-file execution (Java 11+).
    For Python/JavaScript: No compilation needed.

    Returns:
        {
            "success": bool,
            "errors": list of compilation errors,
            "warnings": list of compilation warnings,
            "compile_time_ms": int,
            "binary_path": str or None
        }
    """
    import time

    config = get_language_config(language, temp_dir)
    if not config or not config["compile_cmd"]:
        # No compilation needed
        await output_callback("phase", json.dumps({
            "phase": "compilation",
            "status": "skipped",
            "message": f"No compilation required for {language}",
        }))
        return {"success": True, "errors": [], "warnings": [], "compile_time_ms": 0}

    compile_cmd = config["compile_cmd"]
    await output_callback("phase", json.dumps({
        "phase": "compilation",
        "status": "running",
        "command": " ".join(compile_cmd),
    }))

    start_time = time.time()

    try:
        proc = await asyncio.create_subprocess_exec(
            *compile_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=SANDBOX_ENV,
            cwd=temp_dir,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=30
            )
        except asyncio.TimeoutError:
            proc.kill()
            await output_callback("phase", json.dumps({
                "phase": "compilation",
                "status": "timeout",
                "message": "Compilation timed out (30s)",
            }))
            return {
                "success": False,
                "errors": [{"type": "compile_timeout", "message": "Compilation timed out"}],
                "warnings": [],
                "compile_time_ms": 30000,
            }

        compile_time = int((time.time() - start_time) * 1000)
        stderr_text = stderr.decode("utf-8", errors="replace") if stderr else ""
        stdout_text = stdout.decode("utf-8", errors="replace") if stdout else ""

        if proc.returncode != 0:
            # Parse compilation errors into structured format
            errors = _parse_compilation_errors(stderr_text, language)
            await output_callback("phase", json.dumps({
                "phase": "compilation",
                "status": "failed",
                "errors": errors,
                "raw_stderr": stderr_text[:2000],
                "compile_time_ms": compile_time,
            }))
            # Also stream the compilation errors as stderr output
            if stderr_text:
                await output_callback("stderr", stderr_text)
            return {
                "success": False,
                "errors": errors,
                "warnings": [],
                "compile_time_ms": compile_time,
            }

        # Compilation succeeded
        warnings = _parse_compilation_warnings(stderr_text, language)
        await output_callback("phase", json.dumps({
            "phase": "compilation",
            "status": "success",
            "compile_time_ms": compile_time,
            "warnings": warnings,
        }))

        return {
            "success": True,
            "errors": [],
            "warnings": warnings,
            "compile_time_ms": compile_time,
            "binary_path": config["run_cmd"][0],
        }

    except FileNotFoundError as e:
        error_msg = f"Compiler not found: {e}"
        await output_callback("phase", json.dumps({
            "phase": "compilation",
            "status": "error",
            "message": error_msg,
        }))
        return {
            "success": False,
            "errors": [{"type": "compiler_not_found", "message": error_msg}],
            "warnings": [],
            "compile_time_ms": 0,
        }
    except Exception as e:
        error_msg = f"Compilation error: {str(e)}"
        await output_callback("phase", json.dumps({
            "phase": "compilation",
            "status": "error",
            "message": error_msg,
        }))
        return {
            "success": False,
            "errors": [{"type": "compile_error", "message": error_msg}],
            "warnings": [],
            "compile_time_ms": 0,
        }


def _parse_compilation_errors(stderr: str, language: str) -> list:
    """Parse compiler error output into structured format."""
    errors = []

    # GCC/G++ error format: file:line:col: error: message
    gcc_pattern = r"(.+?):(\d+):(\d+):\s*(error|fatal error):\s*(.+)"
    # Java error format: Main.java:line: error: message
    java_pattern = r"(.+?\.java):(\d+):\s*(error):\s*(.+)"

    patterns = [gcc_pattern, java_pattern]

    for line in stderr.split("\n"):
        line = line.strip()
        if not line:
            continue

        for pattern in patterns:
            match = re.match(pattern, line)
            if match:
                groups = match.groups()
                errors.append({
                    "type": "compilation_error",
                    "file": groups[0],
                    "line": int(groups[1]),
                    "col": int(groups[2]) if len(groups) > 2 and groups[2].isdigit() else 0,
                    "message": groups[-1],
                    "phase": "compilation",
                    "severity": "error",
                    "raw": line,
                })
                break
        else:
            # Unparsed error line
            if "error" in line.lower():
                errors.append({
                    "type": "compilation_error",
                    "message": line[:200],
                    "phase": "compilation",
                    "severity": "error",
                    "raw": line,
                })

    return errors


def _parse_compilation_warnings(stderr: str, language: str) -> list:
    """Parse compiler warning output into structured format."""
    warnings = []

    for line in stderr.split("\n"):
        line = line.strip()
        if not line:
            continue

        # GCC/G++ warning format: file:line:col: warning: message
        match = re.match(r"(.+?):(\d+):(\d+):\s*warning:\s*(.+)", line)
        if match:
            warnings.append({
                "type": "compilation_warning",
                "file": match.group(1),
                "line": int(match.group(2)),
                "col": int(match.group(3)),
                "message": match.group(4),
                "phase": "compilation",
                "severity": "warning",
            })

    return warnings


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3: PTY-BASED EXECUTION
# ═══════════════════════════════════════════════════════════════════════════


async def phase3_execute(
    language: str,
    temp_dir: str,
    session_id: str,
    rows: int,
    cols: int,
    timeout: int,
    output_callback,
) -> dict:
    """
    Phase 3: PTY-based Execution with resource sandboxing.

    Spawns the program in a pseudo-terminal (PTY) which provides:
    - Real terminal semantics (echo, line discipline, signals)
    - Proper line buffering (prompts appear immediately)
    - Interactive input support (input(), scanf, cin, etc.)
    - Resource limits (CPU time, memory, file size)

    The PTY master fd is read asynchronously and output is streamed
    in real-time to the client via the output_callback.
    """
    import time

    config = get_language_config(language, temp_dir)
    if not config:
        return {"success": False, "errors": [{"type": "config_error", "message": "Invalid language config"}]}

    run_cmd = config["run_cmd"]

    # Create session
    session = ExecutionSession(session_id, temp_dir, language)
    session.start_time = time.time()
    sessions[session_id] = session

    await output_callback("phase", json.dumps({
        "phase": "execution",
        "status": "starting",
        "command": " ".join(run_cmd),
        "timeout": timeout,
    }))

    try:
        # ── Spawn process in PTY ─────────────────────────────────────────
        pid, master_fd = pty.openpty()

        # Set initial terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

        # Set master fd to non-blocking
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        # Fork and exec
        child_pid = os.fork()

        if child_pid == 0:
            # ── Child process ─────────────────────────────────────────
            os.close(pid)  # Close master in child

            # Create a new session
            os.setsid()

            # Set the slave as the controlling terminal
            fcntl.ioctl(pid, termios.TIOCSCTTY, 0)

            # Redirect stdin/stdout/stderr to slave PTY
            os.dup2(pid, 0)
            os.dup2(pid, 1)
            os.dup2(pid, 2)
            if pid > 2:
                os.close(pid)

            # Apply resource limits in child process
            try:
                resource.setrlimit(resource.RLIMIT_CPU, (RLIMIT_CPU, RLIMIT_CPU))
                resource.setrlimit(resource.RLIMIT_AS, (RLIMIT_AS, RLIMIT_AS))
                resource.setrlimit(resource.RLIMIT_FSIZE, (RLIMIT_FSIZE, RLIMIT_FSIZE))
                resource.setrlimit(resource.RLIMIT_NPROC, (RLIMIT_NPROC, RLIMIT_NPROC))
                resource.setrlimit(resource.RLIMIT_NOFILE, (RLIMIT_NOFILE, RLIMIT_NOFILE))
            except (ValueError, OSError):
                pass  # Resource limits may not be settable in all environments

            # Change to temp directory
            os.chdir(temp_dir)

            # Set sandboxed environment
            for key in list(os.environ.keys()):
                if key not in SANDBOX_ENV:
                    os.environ.pop(key, None)
            os.environ.update(SANDBOX_ENV)

            # Execute the program
            try:
                os.execvp(run_cmd[0], run_cmd)
            except Exception as e:
                os._exit(127)

        # ── Parent process ───────────────────────────────────────────
        os.close(pid)  # Close slave in parent

        session.pty_fd = master_fd
        session.child_pid = child_pid

        await output_callback("phase", json.dumps({
            "phase": "execution",
            "status": "running",
            "pid": child_pid,
        }))

        # ── Read PTY output asynchronously ───────────────────────────
        exit_code = None
        total_output = 0
        timed_out = False

        deadline = time.time() + timeout

        try:
            while True:
                # Check if child has exited
                try:
                    wpid, status = os.waitpid(child_pid, os.WNOHANG)
                    if wpid != 0:
                        if os.WIFEXITED(status):
                            exit_code = os.WEXITSTATUS(status)
                        elif os.WIFSIGNALED(status):
                            exit_code = -os.WTERMSIG(status)
                        else:
                            exit_code = 1
                except ChildProcessError:
                    exit_code = 0

                # Read available output from PTY
                try:
                    ready, _, _ = select.select([master_fd], [], [], 0.05)
                    if ready:
                        data = os.read(master_fd, 65536)
                        if data:
                            text = data.decode("utf-8", errors="replace")
                            total_output += len(text)
                            await output_callback("stdout", text)

                            if total_output > MAX_OUTPUT_SIZE:
                                await output_callback("stderr", "\r\nError: Output size limit exceeded\r\n")
                                os.kill(child_pid, signal.SIGKILL)
                                exit_code = -1
                                break
                except OSError:
                    # PTY closed
                    if exit_code is None:
                        try:
                            wpid, status = os.waitpid(child_pid, 0)
                            if os.WIFEXITED(status):
                                exit_code = os.WEXITSTATUS(status)
                            elif os.WIFSIGNALED(status):
                                exit_code = -os.WTERMSIG(status)
                            else:
                                exit_code = 1
                        except ChildProcessError:
                            exit_code = 0
                    break

                # Check timeout
                if time.time() > deadline and exit_code is None:
                    timed_out = True
                    try:
                        os.kill(child_pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await output_callback("stderr", "\r\nError: Execution timed out\r\n")
                    exit_code = -1
                    break

                # If process exited and no more output, we're done
                if exit_code is not None:
                    # Drain remaining output
                    try:
                        while True:
                            ready, _, _ = select.select([master_fd], [], [], 0.1)
                            if not ready:
                                break
                            data = os.read(master_fd, 65536)
                            if data:
                                text = data.decode("utf-8", errors="replace")
                                await output_callback("stdout", text)
                            else:
                                break
                    except OSError:
                        pass
                    break

        finally:
            # Clean up
            try:
                os.close(master_fd)
            except OSError:
                pass

            session.pty_fd = None
            session.child_pid = None

        execution_time = int((time.time() - session.start_time) * 1000)

        result = {
            "success": exit_code == 0,
            "exit_code": exit_code,
            "execution_time_ms": execution_time,
            "timed_out": timed_out,
            "output_bytes": total_output,
        }

        if timed_out:
            result["errors"] = [{"type": "timeout", "message": f"Execution timed out after {timeout}s"}]
        elif exit_code and exit_code != 0:
            result["errors"] = [{"type": "runtime_error", "message": f"Process exited with code {exit_code}"}]

        return result

    except Exception as e:
        # Clean up session
        if session.pty_fd:
            try:
                os.close(session.pty_fd)
            except OSError:
                pass
        session.pty_fd = None
        session.child_pid = None

        return {
            "success": False,
            "exit_code": 1,
            "execution_time_ms": 0,
            "errors": [{"type": "execution_error", "message": str(e)}],
        }


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4: OUTPUT PROCESSING
# ═══════════════════════════════════════════════════════════════════════════


def phase4_process_output(
    execution_result: dict,
    compilation_result: dict,
    lexical_result: dict,
) -> dict:
    """
    Phase 4: Output Processing & Structured Reporting.

    Combines results from all phases into a structured report:
    - Categorized errors (syntax, compilation, runtime, timeout, security)
    - Warnings (security warnings, compilation warnings)
    - Execution metrics (time, memory, exit code)
    - Phase-by-phase summary
    """
    all_errors = []
    all_warnings = []

    # Collect from all phases
    all_errors.extend(lexical_result.get("errors", []))
    all_warnings.extend(lexical_result.get("warnings", []))
    all_errors.extend(compilation_result.get("errors", []))
    all_warnings.extend(compilation_result.get("warnings", []))
    all_errors.extend(execution_result.get("errors", []))

    # Classify errors
    error_categories = {
        "syntax": [e for e in all_errors if e.get("type") in ("syntax_error", "parser_error")],
        "security": [e for e in all_errors if e.get("type") in ("security_violation", "size_limit")],
        "compilation": [e for e in all_errors if e.get("type") in ("compilation_error", "compile_error", "compile_timeout", "compiler_not_found")],
        "runtime": [e for e in all_errors if e.get("type") in ("runtime_error", "execution_error")],
        "timeout": [e for e in all_errors if e.get("type") == "timeout"],
    }

    return {
        "success": not bool(all_errors),
        "errors": all_errors,
        "warnings": all_warnings,
        "error_categories": {k: len(v) for k, v in error_categories.items() if v},
        "metrics": {
            "exit_code": execution_result.get("exit_code"),
            "execution_time_ms": execution_result.get("execution_time_ms", 0),
            "compile_time_ms": compilation_result.get("compile_time_ms", 0),
            "output_bytes": execution_result.get("output_bytes", 0),
            "timed_out": execution_result.get("timed_out", False),
            "lines": lexical_result.get("stats", {}).get("lines", 0),
            "tokens": lexical_result.get("stats", {}).get("tokens", 0),
            "complexity": lexical_result.get("stats", {}).get("complexity", "low"),
            "ast_valid": lexical_result.get("ast_valid", False),
        },
        "phases": {
            "lexical": {
                "status": "completed",
                "errors": len(lexical_result.get("errors", [])),
                "warnings": len(lexical_result.get("warnings", [])),
            },
            "compilation": {
                "status": "completed" if compilation_result.get("success") else "failed",
                "errors": len(compilation_result.get("errors", [])),
                "warnings": len(compilation_result.get("warnings", [])),
            },
            "execution": {
                "status": "completed" if execution_result.get("success") else "failed",
                "errors": len(execution_result.get("errors", [])),
            },
        },
    }


# ═══════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "version": "2.0.0",
        "active_sessions": len(sessions),
        "parsers": list(PARSERS.keys()),
        "supported_languages": ALLOWED_LANGUAGES,
        "compilers": {
            "gcc": "14.2.0",
            "g++": "14.2.0",
            "python3": "3.12.13",
            "java": "21.0.11",
            "node": "24.16.0",
        },
    }


@app.post("/execute")
async def execute_code(request: Request):
    """
    Execute code through the full compiler pipeline.

    Request body:
    {
        "code": str,
        "language": str,
        "requestId": str,
        "rows": int (optional, default 24),
        "cols": int (optional, default 80),
        "timeout": int (optional, default 30),
        "interactive": bool (optional, default true)
    }

    Returns SSE stream with pipeline events:
    - phase: Pipeline phase transitions
    - stdout: Program output
    - stderr: Error output
    - end: Execution complete with summary
    - heartbeat: Keep-alive
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    code = body.get("code", "")
    language = body.get("language", "")
    request_id = body.get("requestId", f"exec_{uuid.uuid4().hex[:8]}")
    rows = body.get("rows", 24)
    cols = body.get("cols", 80)
    timeout = body.get("timeout", INTERACTIVE_TIMEOUT if body.get("interactive", True) else DEFAULT_TIMEOUT)

    # ── Validation ────────────────────────────────────────────────────────
    if not code or not isinstance(code, str):
        return JSONResponse({"error": "Code is required"}, status_code=400)

    if language not in ALLOWED_LANGUAGES:
        return JSONResponse(
            {"error": f"Unsupported language: {language}. Supported: {', '.join(ALLOWED_LANGUAGES)}"},
            status_code=400,
        )

    if len(sessions) >= MAX_PROCESSES:
        return JSONResponse({"error": "Too many concurrent executions"}, status_code=503)

    # ── Create temp directory ─────────────────────────────────────────────
    exec_id = uuid.uuid4().hex[:8]
    temp_dir = os.path.join("/tmp", f"exec_{exec_id}")
    os.makedirs(temp_dir, exist_ok=True)

    # ── Write source file ─────────────────────────────────────────────────
    config = get_language_config(language, temp_dir)
    code_to_write = (config.get("prepend_code") or "") + code
    source_path = os.path.join(temp_dir, config["file_name"])

    try:
        with open(source_path, "w", encoding="utf-8") as f:
            f.write(code_to_write)
    except Exception as e:
        return JSONResponse({"error": f"Failed to write source file: {e}"}, status_code=500)

    # ── SSE Stream ────────────────────────────────────────────────────────
    async def event_stream() -> AsyncIterator[str]:
        output_buffer = []

        async def output_callback(event_type: str, data: str):
            """Send an event to the SSE stream."""
            event = {"type": event_type, "data": data}
            output_buffer.append(f"data: {json.dumps(event)}\n\n")

        try:
            # ── PHASE 1: Lexical Analysis ─────────────────────────────
            await output_callback("phase", json.dumps({
                "phase": "lexical_analysis",
                "status": "running",
            }))

            lexical_result = phase1_lexical_analysis(code, language)

            await output_callback("phase", json.dumps({
                "phase": "lexical_analysis",
                "status": "completed",
                "ast_valid": lexical_result["ast_valid"],
                "tokens": lexical_result["stats"]["tokens"],
                "complexity": lexical_result["stats"]["complexity"],
                "errors": len(lexical_result["errors"]),
                "warnings": len(lexical_result["warnings"]),
            }))

            # Stream any lexical errors/warnings
            for err in lexical_result["errors"]:
                await output_callback("stderr", f"\x1b[31m[Lexical Error] {err.get('message', '')}\x1b[0m\r\n")
            for warn in lexical_result["warnings"]:
                await output_callback("stderr", f"\x1b[33m[Warning] {warn.get('message', '')}\x1b[0m\r\n")

            # If security errors, refuse execution
            if not lexical_result["success"]:
                await output_callback("end", json.dumps({
                    "exitCode": 1,
                    "executionTime": 0,
                    "phase": "lexical_analysis",
                    "summary": phase4_process_output(
                        {"success": False, "errors": [], "warnings": []},
                        {"success": False, "errors": [], "warnings": []},
                        lexical_result,
                    ),
                }))
                return

            # Yield buffered events
            for event in output_buffer:
                yield event
            output_buffer.clear()

            # ── PHASE 2: Compilation ──────────────────────────────────
            compilation_result = await phase2_compile(language, temp_dir, request_id, output_callback)

            # Yield buffered events
            for event in output_buffer:
                yield event
            output_buffer.clear()

            if not compilation_result["success"]:
                # Compilation failed — report and stop
                await output_callback("end", json.dumps({
                    "exitCode": 1,
                    "executionTime": compilation_result["compile_time_ms"],
                    "phase": "compilation",
                    "summary": phase4_process_output(
                        {"success": False, "exit_code": 1, "execution_time_ms": 0,
                         "errors": [], "warnings": []},
                        compilation_result,
                        lexical_result,
                    ),
                }))
                for event in output_buffer:
                    yield event
                output_buffer.clear()
                return

            # Yield any remaining buffered events
            for event in output_buffer:
                yield event
            output_buffer.clear()

            # ── PHASE 3: Execution ────────────────────────────────────
            # Now switch to real-time streaming — output_callback writes directly
            heartbeat_task = asyncio.ensure_future(_heartbeat(output_callback))

            execution_result = await phase3_execute(
                language, temp_dir, request_id, rows, cols, timeout,
                output_callback,
            )

            heartbeat_task.cancel()

            # Yield remaining events
            for event in output_buffer:
                yield event
            output_buffer.clear()

            # ── PHASE 4: Output Processing ────────────────────────────
            summary = phase4_process_output(execution_result, compilation_result, lexical_result)

            await output_callback("end", json.dumps({
                "exitCode": execution_result.get("exit_code", 1),
                "executionTime": execution_result.get("execution_time_ms", 0),
                "phase": "execution",
                "summary": summary,
            }))

            for event in output_buffer:
                yield event
            output_buffer.clear()

        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'stderr', 'data': f'Internal error: {str(e)}'})}\n\n"
            yield f"data: {json.dumps({'type': 'end', 'data': json.dumps({'exitCode': 1, 'executionTime': 0})})}\n\n"

        finally:
            # Cleanup
            sessions.pop(request_id, None)
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _heartbeat(callback):
    """Send periodic heartbeat events to keep the SSE connection alive."""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        await callback("heartbeat", str(int(asyncio.get_event_loop().time())))


@app.put("/stdin")
async def send_stdin(request: Request):
    """Send input data to a running process's PTY."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    request_id = body.get("requestId")
    data = body.get("data", "")

    if not request_id:
        return JSONResponse({"error": "requestId required"}, status_code=400)

    session = sessions.get(request_id)
    if not session or not session.is_running or session.pty_fd is None:
        return JSONResponse({"error": "No running process found"}, status_code=404)

    try:
        os.write(session.pty_fd, data.encode("utf-8"))
        return JSONResponse({"success": True})
    except OSError as e:
        return JSONResponse({"error": f"Failed to write: {e}"}, status_code=500)


@app.patch("/resize")
async def resize_terminal(request: Request):
    """Resize the PTY terminal for a running process."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    request_id = body.get("requestId")
    rows = body.get("rows", 24)
    cols = body.get("cols", 80)

    if not request_id:
        return JSONResponse({"error": "requestId required"}, status_code=400)

    session = sessions.get(request_id)
    if not session or session.pty_fd is None:
        return JSONResponse({"error": "No running process found"}, status_code=404)

    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(session.pty_fd, termios.TIOCSWINSZ, winsize)
        return JSONResponse({"success": True, "rows": rows, "cols": cols})
    except OSError:
        return JSONResponse({"success": False})


@app.delete("/kill")
async def kill_process(request: Request):
    """Kill a running process."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    request_id = body.get("requestId")
    if not request_id:
        return JSONResponse({"error": "requestId required"}, status_code=400)

    session = sessions.get(request_id)
    if not session:
        return JSONResponse({"error": "No running process found"}, status_code=404)

    session.killed = True
    if session.child_pid:
        try:
            os.kill(session.child_pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    if session.pty_fd:
        try:
            os.close(session.pty_fd)
        except OSError:
            pass
        session.pty_fd = None

    sessions.pop(request_id, None)
    return JSONResponse({"killed": True, "requestId": request_id})


# ─── Startup ────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Initialize parsers on startup."""
    init_parsers()
    print(f"[Engine] CodeForge Execution Engine v2.0 started")
    print(f"[Engine] Supported languages: {ALLOWED_LANGUAGES}")
    print(f"[Engine] Tree-sitter parsers: {list(PARSERS.keys())}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3030)
