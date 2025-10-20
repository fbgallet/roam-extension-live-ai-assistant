import React, { useState } from "react";
import { Button, InputGroup } from "@blueprintjs/core";

interface EditableQueryTextProps {
  query: string;
  onSave: (newQuery: string) => void;
  label?: string;
  compact?: boolean;
}

export const EditableQueryText: React.FC<EditableQueryTextProps> = ({
  query,
  onSave,
  label,
  compact = true,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(query);

  const handleSave = () => {
    if (editValue.trim() && editValue !== query) {
      onSave(editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(query);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="editable-query-editing">
        {label && <span className="query-renderer-label">{label}:</span>}
        <InputGroup
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              handleCancel();
            }
          }}
          autoFocus
          className="editable-query-input"
          rightElement={
            <div className="editable-query-actions">
              <Button
                minimal
                small
                icon="tick"
                intent="success"
                onClick={handleSave}
                title="Save changes (Enter)"
                disabled={!editValue.trim()}
              />
              <Button
                minimal
                small
                icon="undo"
                onClick={handleCancel}
                title="Cancel (Esc)"
              />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="editable-query-view">
      {label && <span className="query-renderer-label">{label}:</span>}
      <span className="editable-query-text">{query}</span>
      <Button
        minimal
        small
        icon="edit"
        onClick={() => setIsEditing(true)}
        className="editable-query-edit-btn"
        title="Edit query"
      />
    </div>
  );
};

export default EditableQueryText;
