import { NextRequest, NextResponse } from "next/server";
import type { AiContext } from "@/lib/build-ai-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  history: ChatMessage[];
  mode?: "chat" | "review" | "fix" | "optimize";
  context?: AiContext;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(
  mode: string,
  context: AiContext | undefined
): string {
  const modeInstructions: Record<string, string> = {
    chat: "You are a helpful AI coding assistant. Answer questions, explain code, and discuss architecture.",
    review:
      "You are a senior code reviewer. Identify issues with correctness, performance, security, and maintainability. Be specific and actionable.",
    fix: "You are a debugging specialist. Identify root causes, explain why the bug happens, and provide a fix.",
    optimize:
      "You are a performance engineer. Identify bottlenecks, redundant work, and poor patterns. Suggest concrete improvements.",
  };

  const instruction =
    modeInstructions[mode] ?? modeInstructions.chat;

  // ── File-change protocol ──────────────────────────────────────────────────
  const changeProtocol = `
When you need to propose changes to one or more files, follow this exact format:

1. Write a short explanation (1–3 sentences) of what you are changing and why.
2. Then output one fenced code block per changed file, using this label format:

\`\`\`file:<relative/path/to/file>
<COMPLETE new file content — no omissions, no truncations>
\`\`\`

Rules:
- Include the ENTIRE file content — never use placeholders like "... rest of file unchanged ...".
- One block per file. Multiple files = multiple labeled blocks.
- Only output blocks for files that actually change.
- Do NOT auto-apply anything; the user will review and apply each file individually.
`;

  // ── Project context section ───────────────────────────────────────────────
  let contextSection = "";

  if (context && context.allFilePaths.length > 0) {
    const fileList = context.allFilePaths
      .slice(0, 80) // cap the listing at 80 paths to avoid prompt bloat
      .map((p) => `  ${p}`)
      .join("\n");
    const moreCount = context.allFilePaths.length - 80;

    contextSection += `\n## Project files\n${fileList}`;
    if (moreCount > 0) {
      contextSection += `\n  ... and ${moreCount} more`;
    }
    contextSection += "\n";
  }

  if (context && context.includedFiles.length > 0) {
    contextSection += "\n## Attached file contents\n";

    for (const f of context.includedFiles) {
      const reasonLabel =
        f.reason === "active"
          ? " (active file)"
          : f.reason === "imported"
          ? " (imported by active file)"
          : f.reason === "mentioned"
          ? " (mentioned in message)"
          : "";
      contextSection += `\n### ${f.path}${reasonLabel}\n\`\`\`\n${f.content}\n\`\`\`\n`;
    }

    if (context.wasTruncated) {
      contextSection +=
        "\n> Note: context was truncated at 8 000 chars. Some files may be incomplete.\n";
    }
  }

  if (context?.selection) {
    contextSection += `\n## User's selected text\n\`\`\`\n${context.selection}\n\`\`\`\n`;
  }

  return `${instruction}\n${changeProtocol}${contextSection}`;
}

// ---------------------------------------------------------------------------
// Ollama call
// ---------------------------------------------------------------------------

async function generateAIResponse(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const prompt = [`system: ${systemPrompt}`, ...messages.map((m) => `${m.role}: ${m.content}`)].join(
    "\n\n"
  );

  const response = await fetch(
    process.env.OLLAMA_API_URL || "http://localhost:11434/api/generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:1.5b",
        prompt,
        stream: false,
        options: {
          num_ctx: 8192,   // enough headroom for the full context window
          temperature: 0.7,
          top_p: 0.9,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Ollama responded with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.response) {
    throw new Error("No response from AI model");
  }

  return data.response.trim();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json();
    const { message, history = [], mode = "chat", context } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message is required and must be a string" },
        { status: 400 }
      );
    }

    const validHistory = Array.isArray(history)
      ? history.filter(
          (m) =>
            m &&
            typeof m.role === "string" &&
            typeof m.content === "string" &&
            ["user", "assistant"].includes(m.role)
        )
      : [];

    const messages: ChatMessage[] = [
      ...validHistory.slice(-10),
      { role: "user", content: message },
    ];

    const systemPrompt = buildSystemPrompt(mode, context);

    const aiResponse = await generateAIResponse(messages, systemPrompt);

    return NextResponse.json({
      response: aiResponse,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate AI response",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
