import { TemplateFile, TemplateFolder } from "@/modules/playground/lib/path-to-json";

interface WebContainerFile {
  file: {
    contents: string;
  };
}

interface WebContainerDirectory {
  directory: {
    [key: string]: WebContainerFile | WebContainerDirectory;
  };
}

type WebContainerFileSystem = Record<
  string,
  WebContainerFile | WebContainerDirectory
>;

type TemplateItem = TemplateFile | TemplateFolder;

/**
 * Type guard to check if an item is a folder
 */
function isFolder(item: TemplateItem): item is TemplateFolder {
  return "folderName" in item && "items" in item;
}

/**
 * Derives the filesystem key for an item:
 *   - directory  →  folderName          (e.g. "src")
 *   - file w/ ext → "filename.ext"      (e.g. "package.json", "App.tsx")
 *   - file no ext → "filename"          (e.g. ".gitkeep stored as filename='.gitkeep', ext='')
 *
 * NOTE: path-to-json stores "package.json" as { filename: "package", fileExtension: "json" }
 * so the key correctly becomes "package.json" — no special casing needed.
 */
function getItemKey(item: TemplateItem): string {
  if (isFolder(item)) {
    // directory
    return item.folderName;
  }
  // file
  return item.fileExtension
    ? `${item.filename}.${item.fileExtension}`
    : item.filename;
}

function processItem(
  item: TemplateItem
): WebContainerFile | WebContainerDirectory {
  if (isFolder(item)) {
    // directory
    const directoryContents: WebContainerFileSystem = {};

    for (const subItem of item.items) {
      const key = getItemKey(subItem);
      if (key) {
        directoryContents[key] = processItem(subItem);
      }
    }

    return { directory: directoryContents };
  }

  // file
  return {
    file: {
      contents: item.content ?? "",
    },
  };
}

export function transformToWebContainerFormat(template: TemplateFolder): WebContainerFileSystem {
  const result: WebContainerFileSystem = {};

  for (const item of template.items) {
    const key = getItemKey(item);
    if (key) {
      result[key] = processItem(item);
    }
  }

  return result;
}
