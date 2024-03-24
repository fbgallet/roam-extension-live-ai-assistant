import {
  faCircleStop,
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import { insertCompletion } from "../openai";

export let isCanceledStreamGlobal = false;

const InstantButtons = ({
  model,
  prompt,
  content,
  responseFormat,
  targetUid,
  isStreamStopped,
}) => {
  const [isCanceledStream, setIsCanceledStream] = useState(false);
  const [isToUnmount, setIsToUnmount] = useState(false);

  useEffect(() => {
    console.log("isStreamStopped >>", isStreamStopped);
    isCanceledStreamGlobal = false;
    return () => {
      isCanceledStreamGlobal = true;
    };
  }, []);

  const handleCancel = () => {
    setIsCanceledStream(true);
    isCanceledStreamGlobal = true;
  };

  const handleRedo = () => {
    isCanceledStreamGlobal = true;
    insertCompletion(
      prompt,
      targetUid,
      content,
      responseFormat === "text" ? "gptCompletion" : "gptPostProcessing",
      model,
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
      {!isCanceledStream && !isStreamStopped && (
        <div class="bp3-popover-wrapper">
          <span aria-haspopup="true" class="bp3-popover-target">
            <span
              onClick={handleCancel}
              class="bp3-button bp3-minimal"
              tabindex="0"
            >
              <FontAwesomeIcon icon={faCircleStop} size="lg" />
            </span>
          </span>
        </div>
      )}
      {(isStreamStopped || isCanceledStream) && (
        <div class="bp3-popover-wrapper">
          <span aria-haspopup="true" class="bp3-popover-target">
            <span
              // onKeyDown={handleKeys}
              onClick={handleClose}
              class="bp3-button bp3-minimal"
              tabindex="0"
            >
              <FontAwesomeIcon icon={faXmark} size="lg" />
            </span>
          </span>
        </div>
      )}
      <div class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            // onKeyDown={handleKeys}
            onClick={handleRedo}
            class="bp3-button bp3-minimal"
            tabindex="0"
          >
            <FontAwesomeIcon icon={faRotateRight} size="lg" />
          </span>
        </span>
      </div>
    </>
  );
};

export default InstantButtons;
