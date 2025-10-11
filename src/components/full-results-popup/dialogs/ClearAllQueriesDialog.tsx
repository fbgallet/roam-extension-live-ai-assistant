import React from "react";
import { Button, Dialog, Classes } from "@blueprintjs/core";

interface ClearAllQueriesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onClearAll: () => void;
  recentCount: number;
  savedCount: number;
}

export const ClearAllQueriesDialog: React.FC<ClearAllQueriesDialogProps> = ({
  isOpen,
  onClose,
  onClearAll,
  recentCount,
  savedCount,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Delete All Stored Queries ⚠️"
      className="clear-all-queries-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        <p>
          ⚠️ This will permanently delete all stored queries (both recent and
          saved).
        </p>
        <p>
          <strong>Current stored queries:</strong>
        </p>
        <ul>
          <li>Recent queries: {recentCount}</li>
          <li>Saved queries: {savedCount}</li>
        </ul>
        <p>
          <strong>This action cannot be undone.</strong>
        </p>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent="danger" onClick={onClearAll}>
            Clear All Queries
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
