import React, { useState } from "react";
import { Icon, Popover, Tooltip } from "@blueprintjs/core";
import ModelsMenu from "../../ModelsMenu";
import { modelAccordingToProvider } from "../../../ai/aiAPIsHub";
import {
  isActiveModelDefault,
  setActiveModel,
} from "../../../utils/activeModel";

const ActiveModelSelector = ({ activeModel, inputRef }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isDefault = isActiveModelDefault();

  const handleSelectModel = (model) => {
    setActiveModel(model);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    // Stop propagation so that clicks (also from the portal content) don't
    // close the context menu
    <span
      className="laia-active-model"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Popover
        isOpen={isOpen}
        onInteraction={(nextOpenState) => setIsOpen(nextOpenState)}
        position="bottom-left"
        minimal={true}
        content={
          <ModelsMenu
            onSelectModel={handleSelectModel}
            activeModel={activeModel}
          />
        }
      >
        <Tooltip
          content={
            <div>
              Click to switch model for this session
              <br />
              Alt+↓ / Alt+↑: next / previous favorite model
            </div>
          }
          hoverOpenDelay={800}
          openOnTargetFocus={false}
          disabled={isOpen}
          style={{ zIndex: "9999" }}
        >
          <span className="laia-active-model-target">
            Model: <b>{modelAccordingToProvider(activeModel)?.name}</b>
            {isDefault && (
              <Icon icon="pin" size={10} title="Default model" />
            )}
            <Icon icon="caret-down" size={12} />
          </span>
        </Tooltip>
      </Popover>
    </span>
  );
};

export default ActiveModelSelector;
