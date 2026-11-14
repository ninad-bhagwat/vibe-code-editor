/**
 * Utilities for converting GitHub repository structure to our TemplateFolder format
 */

import type { TemplateFolder, TemplateFile } from "@/modules/playground/lib/path-to-json";
import { fetchGitHubFileContent } from "./actions";

// Files/patterns to ignore when importing
const IGNORE_PATTERNS = [
  /^\.git\//,
  /^\.next\//,
  /^node_modules\//,
  /^dist\//,
  /^build\//,
  /^\.turbo\//,
  /\.(lockb|lock|lock\.json|lock\.yaml)$/i,
  /\.(png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf|eot|otf|mp4|mp3|wav|ogg|pdf|zip)$/i,
];

const KEEP_PATTERNS = [/^package\.json$/i, /^tsconfig\.json$/i, /^\.env\.example$/i];

function shouldIgnoreFile(path: string): boolean {
  // Always keep whitelisted files even if they match ignore patterns
  if (KEEP_PATTERNS.some((p) => p.test(path))) {
    return false;
  }

  return IGNORE_PATTERNS.some((p) => p.test(path));
}

/**
 * Detect the template type based on package.json content
 */
export function detectTemplate(
  packageJsonContent: string
): "REACT" | "NEXTJS" | "EXPRESS" | "VUE" | "HONO" | "ANGULAR" {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    if (deps["next"]) return "NEXTJS";
    if (deps["express"]) return "EXPRESS";
    if (deps["hono"]) return "HONO";
    if (deps["vue"]) return "VUE";
    if (deps["@angular/core"]) return "ANGULAR";
    if (deps["react"]) return "REACT";
  } catch {}

  return "REACT"; // Default fallback
}

/**
 * Convert GitHub file tree + content into TemplateFolder structure
 *
 * @param owner GitHub repo owner
 * @param repo GitHub repo name
 * @param tree Array of tree items from GitHub API
 * @param maxFiles Maximum number of files to include (default 300)
 * @returns Promise<{folder: TemplateFolder; fileCount: number; warnings: string[]}>
 */
export async function convertGitHubToTemplate(
  owner: string,
  repo: string,
  tree: Array<{
    path: string;
    type: "blob" | "tree";
    sha: string;
    size?: number;
  }>,
  maxFiles = 300
): Promise<{
  folder: TemplateFolder;
  fileCount: number;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const root: TemplateFolder = { folderName: repo, items: [] };
  const pathMap = new Map<string, TemplateFolder>([["", root]]);

  // Filter and sort files
  let files = tree
    .filter((item) => item.type === "blob" && !shouldIgnoreFile(item.path))
    .filter((item) => !item.size || item.size <= 200 * 1024) // Skip files > 200KB
    .slice(0, maxFiles);

  if (tree.filter((i) => i.type === "blob").length > maxFiles) {
    warnings.push(
      `Repository has more than ${maxFiles} files. Truncated to the first ${maxFiles} files.`
    );
  }

  // Create folder structure
  for (const file of files) {
    const parts = file.path.split("/");
    let currentPath = "";

    // Ensure all parent directories exist
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

      if (!pathMap.has(currentPath)) {
        const newFolder: TemplateFolder = { folderName, items: [] };
        const parent = pathMap.get(parentPath)!;
        parent.items.push(newFolder);
        pathMap.set(currentPath, newFolder);
      }
    }
  }

  // Fetch file contents and add to structure
  for (const file of files) {
    const result = await fetchGitHubFileContent(owner, repo, file.path);

    if (!result.success) {
      console.warn(
        `Failed to fetch ${file.path}: ${result.error}. Skipping.`
      );
      continue;
    }

    const parts = file.path.split("/");
    const fileName = parts[parts.length - 1];
    const dotIdx = fileName.lastIndexOf(".");
    const filename = dotIdx > -1 ? fileName.slice(0, dotIdx) : fileName;
    const fileExtension = dotIdx > -1 ? fileName.slice(dotIdx + 1) : "";

    const templateFile: TemplateFile = {
      filename,
      fileExtension,
      content: result.content || "",
    };

    const parentPath = parts.slice(0, -1).join("/");
    const parent = pathMap.get(parentPath);

    if (parent) {
      parent.items.push(templateFile);
    } else {
      root.items.push(templateFile);
    }
  }

  return {
    folder: root,
    fileCount: files.length,
    warnings,
  };
}
