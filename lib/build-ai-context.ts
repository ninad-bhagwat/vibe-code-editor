/**
 * build-ai-context.ts
 *
 * Extracts project-aware context from the playground file tree so the AI
 * chat can understand the codebase without the user having to paste code.
 *
 * Rules:
 *  - Always include the full content of the active file.
 *  - Include any text selection the user highlighted.
 *  - Include files that are imported by the active file (static import/require).
 *  - Include files whose name appears literally in the user's message.
 *  - Ignore node_modules, .next, lockfiles, and binary files.
 *  - Cap total code content at MAX_CONTEXT_CHARS (8 000 chars).
 *    Truncate the last included file with a marker rather than silently dropping chars.
 */

import type { TemplateFile, TemplateFolder } from "@/modules/playground/lib/path-to-json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_CHARS = 8_000;

/** File extensions treated as non-text binaries — never include their content. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp4", "mp3", "wav", "ogg", "webm",
  "pdf", "zip", "tar", "gz", "rar",
  "exe", "dll", "so", "dylib",
  "lock",           // package-lock.json etc. caught by extension too
]);

/** File/folder names to skip entirely when building the context. */
const IGNORED_NAMES = new Set([
  "node_modules", ".next", ".git", "dist", "build", "coverage",
  ".turbo", "__pycache__",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  ".env", ".env.local", ".env.development", ".env.production",
  ".DS_Store", "thumbs.db", "Thumbs.db",
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AiContextFile {
  /** Full virtual path, e.g. "src/utils.ts" */
  path: string;
  content: string;
  /** Why this file was included */
  reason: "active" | "imported" | "mentioned" | "selection";
}

export interface AiContext {
  /** Every file path in the project (for the system prompt's directory listing). */
  allFilePaths: string[];
  /** Files whose content was injected into the prompt. */
  includedFiles: AiContextFile[];
  /** The user's text selection, if any. */
  selection: string | null;
  /** True when the 8 000-char cap was hit and content was truncated. */
  wasTruncated: boolean;
  /** Total chars of code included (before truncation). */
  totalChars: number;
}

export interface BuildAiContextOptions {
  /** Root of the playground file tree. */
  files: TemplateFolder | null | undefined;
  /** Full virtual path of the currently open file, e.g. "src/App.tsx". */
  activeFilePath: string | null | undefined;
  /**
   * Live content of the active file from the editor (may differ from the tree
   * if there are unsaved changes). When provided, overrides the tree content
   * for the active file so the AI sees the latest unsaved state.
   */
  activeFileContent?: string | null;
  /** Selected text in the editor (may be empty string or null). */
  selection?: string | null;
  /** The user's chat message — used to detect file mentions. */
  message: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Walk the TemplateFolder tree and collect every file as { path, file }.
 * `basePath` accumulates the virtual path segments.
 */
function collectFiles(
  node: TemplateFolder | TemplateFile,
  basePath: string,
  out: Array<{ path: string; file: TemplateFile }>
): void {
  if (isFile(node)) {
    const fullName = node.fileExtension
      ? `${node.filename}.${node.fileExtension}`
      : node.filename;
    const filePath = basePath ? `${basePath}/${fullName}` : fullName;

    // Skip ignored names and binary extensions
    if (
      !IGNORED_NAMES.has(fullName) &&
      !BINARY_EXTENSIONS.has(node.fileExtension?.toLowerCase() ?? "")
    ) {
      out.push({ path: filePath, file: node });
    }
  } else {
    // It's a folder
    if (IGNORED_NAMES.has(node.folderName)) return;
    const nextBase = basePath ? `${basePath}/${node.folderName}` : node.folderName;
    for (const item of node.items) {
      collectFiles(item as TemplateFolder | TemplateFile, nextBase, out);
    }
  }
}

function isFile(node: TemplateFolder | TemplateFile): node is TemplateFile {
  return "filename" in node;
}

/**
 * Extract all static import/require paths from source text.
 * Handles: import ... from '...', require('...'), import('...')
 * Only returns relative paths (starts with . or /).
 */
function extractImportPaths(source: string): string[] {
  const patterns = [
    // ES module import: import ... from './path'  OR  import './path'
    /(?:import\s+(?:[\s\S]*?\s+from\s+)?|from\s+)['"]([^'"]+)['"]/g,
    // CommonJS require: require('./path')
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    // Dynamic import: import('./path')
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  const found = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(source)) !== null) {
      const p = m[1];
      // Only care about relative imports; skip npm package names
      if (p.startsWith(".") || p.startsWith("/")) {
        found.add(p);
      }
    }
  }
  return Array.from(found);
}

/**
 * Given a virtual import path (e.g. "../utils" or "./components/Button")
 * and the importing file's directory, resolve the path and find a match
 * in the known file list.
 */
function resolveImport(
  importPath: string,
  importerDir: string,
  allFiles: Array<{ path: string; file: TemplateFile }>
): { path: string; file: TemplateFile } | undefined {
  // Normalise slashes
  const normalise = (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/");

  // Resolve the import relative to the importer directory
  const parts = (importerDir + "/" + importPath).split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") { resolved.pop(); continue; }
    resolved.push(p);
  }
  const resolvedBase = normalise(resolved.join("/"));

  // Try exact match, then common extensions, then index files
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`,
    `${resolvedBase}/index.ts`,
    `${resolvedBase}/index.tsx`,
    `${resolvedBase}/index.js`,
    `${resolvedBase}/index.jsx`,
  ];

  for (const candidate of candidates) {
    const hit = allFiles.find((f) => normalise(f.path) === candidate);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Append `content` to the budget, respecting the MAX_CONTEXT_CHARS cap.
 * Returns the (possibly truncated) content and whether truncation happened.
 */
function budget(
  content: string,
  used: number
): { text: string; truncated: boolean } {
  const remaining = MAX_CONTEXT_CHARS - used;
  if (remaining <= 0) return { text: "", truncated: true };
  if (content.length <= remaining) return { text: content, truncated: false };
  const truncated = content.slice(0, remaining);
  return {
    text: truncated + "\n/* [context truncated: 8 000-char limit reached] */",
    truncated: true,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAiContext(opts: BuildAiContextOptions): AiContext {
  const { files, activeFilePath, activeFileContent, selection, message } = opts;

  // Collect every file in the tree
  const allEntries: Array<{ path: string; file: TemplateFile }> = [];
  if (files) {
    collectFiles(files, "", allEntries);
  }

  const allFilePaths = allEntries.map((e) => e.path);

  // Find the active file entry
  const activeEntry = activeFilePath
    ? allEntries.find(
        (e) =>
          e.path === activeFilePath ||
          e.path.endsWith("/" + activeFilePath) ||
          activeFilePath.endsWith("/" + e.path)
      )
    : undefined;

  const includedFiles: AiContextFile[] = [];
  let usedChars = 0;
  let wasTruncated = false;

  // ── 1. Active file (always first, gets priority) ────────────────────────
  if (activeEntry) {
    // Prefer live editor content over stale tree content so the AI sees
    // the exact bytes the user is looking at, including unsaved changes.
    const content =
      activeFileContent != null && activeFileContent !== ""
        ? activeFileContent
        : activeEntry.file.content;

    const { text, truncated } = budget(content, usedChars);
    if (text) {
      includedFiles.push({ path: activeEntry.path, content: text, reason: "active" });
      usedChars += text.length;
    }
    if (truncated) wasTruncated = true;
  }

  // ── 2. Imported files ────────────────────────────────────────────────────
  if (activeEntry && !wasTruncated) {
    const importerDir = activeEntry.path.includes("/")
      ? activeEntry.path.split("/").slice(0, -1).join("/")
      : "";

    const importPaths = extractImportPaths(activeEntry.file.content);

    for (const imp of importPaths) {
      if (wasTruncated) break;
      const resolved = resolveImport(imp, importerDir, allEntries);
      if (!resolved) continue;
      // Skip if already included
      if (includedFiles.some((f) => f.path === resolved.path)) continue;

      const { text, truncated } = budget(resolved.file.content, usedChars);
      if (text) {
        includedFiles.push({ path: resolved.path, content: text, reason: "imported" });
        usedChars += text.length;
      }
      if (truncated) wasTruncated = true;
    }
  }

  // ── 3. Files mentioned by name in the message ────────────────────────────
  if (!wasTruncated && message.trim()) {
    for (const entry of allEntries) {
      if (wasTruncated) break;
      if (includedFiles.some((f) => f.path === entry.path)) continue;

      const fullName = entry.path.split("/").pop() ?? entry.path;
      // Check if the message contains the filename (case-insensitive)
      if (message.toLowerCase().includes(fullName.toLowerCase())) {
        const { text, truncated } = budget(entry.file.content, usedChars);
        if (text) {
          includedFiles.push({ path: entry.path, content: text, reason: "mentioned" });
          usedChars += text.length;
        }
        if (truncated) wasTruncated = true;
      }
    }
  }

  return {
    allFilePaths,
    includedFiles,
    selection: selection?.trim() || null,
    wasTruncated,
    totalChars: usedChars,
  };
}
