"use server";

import { db } from "@/lib/db";
import { currentUser } from "@/modules/auth/actions";

/**
 * GitHub repository metadata
 */
export interface GitHubRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  default_branch: string;
  private: boolean;
  updated_at: string;
  html_url: string;
}

/**
 * Fetch the user's GitHub repositories (public + private if token has repo scope)
 */
export const fetchUserRepositories = async (): Promise<{
  success: boolean;
  repos?: GitHubRepo[];
  error?: string;
  hasRepoScope?: boolean;
}> => {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Get the GitHub account for this user
    const account = await db.account.findFirst({
      where: {
        userId: user.id,
        provider: "github",
      },
    });

    if (!account || !account.accessToken) {
      return { success: false, error: "GitHub not connected" };
    }

    const hasRepoScope = account.scope?.includes("repo") ?? false;

    // Fetch user repositories from GitHub API
    const response = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated",
      {
        headers: {
          Authorization: `token ${account.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (response.status === 401) {
      return { success: false, error: "GitHub token expired or invalid" };
    }

    if (response.status === 403) {
      return {
        success: false,
        error: "GitHub API rate limited. Try again later.",
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API error: ${response.statusText}`,
      };
    }

    const repos = (await response.json()) as GitHubRepo[];
    return { success: true, repos, hasRepoScope };
  } catch (error) {
    console.error("fetchUserRepositories error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fetch repositories",
    };
  }
};

/**
 * Fetch the file tree of a GitHub repository
 */
export const fetchGitHubRepoTree = async (
  owner: string,
  repo: string,
  branch: string
): Promise<{
  success: boolean;
  tree?: Array<{
    path: string;
    type: "blob" | "tree";
    sha: string;
    size?: number;
  }>;
  error?: string;
}> => {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const account = await db.account.findFirst({
      where: {
        userId: user.id,
        provider: "github",
      },
    });

    if (!account || !account.accessToken) {
      return { success: false, error: "GitHub not connected" };
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          Authorization: `token ${account.accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: "Repository or branch not found" };
      }
      return {
        success: false,
        error: `GitHub API error: ${response.statusText}`,
      };
    }

    const data = (await response.json()) as {
      tree: Array<{
        path: string;
        type: "blob" | "tree";
        sha: string;
        size?: number;
      }>;
      truncated: boolean;
    };

    return { success: true, tree: data.tree };
  } catch (error) {
    console.error("fetchGitHubRepoTree error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fetch repository tree",
    };
  }
};

/**
 * Fetch content of a single file from GitHub
 */
export const fetchGitHubFileContent = async (
  owner: string,
  repo: string,
  filePath: string
): Promise<{ success: boolean; content?: string; error?: string }> => {
  const user = await currentUser();
  if (!user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const account = await db.account.findFirst({
      where: {
        userId: user.id,
        provider: "github",
      },
    });

    if (!account || !account.accessToken) {
      return { success: false, error: "GitHub not connected" };
    }

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        headers: {
          Authorization: `token ${account.accessToken}`,
          Accept: "application/vnd.github.v3.raw",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false, error: "File not found" };
      }
      return {
        success: false,
        error: `GitHub API error: ${response.statusText}`,
      };
    }

    const content = await response.text();
    return { success: true, content };
  } catch (error) {
    console.error("fetchGitHubFileContent error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fetch file content",
    };
  }
};
