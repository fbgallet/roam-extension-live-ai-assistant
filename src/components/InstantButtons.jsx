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
  aiCompletion,
  aiCompletionRunner,
  insertCompletion,
  lastCompletion,
} from "../ai/responseInsertion.js";
import ModelsMenu from "./ModelsMenu.jsx";
import {
  createChildBlock,
  focusOnBlockInMainWindow,
  getBlockContentByUid,
  getParentBlock,
  updateBlock,
} from "../utils/roamAPI.js";
import {
  addToConversationHistory,
  chatRoles,
  extensionStorage,
  getInstantAssistantRole,
} from "../index.js";
import {
  displaySpinner,
  highlightHtmlElt,
  insertInstantButtons,
  removeSpinner,
  simulateClick,
  toggleOutlinerSelection,
} from "../utils/domElts.js";
import {
  completionCommands,
  llmConversationSystemPrompt,
  suggestionsPrompt,
} from "../ai/prompts.js";
import {
  getFlattenedContentFromTree,
  getFocusAndSelection,
} from "../ai/dataExtraction.js";
import {
  invokeAskAgent,
  invokeSearchAgent,
} from "../ai/agents/search-agent/invoke-search-agent.ts";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent/invoke-outliner-agent";

export let isCanceledStreamGlobal = false;

const InstantButtons = ({
  model,
  prompt,
  command,
  style,
  systemPrompt,
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
  roamContext,
  historyCommand,
  agentData,
}) => {
  const [isCanceledStream, setIsCanceledStream] = useState(false);
  const [isToUnmount, setIsToUnmount] = useState(false);

  // console.log("historyCommand in InstantButtons :>> ", historyCommand);

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
    // console.log("historyCommand :>> ", historyCommand);
    invokeOutlinerAgent({
      rootUid: targetUid,
      treeSnapshot,
      historyCommand,
    });
  };

  const handleRedo = ({ e, model = model, options = {} }) => {
    isCanceledStreamGlobal = true;
    const { currentBlockContent } = getFocusAndSelection();
    let retryInstruction = currentBlockContent || "";
    const isToRedoBetter = e.altKey ? true : false;
    if (isToRedoBetter && !aiCallback) {
      prompt.push({
        role: "assistant",
        content: response,
      });
    }

    !aiCallback
      ? isOutlinerAgent
        ? invokeOutlinerAgent({
            e,
            prompt,
            rootUid: targetUid,
            treeSnapshot,
            retry: true,
            retryInstruction,
          })
        : insertCompletion({
            prompt,
            style,
            systemPrompt,
            targetUid,
            typeOfCompletion:
              responseFormat === "text" ? "gptCompletion" : "SelectionOutline",
            instantModel: model,
            isRedone: true,
            isToRedoBetter,
            withSuggestions,
            target,
            selectedUids,
            retryInstruction,
          })
      : aiCallback({
          model: model,
          prompt,
          style,
          rootUid: currentUid,
          currentUid,
          targetUid,
          previousResponse: response,
          options: {
            retryInstruction,
          },
        });
    setIsToUnmount(true);
  };

  const handleConversation = async ({
    e,
    model = model,
    isConversationToContinue,
  }) => {
    console.log("🔄 handleConversation called", {
      aiCallback: !!aiCallback,
      agentData: !!agentData,
      isConversationToContinue,
    });
    console.log("targetUid :>> ", targetUid);
    const userPrompt = getBlockContentByUid(targetUid) || "";
    console.log("userPrompt :>> ", userPrompt);
    // Check if this is an agent callback (like MCP agent)
    if (aiCallback && agentData) {
      console.log("🎯 Using agent callback path");

      console.log("🔍 Debug info:", {
        targetUid,
        userPrompt,
        toolResultsCache: agentData?.toolResultsCache,
      });
      console.log(
        "📊 Cache keys:",
        Object.keys(agentData?.toolResultsCache || {})
      );

      if (userPrompt) {
        console.log("✅ Calling agent with:", {
          serverId: agentData.serverId,
          serverName: agentData.serverName,
          preferredToolName: agentData.preferredToolName,
          rootUid: targetUid,
          prompt: userPrompt,
        });

        aiCallback({
          model: model,
          prompt: userPrompt,
          style,
          rootUid: targetUid,
          targetUid: undefined, // Let agent create new block
          target: "new",
          serverId: agentData.serverId,
          serverName: agentData.serverName,
          preferredToolName: agentData.preferredToolName,
          agentData: agentData, // Pass conversation state
        });
      } else {
        console.log("❌ No user prompt found in block", targetUid);
      }
    } else if (isConversationToContinue) {
      // prompt.push({ role: "user", content: response });
      prompt.push({ role: "user", content: userPrompt });
      console.log("conversation prompts :>> ", prompt);
      insertCompletion({
        targetUid: await createChildBlock(
          getParentBlock(targetUid),
          getInstantAssistantRole(model)
        ),
        systemPrompt: llmConversationSystemPrompt,
        prompt,
        roamContext,
        style,
        isInConversation: true,
        target: "new",
      });
    } else {
      aiCompletionRunner({
        sourceUid: targetUid,
        instantModel: model,
        style,
        roamContext,
      });
    }
    setIsToUnmount(true);
  };

  const handleInsertConversationButtons = async (props) => {
    const parentUid = getParentBlock(targetUid);
    let userTurnContent = chatRoles.user || "";
    prompt.push({ role: "assistant", content: suggestionsPrompt });
    const isSuggestionToInsert = props.e.altKey;
    const nextBlock = await createChildBlock(parentUid, userTurnContent);
    const conversationParams = { uid: parentUid };
    // console.log("selectedUids :>> ", selectedUids);
    if (selectedUids) conversationParams.selectedUids = selectedUids;
    if (command) conversationParams.command = command;
    if (roamContext) conversationParams.context = roamContext;
    await addToConversationHistory(conversationParams);
    // console.log(extensionStorage.get("conversationHistory"));
    let spinnerId;
    setTimeout(() => {
      setIsToUnmount(true);
      insertInstantButtons({ ...props, targetUid: nextBlock });
      if (isSuggestionToInsert) spinnerId = displaySpinner(nextBlock);
    }, 100);
    if (isSuggestionToInsert) {
      let aiSuggestions = await aiCompletion({
        targetUid: nextBlock,
        instantModel: props.model,
        systemPrompt: props.systemPrompt,
        prompt,
        style: props.style,
        isButtonToInsert: false,
      });
      userTurnContent += aiSuggestions.trim();
      if (isSuggestionToInsert) removeSpinner(spinnerId);
      await updateBlock({ blockUid: nextBlock, newContent: userTurnContent });
    }
    setTimeout(() => {
      if (!isSuggestionToInsert) focusOnBlockInMainWindow(nextBlock);
      else {
        const nextBlockElt = document.querySelector(`[id*="${nextBlock}"]`);
        if (nextBlock) {
          const optionElt = nextBlockElt.querySelector(".rm-option");
          if (optionElt) simulateClick(optionElt);
        }
      }
    }, 250);
  };

  const handleQuestionAgentResults = ({ model = model }) => {
    let currentUidBackup = currentUid;
    currentUid = null;
    let { currentUid, currentBlockContent } = getFocusAndSelection();
    let question = "";
    if (currentUid) question = currentBlockContent;
    else {
      const props = {
        model,
        isUserResponse: true,
        content,
        agentData,
        aiCallback: invokeAskAgent,
      };
      handleInsertConversationButtons(props);
      return;
    }
    invokeAskAgent({
      model,
      rootUid: currentUidBackup,
      target,
      prompt: question,
      previousAgentState: agentData,
      options: { isPostProcessingNeeded: true },
    });
  };

  const handleNextResults = () => {
    invokeSearchAgent({
      model,
      rootUid: currentUid,
      target,
      previousAgentState: agentData,
    });
  };

  const handleClose = () => {
    setIsToUnmount(true);
    if (isOutlinerAgent) {
      extensionStorage.set("outlinerRootUid", null);
      toggleOutlinerSelection(targetUid, false);
    }
  };

  const questionAgentResultsButton = () => {
    return (
      <Button
        onClick={handleQuestionAgentResults}
        onContextMenu={(e) => {
          e.preventDefault();
          ContextMenu.show(
            ModelsMenu({ callback: handleQuestionAgentResults }),
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
    );
  };

  if (isToUnmount) return null;

  return isUserResponse ? (
    aiCallback === invokeSearchAgent || aiCallback === invokeAskAgent ? (
      questionAgentResultsButton()
    ) : (
      <>
        <Button
          onClick={async (e) => {
            await handleConversation({ e, model });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({
                callback: handleConversation,
              }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip content="Continue the conversation" hoverOpenDelay="500">
            <FontAwesomeIcon icon={faComments} size="sm" />
          </Tooltip>
        </Button>
      </>
    )
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
      {!isOutlinerAgent && aiCallback !== invokeSearchAgent && (
        <Button
          onClick={(e) => {
            const props = {
              e,
              systemPrompt,
              command,
              style,
              model,
              isUserResponse: true,
              content,
              roamContext,
              aiCallback,
              agentData,
            };
            handleInsertConversationButtons(props);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({
                callback: handleConversation,
                isConversationToContinue: true,
              }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip
            content={
              <p>
                Continue the conversation
                <br />
                Click + <code>Alt</code> to insert suggestions
              </p>
            }
            hoverOpenDelay="500"
          >
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
      {aiCallback === invokeSearchAgent &&
        (agentData?.shiftDisplay || agentData?.isRandom) && (
          <Button
            onClick={handleNextResults}
            onContextMenu={(e) => {
              e.preventDefault();
              ContextMenu.show(
                ModelsMenu({ callback: handleNextResults, prompt }),
                { left: e.clientX, top: e.clientY },
                null
              );
            }}
          >
            <Tooltip
              content={
                agentData.isRandom
                  ? `Display ${
                      agentData.nbOfResults > 1
                        ? agentData.nbOfResults + " other"
                        : "another"
                    } random result(s)`
                  : `Display next results (${agentData.shiftDisplay + 1} to ${
                      agentData.shiftDisplay + (agentData.nbOfResults || 10)
                    } / ${agentData.filteredBlocks.length})`
              }
              hoverOpenDelay="500"
            >
              <Icon icon="zoom-in" />
            </Tooltip>
          </Button>
        )}
      {(aiCallback === invokeSearchAgent || aiCallback === invokeAskAgent) &&
        questionAgentResultsButton()}
      {!(isOutlinerAgent && !treeSnapshot) && (
        <Button
          onClick={(e) => handleRedo({ e })}
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
                  <br />
                  Click + <code>Alt</code> to ask for a better response
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
