import {
  faStop,
  faCopy,
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ContextMenu } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { insertCompletion } from "../ai/aiCommands.js";
import ModelsMenu from "./ModelsMenu.jsx";

export let isCanceledStreamGlobal = false;

const InstantButtons = ({
  model,
  prompt,
  content,
  responseFormat,
  targetUid,
  isStreamStopped,
  response,
}) => {
  const [isCanceledStream, setIsCanceledStream] = useState(false);
  const [isToUnmount, setIsToUnmount] = useState(false);

  useEffect(() => {
    isCanceledStreamGlobal = false;
    return () => {
      isCanceledStreamGlobal = true;
    };
  }, []);

  const handleCancel = () => {
    setIsCanceledStream(true);
    isCanceledStreamGlobal = true;
  };

  const handleRedo = (e, instantModel) => {
    isCanceledStreamGlobal = true;
    insertCompletion(
      prompt,
      targetUid,
      content,
      responseFormat === "text" ? "gptCompletion" : "gptPostProcessing",
      instantModel || model,
      true
    );
    setIsToUnmount(true);
  };

  const handleClose = () => {
    setIsToUnmount(true);
  };

  if (isToUnmount) return null;

  return (
    <>
      {!isCanceledStream && isStreamStopped === false && (
        <div class="bp3-popover-wrapper">
          <span aria-haspopup="true" class="bp3-popover-target">
            <span
              onClick={handleCancel}
              class="bp3-button bp3-minimal"
              tabindex="0"
            >
              <FontAwesomeIcon icon={faStop} />
            </span>
          </span>
        </div>
      )}
      {(isStreamStopped !== false || isCanceledStream) && (
        <div class="bp3-popover-wrapper">
          <span aria-haspopup="true" class="bp3-popover-target">
            <span
              // onKeyDown={handleKeys}
              onClick={handleClose}
              class="bp3-button bp3-minimal"
              tabindex="0"
            >
              <FontAwesomeIcon icon={faXmark} style={{ color: "red" }} />
              {/* size="lg" */}
            </span>
          </span>
        </div>
      )}
      <div class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            // onKeyDown={handleKeys}
            onClick={handleRedo}
            onContextMenu={(e) => {
              e.preventDefault();
              ContextMenu.show(
                ModelsMenu({ command: handleRedo }),
                { left: e.clientX, top: e.clientY },
                null
              );
            }}
            class="bp3-button bp3-minimal"
            tabindex="0"
          >
            <FontAwesomeIcon icon={faRotateRight} />
          </span>
        </span>
      </div>
      <div class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            // onKeyDown={handleKeys}
            onClick={() => {
              navigator.clipboard.writeText(response);
            }}
            class="bp3-button bp3-minimal"
            tabindex="0"
          >
            <FontAwesomeIcon icon={faCopy} />
          </span>
        </span>
      </div>
    </>
  );
};

export default InstantButtons;
