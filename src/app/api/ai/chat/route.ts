import { NextRequest } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

// ─── Action-specific system prompts ──────────────────────────────────────────

const ACTION_PROMPTS: Record<string, (code: string, language: string, diagnostics?: string) => string> = {
  explain: (code, language) =>
    `You are an expert programming assistant for CodeForge IDE. Explain the following ${language} code clearly and concisely. Describe what it does, how it works, and any notable patterns. Use markdown formatting for better readability.\n\n\`\`\`${language}\n${code}\n\`\`\``,

  fix: (code, language, diagnostics) =>
    `You are an expert debugging assistant for CodeForge IDE. The following ${language} code has these errors:\n${diagnostics || 'No specific errors listed, but please review for common issues.'}\n\nPlease fix the errors and provide the corrected code. Explain what was wrong and how you fixed it. Use markdown formatting.\n\n\`\`\`${language}\n${code}\n\`\`\``,

  optimize: (code, language) =>
    `You are an expert performance optimization assistant for CodeForge IDE. Analyze the following ${language} code for performance and suggest optimizations. Provide the optimized code with explanations of the improvements. Use markdown formatting.\n\n\`\`\`${language}\n${code}\n\`\`\``,

  test: (code, language) =>
    `You are an expert testing assistant for CodeForge IDE. Generate comprehensive test cases for the following ${language} code. Include unit tests, edge cases, and example usage. Use the appropriate testing framework for ${language}. Use markdown formatting.\n\n\`\`\`${language}\n${code}\n\`\`\``,

  refactor: (code, language) =>
    `You are an expert code refactoring assistant for CodeForge IDE. Refactor the following ${language} code to improve readability, maintainability, and follow best practices. Provide the refactored code with explanations of the changes. Use markdown formatting.\n\n\`\`\`${language}\n${code}\n\`\`\``,

  chat: (_code, _language) =>
    '', // No special system prompt for free chat — use default
};

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful coding assistant for CodeForge IDE powered by Google Gemini. Help users with programming questions, code explanations, debugging, and software development best practices. Be concise, clear, and provide code examples when relevant. Use markdown formatting for better readability. When asked about your model, say you are powered by Google Gemini.';

// ─── Lazy-initialized ZAI singleton ──────────────────────────────────────────

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, action, code, language, diagnostics } = body as {
      messages?: Array<{ role: string; content: string }>;
      action?: string;
      code?: string;
      language?: string;
      diagnostics?: string;
    };

    // Build the system message
    let systemContent = DEFAULT_SYSTEM_PROMPT;

    if (action && ACTION_PROMPTS[action] && code) {
      const actionPrompt = ACTION_PROMPTS[action](code, language || 'plaintext', diagnostics);
      if (actionPrompt) {
        systemContent = actionPrompt;
      }
    }

    // Build the messages array for the LLM
    const llmMessages: Array<{ role: string; content: string }> = [
      { role: 'assistant', content: systemContent },
    ];

    // For action-based requests, add a simple user message
    if (action && action !== 'chat' && code) {
      llmMessages.push({
        role: 'user',
        content: `Please ${action} the code.`,
      });
    } else if (messages && messages.length > 0) {
      // For chat mode, add all conversation messages
      for (const msg of messages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          // Skip empty assistant messages (placeholder for streaming)
          if (msg.role === 'assistant' && msg.content === '') continue;
          llmMessages.push(msg);
        }
      }
    } else {
      return new Response(JSON.stringify({ error: 'No messages or action provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Use z-ai-web-dev-sdk (Gemini-powered LLM backend)
    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      messages: llmMessages,
      thinking: { type: 'disabled' },
    });

    const aiResponse = completion.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Stream the response back as a ReadableStream for real-time typing effect
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const chunkSize = 4;
        for (let i = 0; i < aiResponse.length; i += chunkSize) {
          const chunk = aiResponse.slice(i, i + chunkSize);
          controller.enqueue(encoder.encode(chunk));
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[AI Chat API] Error:', error);

    let errorMessage = error.message || 'Internal server error';
    if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
      errorMessage = 'AI service is temporarily busy. Please try again in a moment.';
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
