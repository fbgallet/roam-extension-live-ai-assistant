import {
  faStop,
  faCopy,
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ContextMenu, Tooltip } from "@blueprintjs/core";
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
    console.log("content from buttons :>> ", content);
    insertCompletion({
      prompt,
      targetUid,
      context: content,
      typeOfCompletion:
        responseFormat === "text" ? "gptCompletion" : "gptPostProcessing",
      instantModel: instantModel || model,
      isRedone: true,
    });
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
              <Tooltip
                content="Stop AI assistant response"
                hoverOpenDelay="500"
              >
                <FontAwesomeIcon icon={faStop} size="sm" />
              </Tooltip>
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
              <Tooltip content="Hide these buttons" hoverOpenDelay="500">
                <FontAwesomeIcon
                  icon={faXmark}
                  style={{ color: "red" }}
                  size="sm"
                />
              </Tooltip>
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
            <Tooltip
              content={
                <p>
                  Generate a response again
                  <br />
                  <code>Right Click</code> to choose another AI model
                </p>
              }
              hoverOpenDelay="500"
            >
              <FontAwesomeIcon icon={faRotateRight} size="sm" />
            </Tooltip>
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
            <Tooltip content="Copy to clipboard" hoverOpenDelay="500">
              <FontAwesomeIcon icon={faCopy} size="sm" />
            </Tooltip>
          </span>
        </span>
      </div>
    </>
  );
};

export default InstantButtons;
