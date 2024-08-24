import {
  faStop,
  faCopy,
  faComments,
  // faReply,
  faRotateRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ContextMenu, Tooltip } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import { insertCompletion, lastCompletion } from "../ai/aiCommands.js";
import ModelsMenu from "./ModelsMenu.jsx";
import {
  createChildBlock,
  focusOnBlockInMainWindow,
  getFlattenedContentFromTree,
  getParentBlock,
} from "../utils/utils.js";
import { chatRoles, getInstantAssistantRole } from "../index.js";
import { insertInstantButtons } from "../utils/domElts.js";

export let isCanceledStreamGlobal = false;

const InstantButtons = ({
  model,
  prompt,
  content,
  responseFormat,
  targetUid,
  isStreamStopped,
  response,
  isUserResponse,
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

  const handleConversation = async () => {
    const parentUid = getParentBlock(targetUid);
    const nextBlock = await createChildBlock(
      parentUid,
      getInstantAssistantRole(model)
    );
    const userPrompt = getFlattenedContentFromTree(targetUid, 99, null);
    insertCompletion({
      prompt: prompt.concat({ role: "user", content: userPrompt }),
      targetUid: nextBlock,
      context: content,
      typeOfCompletion: "gptCompletion",
      instantModel: model,
      isInConversation: true,
    });
    setIsToUnmount(true);
  };

  const handleClose = () => {
    setIsToUnmount(true);
  };

  if (isToUnmount) return null;

  return isUserResponse ? (
    <>
      <div class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            // onKeyDown={handleKeys}
            onClick={async () => {
              await handleConversation();
            }}
            class="bp3-button bp3-minimal"
            tabindex="0"
          >
            <Tooltip content="Continue the conversation" hoverOpenDelay="500">
              <FontAwesomeIcon icon={faComments} size="sm" />
            </Tooltip>
          </span>
        </span>
      </div>
    </>
  ) : (
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
            onClick={async () => {
              const parentUid = getParentBlock(targetUid);
              const nextBlock = await createChildBlock(
                parentUid,
                chatRoles.user
              );
              setTimeout(() => {
                setIsToUnmount(true);
                insertInstantButtons({
                  prompt: prompt.concat({
                    role: "assistant",
                    content: response,
                  }),
                  model,
                  targetUid: nextBlock,
                  isUserResponse: true,
                  content,
                });
              }, 100);
              setTimeout(() => {
                focusOnBlockInMainWindow(nextBlock);
              }, 250);
            }}
            class="bp3-button bp3-minimal"
            tabindex="0"
          >
            <Tooltip content="Continue the conversation" hoverOpenDelay="500">
              <FontAwesomeIcon icon={faComments} size="sm" />
            </Tooltip>
          </span>
        </span>
      </div>
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
