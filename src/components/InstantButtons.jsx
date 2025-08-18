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
  displayAskGraphModeDialog,
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
} from "../ai/agents/search-agent/ask-your-graph-invoke.ts";
import { askYourGraph } from "../ai/agents/search-agent/ask-your-graph.ts";
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
          prompt: Array.isArray(prompt) ? prompt[0]?.content || prompt : prompt,
          style,
          rootUid: currentUid,
          currentUid,
          targetUid,
          previousResponse: isToRedoBetter ? response : undefined,
          serverId: agentData?.serverId,
          serverName: agentData?.serverName,
          preferredToolName: agentData?.preferredToolName,
          agentData: isToRedoBetter
            ? {
                ...agentData,
                // Preserve all conversation state for better retry
                conversationHistory: agentData?.conversationHistory || [],
                conversationSummary: agentData?.conversationSummary,
                toolResultsCache: agentData?.toolResultsCache || {},
              }
            : {
                ...agentData,
                toolResultsCache: {}, // Clear cache for simple retry
                conversationHistory: agentData?.conversationHistory || [],
                conversationSummary: agentData?.conversationSummary,
              },
          options: {
            retryInstruction: isToRedoBetter ? retryInstruction : undefined,
            isRetry: true,
            isToRedoBetter: isToRedoBetter,
          },
        });
    setIsToUnmount(true);
  };

  const handleConversation = async ({
    e,
    model = model,
    isConversationToContinue,
  }) => {
    const userPrompt = getBlockContentByUid(targetUid) || "";
    console.log("🔍 userPrompt in handleConversation:", userPrompt);
    console.log("🔍 targetUid:", targetUid);

    // Check if this is an agent callback (like MCP agent or Search agent)
    if (aiCallback && agentData) {
      if (userPrompt) {
        // Check if this is a search/ask agent callback - use askYourGraph
        if (aiCallback === invokeSearchAgent || aiCallback === invokeAskAgent) {
          callAskYourGraphWithModeHandling({
            model: model,
            prompt: userPrompt,
            rootUid: targetUid,
            targetUid: undefined, // Let agent create new block
            target: "new",
            previousAgentState: {
              ...agentData,
              // Let the agent handle conversation history updates
              conversationHistory: agentData.conversationHistory || [],
              conversationSummary: agentData.conversationSummary,
              toolResultsCache: agentData.toolResultsCache || {},
              previousSearchResults: agentData.previousSearchResults,
              isConversationMode: true,
            },
            bypassDialog: true, // In conversation mode, don't show mode dialog
          });
        } else {
          // For other agents (like MCP), use the original callback
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
            previousAgentState: {
              ...agentData,
              // Let the agent handle conversation history updates
              conversationHistory: agentData.conversationHistory || [],
              conversationSummary: agentData.conversationSummary,
              toolResultsCache: agentData.toolResultsCache || {},
              previousSearchResults: agentData.previousSearchResults,
              isConversationMode: true,
            },
          });
        }
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
      insertInstantButtons({
        ...props,
        targetUid: nextBlock,
        isUserResponse: true,
        // Remove the old prompt so it doesn't override the new user input
        prompt: undefined,
        // Ensure conversation context is preserved for the new block
        agentData: {
          ...props.agentData,
          conversationHistory: props.agentData?.conversationHistory || [],
          conversationSummary: props.agentData?.conversationSummary,
          previousSearchResults: props.agentData?.previousSearchResults,
          isConversationMode: true,
        },
      });
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
        agentData: {
          ...agentData,
          // Ensure conversation state is preserved when asking questions about results
          conversationHistory: agentData?.conversationHistory || [],
          conversationSummary: agentData?.conversationSummary,
          toolResultsCache: agentData?.toolResultsCache || {},
        },
        aiCallback: (params) => callAskYourGraphWithModeHandling(params),
      };
      handleInsertConversationButtons(props);
      return;
    }
    callAskYourGraphWithModeHandling({
      model,
      rootUid: currentUidBackup,
      target,
      prompt: question,
      previousAgentState: {
        ...agentData,
        // Ensure conversation state is preserved for ask agent
        conversationHistory: agentData?.conversationHistory || [],
        conversationSummary: agentData?.conversationSummary,
        toolResultsCache: agentData?.toolResultsCache || {},
      },
      options: { isPostProcessingNeeded: true },
    });
  };

  const handleNextResults = () => {
    callAskYourGraphWithModeHandling({
      model,
      rootUid: currentUid,
      target,
      prompt: "Continue with next results", // Default prompt for next results
      previousAgentState: {
        ...agentData,
        // Ensure conversation state is preserved for search agent
        conversationHistory: agentData?.conversationHistory || [],
        conversationSummary: agentData?.conversationSummary,
        toolResultsCache: agentData?.toolResultsCache || {},
      },
      bypassDialog: true, // Don't show mode dialog for continuing results
    });
  };

  const handleClose = () => {
    setIsToUnmount(true);
    if (isOutlinerAgent) {
      extensionStorage.set("outlinerRootUid", null);
      toggleOutlinerSelection(targetUid, false);
    }
  };

  // Helper function to call askYourGraph with mode escalation handling
  const callAskYourGraphWithModeHandling = async (params) => {
    console.log("🐛 DEBUG: Calling askYourGraph with params:", params);
    try {
      return await askYourGraph(params);
    } catch (error) {
      console.log("🐛 DEBUG: Caught error:", error.message, error);
      if (error.message === "MODE_ESCALATION_NEEDED") {
        console.log("🐛 DEBUG: MODE_ESCALATION_NEEDED caught, showing dialog");
        console.log("🐛 DEBUG: Error data:", {
          currentMode: error.currentMode,
          suggestedMode: error.suggestedMode,
          userQuery: error.userQuery
        });
        
        // Show mode selection dialog using the display function
        displayAskGraphModeDialog({
          currentMode: error.currentMode,
          suggestedMode: error.suggestedMode,
          userQuery: error.userQuery,
          onModeSelect: async (selectedMode, rememberChoice) => {
            console.log("🐛 DEBUG: Mode selected:", selectedMode, "Remember:", rememberChoice);
            try {
              // Set session mode if user chose to remember
              if (rememberChoice) {
                const { setSessionAskGraphMode } = await import("../ai/agents/search-agent/ask-your-graph.ts");
                setSessionAskGraphMode(selectedMode, true);
              }
              
              // Call askYourGraph again with the selected mode and bypass dialog
              await askYourGraph({
                ...params,
                requestedMode: selectedMode,
                bypassDialog: true
              });
            } catch (retryError) {
              console.error("Error with selected mode:", retryError);
            }
          }
        });
        return null; // Don't proceed, wait for user selection
      }
      throw error; // Re-throw other errors
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

  const handleExpansionRetry = (expansionType) => {
    const retryPrompts = {
      semantic: "Try similar and related concepts",
      hierarchical: "Search with hierarchical context and relationships", 
      expansion: "Expand search with broader and deeper strategies",
      fuzzy: "Try fuzzy matching and variations"
    };

    callAskYourGraphWithModeHandling({
      model,
      rootUid: currentUid,
      target,
      prompt: retryPrompts[expansionType],
      previousAgentState: {
        ...agentData,
        conversationHistory: agentData?.conversationHistory || [],
        conversationSummary: agentData?.conversationSummary,
        toolResultsCache: agentData?.toolResultsCache || {},
      },
      bypassDialog: true,
    });
  };

  const renderExpansionButtons = () => {
    const expansion = agentData?.expansionState;
    if (!expansion || !expansion.canExpand) return null;

    // Don't show expansion buttons if there were tool errors (only show for 0 successful results)
    if (expansion.hasErrors && expansion.lastResultCount === 0) return null;

    const buttons = [];

    // "Search Deeper" for few results (0-2 successful results, no errors)
    if (expansion.lastResultCount < 3 && !expansion.hasErrors) {
      buttons.push(
        <Button
          key="search-deeper"
          onClick={() => handleExpansionRetry("expansion")}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({ callback: () => handleExpansionRetry("expansion") }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip content="Search with progressive expansion strategies" hoverOpenDelay="500">
            <Icon icon="zoom-in" />
          </Tooltip>
        </Button>
      );
    }

    // "Try Related Terms" for semantic expansion (low successful results, no errors)
    if (expansion.lastResultCount < 10 && !expansion.hasErrors) {
      buttons.push(
        <Button
          key="try-semantic"
          onClick={() => handleExpansionRetry("semantic")}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({ callback: () => handleExpansionRetry("semantic") }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip content="Search for related concepts and synonyms" hoverOpenDelay="500">
            <Icon icon="graph" />
          </Tooltip>
        </Button>
      );
    }

    // "Search Context" for hierarchical expansion (logical complexity, no errors)
    if (expansion.queryComplexity === "logical" && expansion.searchStrategy !== "hierarchical" && !expansion.hasErrors) {
      buttons.push(
        <Button
          key="search-context"
          onClick={() => handleExpansionRetry("hierarchical")}
          onContextMenu={(e) => {
            e.preventDefault();
            ContextMenu.show(
              ModelsMenu({ callback: () => handleExpansionRetry("hierarchical") }),
              { left: e.clientX, top: e.clientY },
              null
            );
          }}
        >
          <Tooltip content="Search with hierarchical context and relationships" hoverOpenDelay="500">
            <Icon icon="diagram-tree" />
          </Tooltip>
        </Button>
      );
    }

    return buttons;
  };

  if (isToUnmount) return null;

  return isUserResponse ? (
    (aiCallback === invokeSearchAgent || aiCallback === invokeAskAgent) &&
    !agentData?.isConversationMode ? (
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
      {!isOutlinerAgent && (
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
              agentData: {
                ...agentData,
                // Preserve all conversation state when creating conversation buttons
                conversationHistory: agentData?.conversationHistory || [],
                conversationSummary: agentData?.conversationSummary,
                toolResultsCache: agentData?.toolResultsCache || {},
                previousSearchResults: agentData?.previousSearchResults,
                isConversationMode: true,
              },
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
      {/* Smart expansion buttons for search agents */}
      {(aiCallback === invokeSearchAgent || aiCallback === invokeAskAgent) && 
        renderExpansionButtons()}
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
