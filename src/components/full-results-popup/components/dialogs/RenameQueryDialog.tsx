import React from "react";
import { Button, Dialog, Classes, InputGroup } from "@blueprintjs/core";

interface RenameQueryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onRename: () => void;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
}

export const RenameQueryDialog: React.FC<RenameQueryDialogProps> = ({
  isOpen,
  onClose,
  onRename,
  renameValue,
  onRenameValueChange,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Rename Query"
      className="rename-query-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        <p>Enter a new name for this query:</p>
        <InputGroup
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          autoFocus
        />
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose}>Cancel</Button>
          <Button intent="primary" onClick={onRename}>
            Rename
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
