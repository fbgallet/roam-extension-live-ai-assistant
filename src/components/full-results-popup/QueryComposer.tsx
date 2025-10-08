import React, { useState } from "react";
import { Button, HTMLSelect, Popover, Collapse, Icon } from "@blueprintjs/core";
import ModelsMenu from "../ModelsMenu";
import { defaultModel } from "../..";

interface QueryComposerProps {
  composerQuery: string;
  isComposingQuery: boolean;
  onQueryChange: (query: string) => void;
  onExecuteQuery: (mode: "add" | "replace", model?: string) => void;
  hasActiveQuery?: boolean; // Whether there's an active query to add to
  hasLoadedQuery?: boolean; // Whether there's a loaded query ready to run
  isExpanded?: boolean; // Control expansion from parent
  onToggleExpanded?: () => void; // Callback to toggle expansion
  executingMode?: "add" | "replace" | null; // Which button is currently executing
  showInputSection?: boolean; // Whether to show the collapsible input section
}

const QueryComposer: React.FC<QueryComposerProps> = ({
  composerQuery,
  isComposingQuery,
  onQueryChange,
  onExecuteQuery,
  hasActiveQuery = false,
  hasLoadedQuery = false,
  isExpanded = true,
  onToggleExpanded,
  executingMode = null,
  showInputSection = true,
}) => {
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const handleModelSelection = async ({ model }) => {
    setSelectedModel(model);
    setIsModelMenuOpen(false);
  };

  return (
    <div className="query-tool-section">
      {showInputSection && (
        <>
          <div
            className="query-composer-header"
            onClick={(e) => {
              console.log("🖱️ [QueryComposer Header] Clicked");
              onToggleExpanded?.();
            }}
            style={{ cursor: "pointer", gap: "8px" }}
          >
            <Icon icon="manually-entered-data" />
            <h6>Type a custom query</h6>
            <Button
              minimal
              small
              icon={isExpanded ? "chevron-up" : "chevron-down"}
              disabled={isComposingQuery}
            />
          </div>

          <Collapse isOpen={isExpanded}>
            <div className="query-composer-wrapper">
              <div className="query-composer-input">
                <textarea
                  className="query-composer-textarea"
                  placeholder="Type a new query..."
                  value={composerQuery}
                  onChange={(e) => onQueryChange(e.target.value)}
                  disabled={isComposingQuery}
                  rows={2}
                />
              </div>
            </div>
          </Collapse>
        </>
      )}

      <div className="query-composer-actions">
        <div className="query-composer-model-selector">
          <Popover
            isOpen={isModelMenuOpen}
            onInteraction={(nextOpenState) => setIsModelMenuOpen(nextOpenState)}
            content={
              <ModelsMenu
                callback={handleModelSelection}
                setModel={setSelectedModel}
                command={null}
                prompt=""
                isConversationToContinue={false}
              />
            }
            placement="bottom-start"
            minimal
          >
            <Button
              minimal
              small
              icon="cog"
              text={selectedModel}
              title="Click to change AI model"
              disabled={isComposingQuery}
            />
          </Popover>
        </div>
        <Button
          icon={"play"}
          text={
            executingMode === "replace"
              ? "Executing..."
              : hasActiveQuery
              ? "New query"
              : "Run query"
          }
          intent="warning"
          onClick={() => {
            console.log("▶️ [Run Query Button] Clicked");
            onExecuteQuery("replace", selectedModel);
          }}
          disabled={
            (!composerQuery.trim() && !hasLoadedQuery) || isComposingQuery
          }
          loading={executingMode === "replace"}
          title={
            executingMode === "replace"
              ? "Executing..."
              : `${
                  hasLoadedQuery
                    ? "Run loaded query"
                    : hasActiveQuery
                    ? "Replace current results"
                    : "Run query"
                } (hasLoadedQuery=${hasLoadedQuery})`
          }
        />
        {hasActiveQuery && (
          <Button
            icon={"plus"}
            text={executingMode === "add" ? "Executing..." : "Add query"}
            intent="primary"
            onClick={() => {
              onExecuteQuery("add", selectedModel);
            }}
            disabled={(!composerQuery.trim() && !hasLoadedQuery) || isComposingQuery}
            loading={executingMode === "add"}
            title={
              executingMode === "add"
                ? "Executing..."
                : hasLoadedQuery
                ? "Add loaded query to current results"
                : "Add to current results"
            }
          />
        )}
      </div>
    </div>
  );
};

export default QueryComposer;
