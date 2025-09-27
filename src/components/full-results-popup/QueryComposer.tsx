import React, { useState } from "react";
import { Button, HTMLSelect, Popover } from "@blueprintjs/core";
import ModelsMenu from "../ModelsMenu";
import { defaultModel } from "../..";

interface QueryComposerProps {
  composerQuery: string;
  isComposingQuery: boolean;
  onQueryChange: (query: string) => void;
  onExecuteQuery: (mode: "add" | "replace", model?: string) => void;
  hasActiveQuery?: boolean; // Whether there's an active query to add to
}

const QueryComposer: React.FC<QueryComposerProps> = ({
  composerQuery,
  isComposingQuery,
  onQueryChange,
  onExecuteQuery,
  hasActiveQuery = false,
}) => {
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);

  const handleModelSelection = async ({ model }) => {
    setSelectedModel(model);
    setIsModelMenuOpen(false);
  };

  return (
    <div className="query-tool-section">
      <div className="query-composer-header">
        <h6>New query to complete or replace results</h6>
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
            placement="top"
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
      </div>

      <div className="query-composer-wrapper">
        <div className="query-composer-input">
          <textarea
            className="query-composer-textarea"
            placeholder="Enter your additional query..."
            value={composerQuery}
            onChange={(e) => onQueryChange(e.target.value)}
            disabled={isComposingQuery}
            rows={2}
          />
        </div>
        <div className="query-composer-actions">
          <Button
            icon={"play"}
            text={isComposingQuery ? "Executing..." : "New query"}
            intent="warning"
            onClick={() => {
              onExecuteQuery("replace", selectedModel);
            }}
            disabled={!composerQuery.trim() || isComposingQuery}
            loading={isComposingQuery}
            title={
              isComposingQuery ? "Executing..." : "Replace current results"
            }
          />
          <Button
            icon={"plus"}
            text={isComposingQuery ? "Executing..." : "Add query"}
            intent="primary"
            onClick={() => {
              onExecuteQuery("add", selectedModel);
            }}
            disabled={
              !composerQuery.trim() || isComposingQuery || !hasActiveQuery
            }
            loading={isComposingQuery}
            title={
              isComposingQuery
                ? "Executing..."
                : !hasActiveQuery
                ? "No active query to add to - run a query first"
                : "Add to current results"
            }
          />
        </div>
      </div>
    </div>
  );
};

export default QueryComposer;
