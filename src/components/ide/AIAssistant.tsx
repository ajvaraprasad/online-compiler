'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useIDEStore, AIMessage } from '@/store/useIDEStore';
import {
  Sparkles,
  BookOpen,
  Bug,
  Zap,
  TestTube,
  RefreshCw,
  Send,
  Trash2,
  Loader2,
} from 'lucide-react';

// ─── Quick Actions ──────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { id: 'explain', label: 'Explain', icon: BookOpen, action: 'explain' },
  { id: 'fix', label: 'Fix Errors', icon: Bug, action: 'fix' },
  { id: 'optimize', label: 'Optimize', icon: Zap, action: 'optimize' },
  { id: 'test', label: 'Generate Tests', icon: TestTube, action: 'test' },
  { id: 'refactor', label: 'Refactor', icon: RefreshCw, action: 'refactor' },
] as const;

// ─── Markdown-like renderer for AI responses ─────────────────────────────────

function renderAIContent(content: string) {
  // Simple markdown rendering: code blocks, inline code, bold, italic, line breaks
  const parts: React.ReactNode[] = [];
  let key = 0;

  // Split by code blocks first
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      parts.push(<span key={key++}>{renderInlineMarkdown(text)}</span>);
    }

    // Code block
    const lang = match[1] || 'plaintext';
    const code = match[2].trim();
    parts.push(
      <div key={key++} className="my-2 rounded-md overflow-hidden border border-[#313244]">
        <div className="flex items-center justify-between px-3 py-1 bg-[#313244] text-[#a6adc8] text-xs">
          <span>{lang}</span>
          <button
            onClick={() => navigator.clipboard?.writeText(code)}
            className="ide-copy-btn text-[#6c7086] hover:text-[#cdd6f4] text-xs"
          >
            Copy
          </button>
        </div>
        <pre className="p-3 bg-[#11111b] text-[#cdd6f4] text-xs overflow-x-auto custom-scrollbar">
          <code>{code}</code>
        </pre>
      </div>
    );

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    parts.push(<span key={key++}>{renderInlineMarkdown(text)}</span>);
  }

  return parts;
}

function renderInlineMarkdown(text: string) {
  // Process inline markdown: bold, italic, inline code, line breaks
  const lines = text.split('\n');

  return lines.map((line, i) => {
    // Process inline elements
    let processed: React.ReactNode[] = [];
    let remaining = line;
    let partKey = 0;

    // Inline code
    const inlineCodeRegex = /`([^`]+)`/g;
    let codeMatch;
    let codeLastIndex = 0;

    while ((codeMatch = inlineCodeRegex.exec(remaining)) !== null) {
      if (codeMatch.index > codeLastIndex) {
        processed.push(
          <span key={partKey++}>
            {renderBoldItalic(remaining.slice(codeLastIndex, codeMatch.index))}
          </span>
        );
      }
      processed.push(
        <code
          key={partKey++}
          className="px-1 py-0.5 bg-[#313244] text-[#a6e3a1] rounded text-xs font-mono"
        >
          {codeMatch[1]}
        </code>
      );
      codeLastIndex = codeMatch.index + codeMatch[0].length;
    }

    if (codeLastIndex < remaining.length) {
      processed.push(
        <span key={partKey++}>{renderBoldItalic(remaining.slice(codeLastIndex))}</span>
      );
    }

    if (processed.length === 0) {
      processed.push(<span key={partKey++}>{remaining}</span>);
    }

    // Add line break between lines
    if (i < lines.length - 1) {
      processed.push(<br key={`br-${i}`} />);
    }

    return <React.Fragment key={i}>{processed}</React.Fragment>;
  });
}

function renderBoldItalic(text: string) {
  // Bold: **text**
  const parts: React.ReactNode[] = [];
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let match;
  let lastIndex = 0;
  let key = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }
    parts.push(<strong key={key++} className="font-semibold text-[#cdd6f4]">{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : text;
}

// ─── Message Component ──────────────────────────────────────────────────────

function ChatMessage({ message }: { message: AIMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`px-3 py-2.5 ${isUser ? 'bg-[#1e1e2e]' : 'bg-[#181825]'}`}>
      <div className="flex items-start gap-2">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold ${
            isUser
              ? 'bg-[#89b4fa] text-[#1e1e2e]'
              : 'bg-[#cba6f7] text-[#1e1e2e]'
          }`}
        >
          {isUser ? 'U' : 'AI'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-xs font-medium ${
                isUser ? 'text-[#89b4fa]' : 'text-[#cba6f7]'
              }`}
            >
              {isUser ? 'You' : 'CodeForge AI'}
            </span>
          </div>
          <div className="text-[13px] leading-relaxed text-[#cdd6f4] break-words">
            {isUser ? message.content : renderAIContent(message.content)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Loading Indicator ──────────────────────────────────────────────────────

function LoadingIndicator() {
  return (
    <div className="px-3 py-2.5 bg-[#181825]">
      <div className="flex items-start gap-2">
        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold bg-[#cba6f7] text-[#1e1e2e]">
          AI
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#89b4fa] animate-bounce [animation-delay:0ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#89b4fa] animate-bounce [animation-delay:150ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-[#89b4fa] animate-bounce [animation-delay:300ms]" />
          </div>
          <span className="text-xs text-[#6c7086] ml-1">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main AI Assistant Component ────────────────────────────────────────────

export function AIAssistant() {
  const {
    tabs,
    activeTabId,
    language,
    aiMessages,
    isAILoading,
  } = useIDEStore();

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages, isAILoading]);

  // ─── Send message to AI API ──────────────────────────────────────────────

  const sendMessage = useCallback(
    async (action: string, userMessage: string) => {
      if (isAILoading) return;

      const state = useIDEStore.getState();
      const currentTab = state.tabs.find(t => t.id === state.activeTabId);
      const code = currentTab?.content || '';
      const lang = state.language || currentTab?.language || 'plaintext';
      const diagText =
        state.diagnostics.length > 0
          ? state.diagnostics
              .map(
                d =>
                  `Line ${d.line}:${d.column} [${d.severity}] ${d.message} (${d.source})`
              )
              .join('\n')
          : undefined;

      // Add user message to chat
      state.addAIMessage('user', userMessage);

      // Add empty assistant message that will be streamed into
      state.addAIMessage('assistant', '');

      state.setAILoading(true);

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        // Build messages for chat mode using fresh state after adding messages
        const freshMessages = useIDEStore.getState().aiMessages;
        const chatMessages = freshMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({ role: m.role, content: m.content }));

        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: chatMessages,
            action,
            code,
            language: lang,
            diagnostics: diagText,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
          throw new Error(errorData.error || 'AI request failed');
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        // Read the stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullContent += chunk;
          useIDEStore.getState().updateLastAIMessage(fullContent);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          // User cancelled, don't show error
          return;
        }
        const errorMsg = error.message || 'Failed to get AI response';
        useIDEStore.getState().updateLastAIMessage(`⚠️ Error: ${errorMsg}`);
      } finally {
        useIDEStore.getState().setAILoading(false);
        abortControllerRef.current = null;
      }
    },
    [isAILoading]
  );

  // ─── Handle quick action click ───────────────────────────────────────────

  const handleQuickAction = useCallback(
    (actionId: string, label: string) => {
      const state = useIDEStore.getState();
      const currentTab = state.tabs.find(t => t.id === state.activeTabId);
      if (!currentTab?.content) {
        state.addAIMessage('user', label);
        state.addAIMessage('assistant', 'No code file is currently open. Please open a file first, then try again.');
        return;
      }

      let userMessage = label;
      switch (actionId) {
        case 'explain':
          userMessage = 'Explain this code';
          break;
        case 'fix':
          userMessage = 'Fix errors in this code';
          break;
        case 'optimize':
          userMessage = 'Optimize this code';
          break;
        case 'test':
          userMessage = 'Generate tests for this code';
          break;
        case 'refactor':
          userMessage = 'Refactor this code';
          break;
      }

      sendMessage(actionId, userMessage);
    },
    [sendMessage]
  );

  // ─── Handle chat submit ──────────────────────────────────────────────────

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed || isAILoading) return;

      setInputValue('');
      sendMessage('chat', trimmed);
    },
    [inputValue, isAILoading, sendMessage]
  );

  // ─── Handle clear chat ───────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    useIDEStore.getState().clearAIMessages();
  }, []);

  return (
    <div className="h-full flex flex-col bg-[#181825]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#313244]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-[#cba6f7]" />
          <span className="text-xs font-semibold text-[#a6adc8] uppercase tracking-wider">
            AI Assistant
          </span>
        </div>
        {aiMessages.length > 0 && (
          <button
            onClick={handleClear}
            className="ide-icon-btn text-[#6c7086] hover:text-[#f38ba8] transition-colors"
            title="Clear chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-2 py-2 border-b border-[#313244]">
        <div className="flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                onClick={() => handleQuickAction(qa.action, qa.label)}
                disabled={isAILoading}
                className={`
                  ide-quick-action
                  flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs
                  bg-[#313244] text-[#cdd6f4] border border-[#313244]
                  hover:bg-[#45475a] hover:border-[#585b70]
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
              >
                <Icon className="h-3 w-3" />
                <span>{qa.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {aiMessages.length === 0 && !isAILoading ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <Sparkles className="h-8 w-8 text-[#313244] mb-3" />
            <p className="text-sm text-[#6c7086] mb-2">
              AI Assistant
            </p>
            <p className="text-xs text-[#585b70] max-w-[200px]">
              Ask questions about your code, or use the quick actions above to get started.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#313244]/50">
            {aiMessages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {isAILoading &&
              aiMessages[aiMessages.length - 1]?.content === '' && (
                <LoadingIndicator />
              )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#313244] p-2">
        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about your code..."
            disabled={isAILoading}
            className={`
              flex-1 px-3 py-2 rounded-md text-xs
              bg-[#11111b] border border-[#313244] text-[#cdd6f4]
              placeholder:text-[#6c7086]
              focus:outline-none focus:border-[#89b4fa] focus:ring-1 focus:ring-[#89b4fa]/30
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors duration-150
            `}
          />
          <button
            type="submit"
            disabled={isAILoading || !inputValue.trim()}
            className={`
              ide-btn-hover
              w-8 h-8 flex items-center justify-center rounded-md
              bg-[#89b4fa] text-[#1e1e2e]
              hover:bg-[#74c7ec]
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isAILoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </form>
        {activeTab && (
          <div className="mt-1.5 px-1 text-[10px] text-[#585b70] truncate">
            Context: {activeTab.name} ({language})
          </div>
        )}
      </div>
    </div>
  );
}
