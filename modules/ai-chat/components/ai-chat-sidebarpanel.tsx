"use client";

import type React from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Send,
  User,
  Copy,
  X,
  Code,
  Sparkles,
  MessageSquare,
  RefreshCw,
  Settings,
  Zap,
  Brain,
  Search,
  Filter,
  Download,
  FileCode,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import "katex/dist/katex.min.css";
import Image from "next/image";
import { buildAiContext, type AiContext } from "@/lib/build-ai-context";
import type {
  TemplateFile,
  TemplateFolder,
} from "@/modules/playground/lib/path-to-json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
  timestamp: Date;
  type?: "chat" | "code_review" | "suggestion" | "error_fix" | "optimization";
  tokens?: number;
  model?: string;
  /** Context snapshot that was sent with this message (user messages only). */
  attachedContext?: AiContext;
  /** File-change proposals parsed from an assistant reply. */
  fileProposals?: FileProposal[];
}

/** A single ```file:<path> block extracted from an assistant message. */
interface FileProposal {
  path: string;
  newContent: string;
  /** Whether the user has already applied this proposal. */
  applied: boolean;
  /** Expanded/collapsed state of the diff view. */
  diffOpen: boolean;
}

export interface AIChatSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  // --- project context ---
  fileTree?: TemplateFolder | null;
  activeFilePath?: string | null;
  activeFileContent?: string | null;
  /** Called when user clicks "Apply" on a file proposal. */
  onApplyChanges?: (filePath: string, newContent: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse all ```file:<path> fenced blocks out of an assistant reply.
 * Returns the proposals AND the "clean" text with those blocks stripped
 * (so we don't render duplicate content in the markdown).
 */
function parseFileProposals(raw: string): {
  proposals: FileProposal[];
  cleanContent: string;
} {
  const proposals: FileProposal[] = [];
  // Match ```file:<path>\n<content>```
  const re = /```file:([^\n`]+)\n([\s\S]*?)```/g;
  const cleanContent = raw.replace(re, (_, path: string, content: string) => {
    proposals.push({
      path: path.trim(),
      newContent: content,
      applied: false,
      diffOpen: true,
    });
    // Replace with a thin placeholder so the text reads naturally
    return `\n> 📄 **\`${path.trim()}\`** — see file proposal below\n`;
  });
  return { proposals, cleanContent };
}

// ---------------------------------------------------------------------------
// Sub-component: attached-files pill row
// ---------------------------------------------------------------------------

const AttachedFilesBar: React.FC<{ context: AiContext }> = ({ context }) => {
  if (context.includedFiles.length === 0 && !context.selection) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-0">
      {context.includedFiles.map((f) => (
        <span
          key={f.path}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono border",
            f.reason === "active"
              ? "bg-blue-950/60 border-blue-700/50 text-blue-300"
              : f.reason === "imported"
              ? "bg-violet-950/60 border-violet-700/50 text-violet-300"
              : "bg-zinc-800/80 border-zinc-700/50 text-zinc-400"
          )}
          title={
            f.reason === "active"
              ? "Active file"
              : f.reason === "imported"
              ? "Imported by active file"
              : "Mentioned in message"
          }
        >
          <Paperclip className="h-2.5 w-2.5" />
          {f.path.split("/").pop()}
        </span>
      ))}
      {context.selection && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-amber-950/60 border-amber-700/50 text-amber-300">
          <Code className="h-2.5 w-2.5" />
          selection
        </span>
      )}
      {context.wasTruncated && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-red-950/40 border-red-700/40 text-red-400">
          truncated
        </span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: diff viewer + Apply button
// ---------------------------------------------------------------------------

const FileProposalCard: React.FC<{
  proposal: FileProposal;
  /** Current content of this file in the editor (may be undefined if file is new). */
  currentContent: string | undefined;
  onApply: () => void;
  onToggleDiff: () => void;
}> = ({ proposal, currentContent, onApply, onToggleDiff }) => {
  const isNew = currentContent === undefined;
  const linesNew = proposal.newContent.split("\n");
  const linesOld = (currentContent ?? "").split("\n");

  return (
    <div className="mt-3 rounded-lg border border-zinc-700/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/70">
        <div className="flex items-center gap-2 min-w-0">
          <FileCode className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          <span className="font-mono text-xs text-zinc-200 truncate">
            {proposal.path}
          </span>
          {isNew && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-700 text-green-400">
              new file
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {proposal.applied ? (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 border-green-700 text-green-400 gap-1"
            >
              <CheckCircle className="h-2.5 w-2.5" /> Applied
            </Badge>
          ) : (
            <Button
              size="sm"
              onClick={onApply}
              className="h-6 px-2 text-xs bg-blue-600 hover:bg-blue-700 text-white border-0"
            >
              Apply
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleDiff}
            className="h-6 w-6 p-0 text-zinc-400 hover:text-zinc-200"
          >
            {proposal.diffOpen ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Diff body */}
      {proposal.diffOpen && (
        <div className="overflow-x-auto max-h-72 text-xs font-mono bg-zinc-900/60">
          {isNew ? (
            // New file — just show additions
            <div>
              {linesNew.map((line, i) => (
                <div
                  key={i}
                  className="flex gap-2 px-3 py-px bg-green-950/30 text-green-300"
                >
                  <span className="select-none text-green-700 w-4 shrink-0">+</span>
                  <span className="whitespace-pre">{line}</span>
                </div>
              ))}
            </div>
          ) : (
            // Existing file — side-by-side line diff
            <SimpleDiff oldLines={linesOld} newLines={linesNew} />
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Minimal line-level diff renderer.
 * We don't pull in a full diff library to keep bundle size down.
 * We use a simple LCS-based approach for small files; for large files
 * we show old/new side by side with a divider.
 */
const SimpleDiff: React.FC<{ oldLines: string[]; newLines: string[] }> = ({
  oldLines,
  newLines,
}) => {
  // For readability, show removed lines in red and added in green.
  // We use a unified-style view (not side-by-side) to fit in the panel.
  const maxLines = 200;
  const oldTrimmed = oldLines.slice(0, maxLines);
  const newTrimmed = newLines.slice(0, maxLines);

  // Build a simple set-based diff: lines only in old = removed, only in new = added
  const oldSet = new Set(oldTrimmed.map((l, i) => `${i}:${l}`));
  const newSet = new Set(newTrimmed.map((l, i) => `${i}:${l}`));

  // Compute unified diff chunks with Myers-lite: just show all old as context/removed
  // and all new as added. This isn't a true diff but is correct and readable.
  type DiffLine = { type: "context" | "removed" | "added"; text: string };
  const diffLines: DiffLine[] = [];

  const len = Math.max(oldTrimmed.length, newTrimmed.length);
  for (let i = 0; i < len; i++) {
    const o = oldTrimmed[i];
    const n = newTrimmed[i];
    if (o === n) {
      diffLines.push({ type: "context", text: o ?? "" });
    } else {
      if (o !== undefined) diffLines.push({ type: "removed", text: o });
      if (n !== undefined) diffLines.push({ type: "added", text: n });
    }
  }

  return (
    <div>
      {diffLines.map((line, i) => (
        <div
          key={i}
          className={cn("flex gap-2 px-3 py-px", {
            "bg-red-950/30 text-red-300": line.type === "removed",
            "bg-green-950/30 text-green-300": line.type === "added",
            "text-zinc-400": line.type === "context",
          })}
        >
          <span
            className={cn("select-none w-4 shrink-0", {
              "text-red-600": line.type === "removed",
              "text-green-600": line.type === "added",
              "text-zinc-600": line.type === "context",
            })}
          >
            {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
          </span>
          <span className="whitespace-pre">{line.text}</span>
        </div>
      ))}
      {(oldLines.length > maxLines || newLines.length > maxLines) && (
        <div className="px-3 py-1 text-zinc-500 italic">
          … diff truncated at {maxLines} lines
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: message type badge
// ---------------------------------------------------------------------------

const MessageTypeIndicator: React.FC<{
  type?: string;
  model?: string;
  tokens?: number;
}> = ({ type, model, tokens }) => {
  const getTypeConfig = (t?: string) => {
    switch (t) {
      case "code_review":
        return { icon: Code, color: "text-blue-400", label: "Code Review" };
      case "suggestion":
        return { icon: Sparkles, color: "text-purple-400", label: "Suggestion" };
      case "error_fix":
        return { icon: RefreshCw, color: "text-red-400", label: "Error Fix" };
      case "optimization":
        return { icon: Zap, color: "text-yellow-400", label: "Optimization" };
      default:
        return { icon: MessageSquare, color: "text-zinc-400", label: "Chat" };
    }
  };
  const { icon: Icon, color, label } = getTypeConfig(type);
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1">
        <Icon className={cn("h-3 w-3", color)} />
        <span className={cn("text-xs font-medium", color)}>{label}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {model && <span>{model}</span>}
        {tokens && <span>{tokens} tokens</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const AIChatSidePanel: React.FC<AIChatSidePanelProps> = ({
  isOpen,
  onClose,
  fileTree,
  activeFilePath,
  activeFileContent,
  onApplyChanges,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatMode, setChatMode] = useState<"chat" | "review" | "fix" | "optimize">("chat");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [autoSave, setAutoSave] = useState(true);
  const [streamResponse, setStreamResponse] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Keep a ref to open-file contents so the Apply handler can look up "current" content
  // for the diff view. Key = virtual path (same as FileProposal.path).
  const fileContentsRef = useRef<Map<string, string>>(new Map());

  // Update file-contents ref whenever active file changes
  useEffect(() => {
    if (activeFilePath && activeFileContent != null) {
      fileContentsRef.current.set(activeFilePath, activeFileContent);
    }
  }, [activeFilePath, activeFileContent]);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(id);
  }, [messages, isLoading, scrollToBottom]);

  // ── Mode-prefix helper ────────────────────────────────────────────────────

  const getChatModePrompt = (mode: string, content: string): string => {
    switch (mode) {
      case "review":
        return `Please review the attached code and provide detailed suggestions for improvement (performance, security, best practices):\n\n${content}`;
      case "fix":
        return `Please help fix the issue described below. Use the attached file context to understand the codebase:\n\n${content}`;
      case "optimize":
        return `Please analyze the attached code for performance optimizations:\n\n${content}`;
      default:
        return content;
    }
  };

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const rawInput = input.trim();

    const messageType =
      chatMode === "chat"
        ? "chat"
        : chatMode === "review"
        ? "code_review"
        : chatMode === "fix"
        ? "error_fix"
        : "optimization";

    // Build project context before clearing the input
    const context = buildAiContext({
      files: fileTree ?? null,
      activeFilePath: activeFilePath ?? null,
      activeFileContent: activeFileContent ?? null,
      message: rawInput,
    });

    const newMessage: ChatMessage = {
      role: "user",
      content: rawInput,
      timestamp: new Date(),
      id: Date.now().toString(),
      type: messageType,
      attachedContext: context,
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const contextualMessage = getChatModePrompt(chatMode, rawInput);

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: contextualMessage,
          history: messages.slice(-10).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          mode: chatMode,
          context,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const raw: string = data.response ?? "";

        // Parse ```file:<path> blocks out of the reply
        const { proposals, cleanContent } = parseFileProposals(raw);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: cleanContent,
            timestamp: new Date(),
            id: (Date.now() + 1).toString(),
            type: messageType,
            tokens: data.tokens,
            model: data.model || "qwen2.5-coder:1.5b",
            fileProposals: proposals.length > 0 ? proposals : undefined,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, I encountered an error. Please try again.",
            timestamp: new Date(),
            id: (Date.now() + 1).toString(),
          },
        ]);
      }
    } catch (err) {
      console.error("Error sending message:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "I'm having trouble connecting. Check your Ollama server and try again.",
          timestamp: new Date(),
          id: (Date.now() + 1).toString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Apply a file proposal ─────────────────────────────────────────────────

  const handleApply = useCallback(
    async (messageId: string, proposalPath: string) => {
      // Find the proposal
      const msg = messages.find((m) => m.id === messageId);
      const proposal = msg?.fileProposals?.find((p) => p.path === proposalPath);
      if (!proposal || proposal.applied) return;

      if (onApplyChanges) {
        await onApplyChanges(proposal.path, proposal.newContent);
      }

      // Mark as applied in local state
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                fileProposals: m.fileProposals?.map((p) =>
                  p.path === proposalPath ? { ...p, applied: true } : p
                ),
              }
            : m
        )
      );

      // Update the local file-contents ref so future diffs use the new content
      fileContentsRef.current.set(proposalPath, proposal.newContent);
    },
    [messages, onApplyChanges]
  );

  // ── Toggle diff expanded/collapsed ───────────────────────────────────────

  const handleToggleDiff = useCallback((messageId: string, proposalPath: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              fileProposals: m.fileProposals?.map((p) =>
                p.path === proposalPath ? { ...p, diffOpen: !p.diffOpen } : p
              ),
            }
          : m
      )
    );
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────

  const exportChat = () => {
    const blob = new Blob([JSON.stringify({ messages, timestamp: new Date().toISOString() }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-chat-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Filtered messages ─────────────────────────────────────────────────────

  const filteredMessages = messages
    .filter((m) => filterType === "all" || m.type === filterType)
    .filter((m) => !searchTerm || m.content.toLowerCase().includes(searchTerm.toLowerCase()));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <>
        {/* Backdrop */}
        <div
          className={cn(
            "fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300",
            isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
          onClick={onClose}
        />

        {/* Side Panel */}
        <div
          className={cn(
            "fixed right-0 top-0 h-full w-full max-w-3xl bg-zinc-950 border-l border-zinc-800 z-50 flex flex-col transition-transform duration-300 ease-out shadow-2xl",
            isOpen ? "translate-x-0" : "translate-x-full"
          )}
        >
          {/* ── Header ── */}
          <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
            <div className="flex items-center justify-between p-6">
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10 border rounded-full flex flex-col justify-center items-center">
                  <Image src="/logo.svg" alt="Logo" width={28} height={28} unoptimized />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">AI Assistant</h2>
                  <p className="text-sm text-zinc-400">
                    {messages.length} messages
                    {activeFilePath && (
                      <span className="ml-2 text-blue-400">
                        · {activeFilePath.split("/").pop()}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuCheckboxItem checked={autoSave} onCheckedChange={setAutoSave}>
                      Auto-save conversations
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={streamResponse} onCheckedChange={setStreamResponse}>
                      Stream responses
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={exportChat}>
                      <Download className="h-4 w-4 mr-2" />
                      Export Chat
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setMessages([])}>
                      Clear All Messages
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Mode tabs + search/filter */}
            <Tabs
              value={chatMode}
              onValueChange={(v) => setChatMode(v as typeof chatMode)}
              className="px-6"
            >
              <div className="flex items-center justify-between mb-4">
                <TabsList className="grid w-full grid-cols-4 max-w-md">
                  <TabsTrigger value="chat" className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" />
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="review" className="flex items-center gap-1">
                    <Code className="h-3 w-3" />
                    Review
                  </TabsTrigger>
                  <TabsTrigger value="fix" className="flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" />
                    Fix
                  </TabsTrigger>
                  <TabsTrigger value="optimize" className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    Optimize
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2 ml-3">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                    <Input
                      placeholder="Search…"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-7 h-8 w-32 bg-zinc-800/50 border-zinc-700/50"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Filter className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {["all", "chat", "code_review", "error_fix", "optimization"].map((t) => (
                        <DropdownMenuItem key={t} onClick={() => setFilterType(t)}>
                          {t === "all" ? "All Messages" : t.replace("_", " ")}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Tabs>
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto bg-zinc-950">
            <div className="p-6 space-y-6">
              {filteredMessages.length === 0 && !isLoading && (
                <div className="text-center text-zinc-500 py-16">
                  <div className="relative w-16 h-16 border rounded-full flex flex-col justify-center items-center mx-auto mb-4">
                    <Brain className="h-8 w-8 text-zinc-400" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3 text-zinc-300">AI Assistant</h3>
                  <p className="text-zinc-400 max-w-md mx-auto leading-relaxed mb-6">
                    {activeFilePath
                      ? `Project-aware mode active. I can see your file tree and the contents of ${activeFilePath.split("/").pop()}.`
                      : "Open a file in the editor to give me project context."}
                  </p>
                  <div className="grid grid-cols-2 gap-2 max-w-lg mx-auto">
                    {[
                      "Review my active file for issues",
                      "Fix any TypeScript errors in this file",
                      "Optimize this component's performance",
                      "Add error handling to this file",
                      "Explain what this code does",
                      "Refactor for better readability",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => setInput(s)}
                        className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors text-left"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredMessages.map((msg) => (
                <div key={msg.id} className="space-y-2">
                  <div
                    className={cn(
                      "flex items-start gap-4 group",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="relative w-10 h-10 border rounded-full flex flex-col justify-center items-center shrink-0">
                        <Brain className="h-5 w-5 text-zinc-400" />
                      </div>
                    )}

                    <div
                      className={cn(
                        "max-w-[85%] rounded-xl shadow-sm",
                        msg.role === "user"
                          ? "bg-zinc-900/70 text-white p-4 rounded-br-md"
                          : "bg-zinc-900/80 backdrop-blur-sm text-zinc-100 p-5 rounded-bl-md border border-zinc-800/50"
                      )}
                    >
                      {msg.role === "assistant" && (
                        <MessageTypeIndicator
                          type={msg.type}
                          model={msg.model}
                          tokens={msg.tokens}
                        />
                      )}

                      {/* Markdown content */}
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                          components={{
                            code({ children, className, ...props }: any) {
                              const isInline = !className;
                              if (isInline) {
                                return (
                                  <code className="bg-zinc-800 px-1 py-0.5 rounded text-sm">
                                    {children}
                                  </code>
                                );
                              }
                              return (
                                <div className="bg-zinc-800 rounded-lg p-4 my-4">
                                  <pre className="text-sm text-zinc-100 overflow-x-auto">
                                    <code className={className}>{children}</code>
                                  </pre>
                                </div>
                              );
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>

                      {/* File proposals (assistant only) */}
                      {msg.role === "assistant" && msg.fileProposals && msg.fileProposals.length > 0 && (
                        <div className="mt-4 space-y-1">
                          {msg.fileProposals.map((proposal) => (
                            <FileProposalCard
                              key={proposal.path}
                              proposal={proposal}
                              currentContent={fileContentsRef.current.get(proposal.path)}
                              onApply={() => handleApply(msg.id, proposal.path)}
                              onToggleDiff={() => handleToggleDiff(msg.id, proposal.path)}
                            />
                          ))}
                        </div>
                      )}

                      {/* Attached files (user only) */}
                      {msg.role === "user" && msg.attachedContext && (
                        <div className="mt-2">
                          <AttachedFilesBar context={msg.attachedContext} />
                        </div>
                      )}

                      {/* Message actions */}
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-700/30">
                        <div className="text-xs text-zinc-500">
                          {msg.timestamp.toLocaleTimeString()}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigator.clipboard.writeText(msg.content)}
                            className="h-6 w-6 p-0 text-zinc-400 hover:text-zinc-200"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setInput(msg.content)}
                            className="h-6 w-6 p-0 text-zinc-400 hover:text-zinc-200"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {msg.role === "user" && (
                      <Avatar className="h-9 w-9 border border-zinc-700 bg-zinc-800 shrink-0">
                        <AvatarFallback className="bg-zinc-700 text-zinc-300">
                          <User className="h-5 w-5" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex items-start gap-4 justify-start">
                  <div className="relative w-10 h-10 border rounded-full flex flex-col justify-center items-center">
                    <Brain className="h-5 w-5 text-zinc-400" />
                  </div>
                  <div className="bg-zinc-900/80 backdrop-blur-sm border border-zinc-800/50 p-5 rounded-xl rounded-bl-md flex items-center gap-3">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                    <span className="text-sm text-zinc-300">
                      {chatMode === "review"
                        ? "Analyzing code structure and patterns…"
                        : chatMode === "fix"
                        ? "Identifying issues and solutions…"
                        : chatMode === "optimize"
                        ? "Analyzing performance bottlenecks…"
                        : "Processing your request…"}
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-1" />
            </div>
          </div>

          {/* ── Input form ── */}
          <form
            onSubmit={handleSendMessage}
            className="shrink-0 p-4 border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-sm"
          >
            {/* Context preview — show which files will be attached */}
            {(activeFilePath || fileTree) && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="shrink-0">Will attach:</span>
                {activeFilePath && (
                  <span className="px-1.5 py-0.5 bg-blue-950/40 border border-blue-800/40 rounded text-blue-400 font-mono">
                    {activeFilePath.split("/").pop()}
                  </span>
                )}
                {fileTree && (
                  <span className="text-zinc-600">+ imports &amp; mentioned files</span>
                )}
              </div>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1 relative">
                <Textarea
                  placeholder={
                    chatMode === "chat"
                      ? "Ask about your code, request improvements…"
                      : chatMode === "review"
                      ? "Describe what you'd like me to review…"
                      : chatMode === "fix"
                      ? "Describe the issue you're experiencing…"
                      : "Describe what you'd like me to optimize…"
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleSendMessage(e as any);
                    }
                  }}
                  disabled={isLoading}
                  className="min-h-[44px] max-h-32 bg-zinc-800/50 border-zinc-700/50 text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:ring-blue-500/20 resize-none pr-20"
                  rows={1}
                />
                <div className="absolute right-3 bottom-3 flex items-center gap-2">
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-xs text-zinc-500 bg-zinc-800 border border-zinc-700 rounded">
                    ⌘↵
                  </kbd>
                </div>
              </div>
              <Button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="h-11 px-4 bg-blue-600 hover:bg-blue-700 text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </form>
        </div>
      </>
    </TooltipProvider>
  );
};
