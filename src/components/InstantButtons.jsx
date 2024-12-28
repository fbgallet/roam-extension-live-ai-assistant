import {
  faStop,
  faCopy,
  faComments,
  // faReply,
  faClockRotateLeft,
  faRepeat,
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
import {
  chatRoles,
  extensionStorage,
  getInstantAssistantRole,
} from "../index.js";
import {
  highlightHtmlElt,
  insertInstantButtons,
  toggleOutlinerSelection,
} from "../utils/domElts.js";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent.ts";

export let isCanceledStreamGlobal = false;

const InstantButtons = ({
  model,
  prompt,
  content,
  responseFormat,
  currentUid,
  targetUid,
  isStreamStopped,
  response,
  isUserResponse,
  aiCallback,
  isOutlinerAgent,
  treeSnapshot,
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

  const handleUndo = (e) => {
    console.log("treeSnapshot :>> ", treeSnapshot);
    invokeOutlinerAgent({ rootUid: targetUid, treeSnapshot });
  };

  const handleRedo = (e, instantModel) => {
    isCanceledStreamGlobal = true;
    !aiCallback
      ? insertCompletion({
          prompt,
          targetUid,
          context: content,
          typeOfCompletion:
            responseFormat === "text" ? "gptCompletion" : "gptPostProcessing",
          instantModel: instantModel || model,
          isRedone: true,
        })
      : aiCallback({
          model: instantModel || model,
          prompt,
          currentUid,
          targetUid,
          previousResponse: response,
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
    if (isOutlinerAgent) {
      extensionStorage.set("outlinerRootUid", null);
      toggleOutlinerSelection(targetUid, false);
    }
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
              <Tooltip
                content={
                  isOutlinerAgent
                    ? "Close Outliner Agent"
                    : "Hide these buttons"
                }
                hoverOpenDelay="500"
              >
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
      {!isOutlinerAgent && (
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
      )}
      {isOutlinerAgent && treeSnapshot ? (
        <div class="bp3-popover-wrapper">
          <span aria-haspopup="true" class="bp3-popover-target">
            <span
              onClick={handleUndo}
              class="bp3-button bp3-minimal"
              tabindex="0"
            >
              <Tooltip content="Undo last outline update" hoverOpenDelay="500">
                <FontAwesomeIcon icon={faClockRotateLeft} size="sm" />
              </Tooltip>
            </span>
          </span>
        </div>
      ) : null}
      {!(isOutlinerAgent && !treeSnapshot) && (
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
                <FontAwesomeIcon icon={faRepeat} size="sm" />
              </Tooltip>
            </span>
          </span>
        </div>
      )}
      {!isOutlinerAgent && (
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
      )}
    </>
  );
};

export default InstantButtons;
