import {
  faStop,
  faCheck,
  faCopy,
  faComments,
  // faReply,
  faClockRotateLeft,
  faRepeat,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, ContextMenu, Icon, Tooltip } from "@blueprintjs/core";
import { useEffect, useState } from "react";
import {
  aiCompletionRunner,
  insertCompletion,
  lastCompletion,
} from "../ai/responseInsertion.js";
import ModelsMenu from "./ModelsMenu.jsx";
import {
  createChildBlock,
  focusOnBlockInMainWindow,
  getParentBlock,
} from "../utils/roamAPI.js";
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
import { completionCommands } from "../ai/prompts.js";
import { getFlattenedContentFromTree } from "../ai/dataExtraction.js";
import {
  invokeAskAgent,
  invokeSearchAgent,
} from "../ai/agents/search-agent.tsx";

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
  withSuggestions,
  target,
  selectedUids,
  historyCommand,
}) => {
  const [isCanceledStream, setIsCanceledStream] = useState(false);
  const [isToUnmount, setIsToUnmount] = useState(false);

  console.log("historyCommand in InstantButtons :>> ", historyCommand);

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
    console.log("historyCommand :>> ", historyCommand);
    invokeOutlinerAgent({
      rootUid: targetUid,
      treeSnapshot,
      historyCommand,
    });
  };

  const handleRedo = ({ e, model = model, options = {} }) => {
    isCanceledStreamGlobal = true;
    !aiCallback
      ? isOutlinerAgent
        ? invokeOutlinerAgent({
            e,
            prompt,
            rootUid: targetUid,
            treeSnapshot,
            retry: true,
          })
        : insertCompletion({
            prompt,
            targetUid,
            context: content,
            typeOfCompletion:
              responseFormat === "text" ? "gptCompletion" : "SelectionOutline",
            instantModel: model,
            isRedone: true,
            withSuggestions,
            target,
            selectedUids,
          })
      : aiCallback({
          model: model,
          prompt,
          currentUid,
          targetUid,
          previousResponse: response,
          options,
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
      <Button
        onClick={async () => {
          await handleConversation();
        }}
      >
        <Tooltip content="Continue the conversation" hoverOpenDelay="500">
          <FontAwesomeIcon icon={faComments} size="sm" />
        </Tooltip>
      </Button>
    </>
  ) : (
    <>
      {!isCanceledStream && isStreamStopped === false && (
        <Button onClick={handleCancel}>
          <Tooltip content="Stop AI assistant response" hoverOpenDelay="500">
            <FontAwesomeIcon icon={faStop} size="sm" />
          </Tooltip>
        </Button>
      )}
      {(isStreamStopped !== false || isCanceledStream) && (
        <Button onClick={handleClose}>
          <Tooltip
            content={
              isOutlinerAgent ? "Close Outliner Agent" : "Hide these buttons"
            }
            hoverOpenDelay="500"
          >
            <FontAwesomeIcon
              icon={faXmark}
              style={{ color: "red" }}
              size="sm"
            />
          </Tooltip>
        </Button>
      )}
      {withSuggestions && (
        <Button
          onClick={() => {
            aiCompletionRunner({
              sourceUid: selectedUids && selectedUids.length ? null : targetUid,
              prompt: completionCommands["acceptSuggestions"],
              includeUids: true,
              target: "replace",
              selectedUids,
            });
          }}
        >
          <Tooltip content="Accept suggestions" hoverOpenDelay="500">
            <FontAwesomeIcon icon={faCheck} size="sm" />
          </Tooltip>
        </Button>
      )}
      {!isOutlinerAgent && (
        <Button
          onClick={async () => {
            const parentUid = getParentBlock(targetUid);
            const nextBlock = await createChildBlock(parentUid, chatRoles.user);
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
        >
          <Tooltip content="Continue the conversation" hoverOpenDelay="500">
            <FontAwesomeIcon icon={faComments} size="sm" />
          </Tooltip>
        </Button>
      )}
      {isOutlinerAgent && treeSnapshot ? (
        <Button onClick={handleUndo}>
          <Tooltip
            content={
              historyCommand === "undo"
                ? "Undo last outline update"
                : "Redo last outline update"
            }
            hoverOpenDelay="500"
          >
            <FontAwesomeIcon
              icon={faClockRotateLeft}
              size="sm"
              flip={historyCommand === "undo" ? null : "horizontal"}
            />
          </Tooltip>
        </Button>
      ) : null}
      {(aiCallback === invokeSearchAgent || aiCallback === invokeAskAgent) && (
        <Button
          onClick={(e) => {
            aiCallback = invokeAskAgent;
            handleRedo({
              e,
              options: { isPostProcessingNeeded: true, searchLists: content },
            });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({ callback: handleRedo, prompt }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip
            content={
              <p>
                Instructions or question on results
                <br />
                for post-processing by AI
                <br />
                <code>Right Click</code> to choose another AI model
              </p>
            }
            hoverOpenDelay="500"
          >
            <Icon icon="search-template" />
          </Tooltip>
        </Button>
      )}
      {!(isOutlinerAgent && !treeSnapshot) && (
        <Button
          onClick={handleRedo}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({ callback: handleRedo, prompt }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip
            content={
              isOutlinerAgent ? (
                <p>
                  Try again and improve the outline modification
                  <br />
                  Add eventually instructions in focus block
                  <br />
                  <code>Right Click</code> to choose another AI model
                </p>
              ) : (
                <p>
                  Generate a response again
                  <br />
                  <code>Right Click</code> to choose another AI model
                </p>
              )
            }
            hoverOpenDelay="500"
          >
            <FontAwesomeIcon icon={faRepeat} size="sm" />
          </Tooltip>
        </Button>
      )}

      <Button
        onClick={() => {
          if (isOutlinerAgent) {
            response = getFlattenedContentFromTree({
              parentUid: targetUid,
              maxUid: 0,
              withDash: true,
              isParentToIgnore: true,
            });
            console.log("response :>> ", response);
          }
          navigator.clipboard.writeText(response);
        }}
      >
        <Tooltip
          content={
            isOutlinerAgent
              ? "Copy to clipboard"
              : "Copy resolved content to clipboard"
          }
          hoverOpenDelay="500"
        >
          <FontAwesomeIcon icon={faCopy} size="sm" />
        </Tooltip>
      </Button>
    </>
  );
};

export default InstantButtons;
