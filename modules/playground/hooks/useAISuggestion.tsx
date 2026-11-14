import { useState, useCallback, useRef } from "react";

interface AISuggestionsState {
  suggestion: string | null;
  isLoading: boolean;
  position: { line: number; column: number } | null;
  decoration: string[];
  isEnabled: boolean;
}

interface UseAISuggestionsReturn extends AISuggestionsState {
  toggleEnabled: () => void;
  fetchSuggestion: (type: string, editor: any) => Promise<void>;
  acceptSuggestion: (editor: any, monaco: any) => void;
  rejectSuggestion: (editor: any) => void;
  clearSuggestion: (editor: any) => void;
}

export const useAISuggestions = (): UseAISuggestionsReturn => {
  const [state, setState] = useState<AISuggestionsState>({
    suggestion: null,
    isLoading: false,
    position: null,
    decoration: [],
    isEnabled: true,
  });

  // Bug fix: store isEnabled in a ref so fetchSuggestion can read it
  // synchronously without depending on React's async setState flush.
  // The ref is kept in sync with state via toggleEnabled.
  const isEnabledRef = useRef(true);

  const toggleEnabled = useCallback(() => {
    setState((prev) => {
      const next = !prev.isEnabled;
      isEnabledRef.current = next;   // keep ref in sync
      return { ...prev, isEnabled: next };
    });
  }, []);

  const fetchSuggestion = useCallback(async (type: string, editor: any) => {
    console.log("[AI] fetchSuggestion triggered", { type, isEnabled: isEnabledRef.current });

    // Guard 1 — no editor instance yet
    if (!editor) {
      console.log("[AI] early return: no editor");
      return;
    }

    // Guard 2 — AI suggestions are toggled off
    // Read from the ref, NOT from state, so the check is synchronous.
    if (!isEnabledRef.current) {
      console.log("[AI] early return: suggestions disabled");
      return;
    }

    const model = editor.getModel();
    const cursorPosition = editor.getPosition();

    // Guard 3 — editor not ready
    if (!model || !cursorPosition) {
      console.log("[AI] early return: model or cursorPosition missing");
      return;
    }

    // Set loading=true once, before the try block.
    // A finally block guarantees it is always reset.
    setState((prev) => ({ ...prev, isLoading: true, suggestion: null }));

    try {
      const payload = {
        fileContent: model.getValue(),
        cursorLine: cursorPosition.lineNumber - 1,
        cursorColumn: cursorPosition.column - 1,
        suggestionType: type,
      };

      console.log("[AI] calling fetch /api/code-completion", payload);

      const response = await fetch("/api/code-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();
      console.log("[AI] response received", { hasSuggestion: !!data.suggestion });

      if (data.suggestion) {
        setState((prev) => ({
          ...prev,
          suggestion: data.suggestion.trim(),
          position: {
            line: cursorPosition.lineNumber,
            column: cursorPosition.column,
          },
        }));
      }
    } catch (error) {
      console.error("[AI] fetch error:", error);
    } finally {
      // Bug fix: always reset isLoading regardless of success, error,
      // or early-return paths — using finally guarantees the badge
      // never gets stuck on "AI thinking...".
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []); // no deps — reads editor via param, isEnabled via ref

  const acceptSuggestion = useCallback((editor: any, monaco: any) => {
    setState((currentState) => {
      if (
        !currentState.suggestion ||
        !currentState.position ||
        !editor ||
        !monaco
      ) {
        return currentState;
      }

      const { line, column } = currentState.position;
      const sanitizedSuggestion = currentState.suggestion.replace(
        /^\d+:\s*/gm,
        ""
      );

      editor.executeEdits("", [
        {
          range: new monaco.Range(line, column, line, column),
          text: sanitizedSuggestion,
          forceMoveMarkers: true,
        },
      ]);

      if (currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }

      return {
        ...currentState,
        suggestion: null,
        position: null,
        decoration: [],
      };
    });
  }, []);

  const rejectSuggestion = useCallback((editor: any) => {
    setState((currentState) => {
      if (editor && currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }
      return {
        ...currentState,
        suggestion: null,
        position: null,
        decoration: [],
      };
    });
  }, []);

  const clearSuggestion = useCallback((editor: any) => {
    setState((currentState) => {
      if (editor && currentState.decoration.length > 0) {
        editor.deltaDecorations(currentState.decoration, []);
      }
      return {
        ...currentState,
        suggestion: null,
        position: null,
        decoration: [],
      };
    });
  }, []);

  return {
    ...state,
    toggleEnabled,
    fetchSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    clearSuggestion,
  };
};
