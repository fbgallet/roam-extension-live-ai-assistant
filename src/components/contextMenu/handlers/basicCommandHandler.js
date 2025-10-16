import { aiCompletionRunner } from "../../../ai/responseInsertion";
import {
  createChildBlock,
  getParentBlock,
  hasBlockChildren,
} from "../../../utils/roamAPI";
import { hasTrueBooleanKey } from "../../../utils/dataProcessing";
import { getConversationArray } from "../../../ai/dataExtraction";
import {
  chatRoles,
  getConversationParamsFromHistory,
  getInstantAssistantRole,
} from "../../..";
import InstantButtons from "../../InstantButtons";
import { insertInstantButtons } from "../../../utils/domElts";

/**
 * Handles basic AI completion commands
 */
export const handleBasicCommand = async ({
  command,
  capturedRoamContext,
  capturedHasContext,
  focusedBlockUid,
  focusedBlockContent,
  selectedBlocks,
  selectedTextInBlock,
  additionalPrompt,
  prompt,
  model,
  targetBlock,
  isChildrenTreeToInclude,
  isInConversation,
  conversationStyle,
  style,
  rootUid,
  customContext,
  e,
}) => {
  let includeChildren;
  if (
    command.name === "Main Page content as prompt" ||
    command.name === "Zoom content as prompt"
  ) {
    includeChildren = true;
  }

  // Check if this command should use aiCompletionRunner
  const shouldUseCompletionRunner =
    command.id === 1 ||
    command.id === 10 ||
    command.id === 100 ||
    command.name === "Web search" ||
    command.id === 191 || // Fetch URL
    command.isCompletionOnly ||
    (!rootUid && command.id !== 20 && command.id !== 21) ||
    (rootUid &&
      !command.isIncompatibleWith?.completion &&
      (focusedBlockContent.current === "" ||
        command.isIncompatibleWith?.outline));

  if (shouldUseCompletionRunner) {
    // In this case, use the Live Outline as context for the prompt
    if (
      rootUid &&
      (focusedBlockContent.current === "" ||
        command.isIncompatibleWith?.outline)
    ) {
      capturedRoamContext.block = true;
      capturedRoamContext.blockArgument.push(rootUid);
    }

    console.log("style in handler :>> ", style);
    console.log("command :>> ", command);

    await aiCompletionRunner({
      e,
      sourceUid: focusedBlockUid.current,
      prompt,
      additionalPrompt,
      command:
        command.name.slice(0, 16) === "Image generation"
          ? command.name
          : command.prompt,
      instantModel: model,
      includeUids:
        command.includeUids ||
        targetBlock === "replace" ||
        targetBlock === "append",
      includeChildren:
        includeChildren ||
        (isChildrenTreeToInclude && hasBlockChildren(focusedBlockUid.current)),
      withSuggestions: command.withSuggestions,
      target: targetBlock,
      selectedUids: selectedBlocks.current,
      selectedText: selectedTextInBlock.current,
      style:
        command.isIncompatibleWith?.style ||
        command.isIncompatibleWith?.specificStyle?.includes(style)
          ? "Normal"
          : conversationStyle || style,
      roamContext: customContext
        ? customContext
        : hasTrueBooleanKey(capturedRoamContext)
        ? capturedRoamContext
        : null,
      forceNotInConversation: isInConversation && command.id === 1,
    });

    return true; // Indicates command was handled
  }

  return false; // Indicates command was not handled by this handler
};
