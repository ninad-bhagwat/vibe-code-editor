"use server";

import { db } from "@/lib/db";
import { currentUser } from "@/modules/auth/actions";
import { revalidatePath } from "next/cache";
import { fetchGitHubRepoTree } from "@/modules/github/actions";
import { convertGitHubToTemplate, detectTemplate } from "@/modules/github/utils";
import type { GitHubRepo } from "@/modules/github/actions";

export const toggleStarMarked = async (
  playgroundId: string,
  isChecked: boolean
) => {
  const user = await currentUser();
  const userId = user?.id;
  if (!userId) {
    throw new Error("User Id is Required");
  }

  try {
    if (isChecked) {
      await db.starMark.create({
        data: {
          userId,
          playgroundId,
          isMarked: isChecked,
        },
      });
    } else {
      await db.starMark.delete({
        where: {
          userId_playgroundId: {
            userId,
            playgroundId,
          },
        },
      });
    }

    revalidatePath("/dashboard");
    return { success: true, isMarked: isChecked };
  } catch (error) {
    console.error("toggleStarMarked error:", error);
    return { success: false, error: "Failed to update star mark" };
  }
};

export const getAllPlaygroundForUser = async () => {
  const user = await currentUser();

  try {
    const playgrounds = await db.playground.findMany({
      where: {
        userId: user?.id,
      },
      include: {
        user: true,
        // ✅ correct relation name from schema: starMarks (not Starmark)
        starMarks: {
          where: {
            userId: user?.id!,
          },
          select: {
            isMarked: true,
          },
        },
      },
    });

    return playgrounds;
  } catch (error) {
    console.error("getAllPlaygroundForUser error:", error);
    return [];
  }
};

export const createPlayground = async (data: {
  title: string;
  template: "REACT" | "NEXTJS" | "EXPRESS" | "VUE" | "HONO" | "ANGULAR";
  description?: string;
}) => {
  const user = await currentUser();
  const { template, title, description } = data;

  try {
    const playground = await db.playground.create({
      data: {
        title,
        description,
        template,
        userId: user?.id!,
      },
    });

    return playground;
  } catch (error) {
    console.error("createPlayground error:", error);
    return null;
  }
};

/**
 * Create a playground from a GitHub repository
 */
export const createPlaygroundFromGitHub = async (
  repo: GitHubRepo
): Promise<{
  success: boolean;
  playgroundId?: string;
  error?: string;
  warnings?: string[];
}> => {
  const user = await currentUser();

  if (!user?.id) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    // Parse owner and repo from full_name
    const [owner, repoName] = repo.full_name.split("/");

    // Fetch the repository tree
    const treeResult = await fetchGitHubRepoTree(owner, repoName, repo.default_branch);

    if (!treeResult.success || !treeResult.tree) {
      return {
        success: false,
        error: treeResult.error || "Failed to fetch repository tree",
      };
    }

    // Convert GitHub tree to template structure
    const { folder, fileCount, warnings } = await convertGitHubToTemplate(
      owner,
      repoName,
      treeResult.tree,
      300
    );

    // Find package.json content to detect template type
    let template: "REACT" | "NEXTJS" | "EXPRESS" | "VUE" | "HONO" | "ANGULAR" = "REACT";
    const packageJsonFile = folder.items.find(
      (item) => "filename" in item && item.filename === "package" && item.fileExtension === "json"
    );
    if (packageJsonFile && "content" in packageJsonFile) {
      template = detectTemplate(packageJsonFile.content);
    }

    // Create the playground record
    const playground = await db.playground.create({
      data: {
        title: repo.name,
        description: repo.description || `Imported from GitHub: ${repo.full_name}`,
        template,
        userId: user.id,
      },
    });

    // Save the template files
    await db.templateFile.create({
      data: {
        playgroundId: playground.id,
        content: JSON.stringify(folder),
      },
    });

    revalidatePath("/dashboard");

    return {
      success: true,
      playgroundId: playground.id,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    console.error("createPlaygroundFromGitHub error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to import repository",
    };
  }
};

export const deleteProjectById = async (id: string) => {
  try {
    await db.playground.delete({
      where: { id },
    });
    revalidatePath("/dashboard");
  } catch (error) {
    console.error("deleteProjectById error:", error);
  }
};

export const editProjectById = async (
  id: string,
  data: { title: string; description: string }
) => {
  try {
    await db.playground.update({
      where: { id },
      data,
    });
    revalidatePath("/dashboard");
  } catch (error) {
    console.error("editProjectById error:", error);
  }
};

export const duplicateProjectById = async (id: string) => {
  try {
    const originalPlayground = await db.playground.findUnique({
      where: { id },
    });

    if (!originalPlayground) {
      throw new Error("Original playground not found");
    }

    const duplicatedPlayground = await db.playground.create({
      data: {
        title: `${originalPlayground.title} (Copy)`,
        description: originalPlayground.description,
        template: originalPlayground.template,
        userId: originalPlayground.userId,
      },
    });

    revalidatePath("/dashboard");
    return duplicatedPlayground;
  } catch (error) {
    console.error("duplicateProjectById error:", error);
    return null;
  }
};
