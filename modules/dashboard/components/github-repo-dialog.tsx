"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, AlertCircle, Github } from "lucide-react";
import { toast } from "sonner";
import { fetchUserRepositories } from "@/modules/github/actions";
import { createPlaygroundFromGitHub } from "../actions";
import type { GitHubRepo } from "@/modules/github/actions";

interface GitHubRepoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected: boolean;
  onConnect: () => void;
}

export const GitHubRepoDialog: React.FC<GitHubRepoDialogProps> = ({
  isOpen,
  onClose,
  isConnected,
  onConnect,
}) => {
  const router = useRouter();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [filteredRepos, setFilteredRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Load repositories when dialog opens and user is connected
  useEffect(() => {
    if (isOpen && isConnected) {
      loadRepositories();
    }
  }, [isOpen, isConnected]);

  // Filter repos as user types
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    setFilteredRepos(
      repos.filter(
        (repo) =>
          repo.name.toLowerCase().includes(term) ||
          repo.full_name.toLowerCase().includes(term)
      )
    );
  }, [searchTerm, repos]);

  const loadRepositories = async () => {
    setIsLoading(true);
    setError(null);

    const result = await fetchUserRepositories();

    if (result.success && result.repos) {
      setRepos(result.repos);
      setFilteredRepos(result.repos);
    } else {
      setError(result.error || "Failed to load repositories");
      toast.error(result.error || "Failed to load repositories");
    }

    setIsLoading(false);
  };

  const handleImportRepo = async (repo: GitHubRepo) => {
    setIsImporting(true);

    try {
      const result = await createPlaygroundFromGitHub(repo);

      if (result.success && result.playgroundId) {
        toast.success(`Imported ${repo.name} successfully!`);
        onClose();
        router.push(`/playground/${result.playgroundId}`);
      } else {
        toast.error(result.error || "Failed to import repository");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import repository"
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import GitHub Repository</DialogTitle>
          <DialogDescription>
            Select a repository to import into the editor
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <AlertCircle className="h-12 w-12 text-yellow-500" />
            <h3 className="text-lg font-semibold">GitHub Not Connected</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Connect your GitHub account to import repositories. We'll use read
              access to your repositories.
            </p>
            <Button onClick={onConnect} className="gap-2">
              <Github className="h-4 w-4" />
              Connect GitHub
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Search input */}
            <Input
              placeholder="Search repositories..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className="h-10"
            />

            {/* Loading state */}
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading repositories...
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm font-medium">{error}</p>
                <Button variant="outline" size="sm" onClick={loadRepositories}>
                  Retry
                </Button>
              </div>
            ) : filteredRepos.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <p className="text-sm">
                  {repos.length === 0
                    ? "No repositories found"
                    : "No repositories match your search"}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.full_name}
                    onClick={() => handleImportRepo(repo)}
                    disabled={isImporting}
                    className="w-full text-left p-3 border rounded-lg hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{repo.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {repo.full_name}
                        </p>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {repo.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          {repo.language && (
                            <span className="px-2 py-0.5 bg-secondary rounded">
                              {repo.language}
                            </span>
                          )}
                          {repo.private && (
                            <span className="px-2 py-0.5 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 rounded">
                              Private
                            </span>
                          )}
                        </div>
                      </div>
                      {isImporting ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0 mt-1" />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleImportRepo(repo);
                          }}
                          disabled={isImporting}
                        >
                          Import
                        </Button>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
