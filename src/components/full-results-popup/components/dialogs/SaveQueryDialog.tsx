import React from "react";
import { Button, Dialog, Classes, InputGroup } from "@blueprintjs/core";
import { StoredQuery } from "../../utils/queryStorage";
import { UnifiedQuery } from "../../types/QueryTypes";
import { QueryRenderer } from "../query-manager/QueryRenderer";
import { PageSelection } from "../../utils/queryStorage";

interface SaveQueryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onReplaceExisting: () => void;
  saveQueryName: string;
  onSaveQueryNameChange: (name: string) => void;
  currentQuery?: UnifiedQuery;
  loadedQuery?: StoredQuery;
  originalLoadedQuery?: StoredQuery | null;
  storedQueryToReplace?: StoredQuery | null;
  sessionPageSelections: PageSelection[];
}

export const SaveQueryDialog: React.FC<SaveQueryDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  onReplaceExisting,
  saveQueryName,
  onSaveQueryNameChange,
  currentQuery,
  loadedQuery,
  originalLoadedQuery,
  storedQueryToReplace,
  sessionPageSelections,
}) => {
  const isModifiedQuery =
    storedQueryToReplace ||
    (loadedQuery &&
      originalLoadedQuery &&
      loadedQuery.userQuery !== originalLoadedQuery.userQuery);

  const title = storedQueryToReplace
    ? "Save Modified Query"
    : loadedQuery &&
      originalLoadedQuery &&
      loadedQuery.userQuery !== originalLoadedQuery.userQuery
    ? "Save Edited Query"
    : "Save Query";

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      className="save-query-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        {isModifiedQuery ? (
          <>
            <p>
              The query has been{" "}
              {sessionPageSelections.length > 0
                ? "modified with page selections"
                : "edited"}
              . How would you like to save it?
            </p>
            <QueryRenderer
              query={
                storedQueryToReplace?.userQuery ||
                loadedQuery?.userQuery ||
                currentQuery?.userQuery ||
                ""
              }
            />
            {sessionPageSelections.length > 0 && (
              <div
                style={{
                  marginTop: "10px",
                  fontSize: "0.9em",
                  color: "#666",
                }}
              >
                <strong>Added Pages:</strong> {sessionPageSelections.length}{" "}
                page selection(s)
              </div>
            )}
            <InputGroup
              placeholder="Enter a name for the new query (if saving as new)"
              value={saveQueryName}
              onChange={(e) => onSaveQueryNameChange(e.target.value)}
              autoFocus
              style={{ marginTop: "15px" }}
            />
          </>
        ) : (
          <>
            <p>Save the current query for later use:</p>
            <QueryRenderer query={currentQuery?.userQuery || ""} />
            {sessionPageSelections.length === 0 &&
              currentQuery?.formalQuery &&
              currentQuery.formalQuery !== currentQuery.userQuery && (
                <div className="current-formal-query-preview">
                  <strong>Formal Query:</strong>{" "}
                  <QueryRenderer query={currentQuery?.formalQuery || ""} />
                </div>
              )}
            <InputGroup
              placeholder="Enter a name for this query (optional)"
              value={saveQueryName}
              onChange={(e) => onSaveQueryNameChange(e.target.value)}
              autoFocus
            />
          </>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          {isModifiedQuery ? (
            <>
              <Button intent="warning" onClick={onReplaceExisting}>
                Replace Existing
              </Button>
              <Button intent="primary" onClick={onSave}>
                Save as New
              </Button>
            </>
          ) : (
            <Button intent="primary" onClick={onSave}>
              Save Query
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
