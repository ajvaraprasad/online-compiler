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
      <div key={key++} className="my-2 rounded-md overflow-hidden border" style={{ borderColor: 'var(--ide-border)' }}>
        <div className="flex items-center justify-between px-3 py-1 text-xs" style={{ backgroundColor: 'var(--ide-bg-hover)', color: 'var(--ide-text-secondary)' }}>
          <span>{lang}</span>
          <button
            onClick={() => navigator.clipboard?.writeText(code)}
            className="ide-copy-btn text-xs"
            style={{ color: 'var(--ide-text-dim)' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--ide-text-primary)'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--ide-text-dim)'; }}
          >
            Copy
          </button>
        </div>
        <pre className="p-3 text-xs overflow-x-auto custom-scrollbar" style={{ backgroundColor: 'var(--ide-bg-input)', color: 'var(--ide-text-primary)' }}>
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
          className="px-1 py-0.5 rounded text-xs font-mono"
          style={{ backgroundColor: 'var(--ide-bg-hover)', color: 'var(--ide-success)' }}
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
    parts.push(<strong key={key++} className="font-semibold" style={{ color: 'var(--ide-text-primary)' }}>{match[1]}</strong>);
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
    <div className="px-3 py-2.5" style={{ backgroundColor: isUser ? 'var(--ide-bg-base)' : 'var(--ide-bg-surface)' }}>
      <div className="flex items-start gap-2">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold"
          style={{
            backgroundColor: isUser ? 'var(--ide-accent)' : 'var(--ide-purple)',
            color: 'var(--ide-bg-base)',
          }}
        >
          {isUser ? 'U' : 'G'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className="text-xs font-medium"
              style={{ color: isUser ? 'var(--ide-accent)' : 'var(--ide-purple)' }}
            >
              {isUser ? 'You' : 'Gemini AI'}
            </span>
          </div>
          <div className="text-[13px] leading-relaxed break-words" style={{ color: 'var(--ide-text-primary)' }}>
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
    <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--ide-bg-surface)' }}>
      <div className="flex items-start gap-2">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold"
          style={{ backgroundColor: 'var(--ide-purple)', color: 'var(--ide-bg-base)' }}
        >
          G
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:0ms]" style={{ backgroundColor: 'var(--ide-accent)' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:150ms]" style={{ backgroundColor: 'var(--ide-accent)' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:300ms]" style={{ backgroundColor: 'var(--ide-accent)' }} />
          </div>
          <span className="text-xs ml-1" style={{ color: 'var(--ide-text-dim)' }}>Gemini is thinking...</span>
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
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--ide-bg-surface)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--ide-border)' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--ide-purple)' }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ide-text-secondary)' }}>
            AI Assistant
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(139, 92, 246, 0.15)', color: 'var(--ide-purple)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
            Gemini
          </span>
        </div>
        {aiMessages.length > 0 && (
          <button
            onClick={handleClear}
            className="ide-icon-btn transition-colors"
            style={{ color: 'var(--ide-text-dim)' }}
            title="Clear chat"
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ide-error)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ide-text-dim)'; }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-2 py-2 border-b" style={{ borderColor: 'var(--ide-border)' }}>
        <div className="flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                onClick={() => handleQuickAction(qa.action, qa.label)}
                disabled={isAILoading}
                className="ide-quick-action flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--ide-bg-hover)',
                  color: 'var(--ide-text-primary)',
                  borderColor: 'var(--ide-border)',
                }}
                onMouseEnter={(e) => {
                  if (!isAILoading) {
                    e.currentTarget.style.backgroundColor = 'var(--ide-bg-active)';
                    e.currentTarget.style.borderColor = 'var(--ide-border-light)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--ide-bg-hover)';
                  e.currentTarget.style.borderColor = 'var(--ide-border)';
                }}
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
            <Sparkles className="h-8 w-8 mb-3" style={{ color: 'var(--ide-border)' }} />
            <p className="text-sm mb-2" style={{ color: 'var(--ide-text-dim)' }}>
              AI Assistant
            </p>
            <p className="text-xs max-w-[200px]" style={{ color: 'var(--ide-text-faint)' }}>
              Powered by Google Gemini. Ask questions about your code, or use the quick actions above to get started.
            </p>
          </div>
        ) : (
          <div style={{ borderTopColor: 'var(--ide-border)', opacity: 0.5 }} className="divide-y">
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
      <div className="border-t p-2" style={{ borderColor: 'var(--ide-border)' }}>
        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about your code..."
            disabled={isAILoading}
            className="flex-1 px-3 py-2 rounded-md text-xs border focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            style={{
              backgroundColor: 'var(--ide-bg-input)',
              borderColor: 'var(--ide-border)',
              color: 'var(--ide-text-primary)',
            }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--ide-accent)'; e.target.style.boxShadow = '0 0 0 1px var(--ide-focus-ring)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--ide-border)'; e.target.style.boxShadow = 'none'; }}
          />
          <button
            type="submit"
            disabled={isAILoading || !inputValue.trim()}
            className="ide-btn-hover w-8 h-8 flex items-center justify-center rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--ide-accent)', color: 'var(--ide-bg-base)' }}
          >
            {isAILoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </form>
        {activeTab && (
          <div className="mt-1.5 px-1 text-[10px] truncate" style={{ color: 'var(--ide-text-faint)' }}>
            Context: {activeTab.name} ({language})
          </div>
        )}
      </div>
    </div>
  );
}
