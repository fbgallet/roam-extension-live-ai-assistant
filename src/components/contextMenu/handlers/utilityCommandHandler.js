import { completionCommands } from "../../../ai/prompts";
import {
  getCustomPromptByUid,
  getUnionContext,
  addToConversationHistory,
  getConversationParamsFromHistory,
} from "../../../ai/dataExtraction";
import { getParentBlock } from "../../../utils/roamAPI";
import { languages } from "../../../ai/languagesSupport";
import { extensionStorage } from "../../..";
import { textToSpeech } from "../../../ai/multimodalAI";

/**
 * Handles utility commands like text-to-speech, translations, custom prompts, conversations
 */
export const handleUtilityCommand = async ({
  command,
  getInstantPrompt,
  additionalPrompt,
  capturedRoamContext,
  setDefaultLgg,
  setRoamContext,
  defaultLgg,
  customLgg,
  selectedBlocks,
  lastBuiltinCommand,
  focusedBlockUid,
  commands,
  model,
}) => {
  // Text to Speech
  if (command.name === "Text to Speech") {
    textToSpeech(getInstantPrompt(command, false), additionalPrompt);
    return { handled: true };
  }

  // Query Agents
  if (command.category === "QUERY AGENTS") {
    if (command.callback) {
      command.callback({
        model,
        target: "new", // Default target for query agents
        rootUid: focusedBlockUid.current,
        targetUid: focusedBlockUid.current,
        prompt: getInstantPrompt(command),
        retryInstruction: additionalPrompt,
      });
      return { handled: true };
    }
  }

  // Custom Prompts
  if (command.category === "CUSTOM PROMPTS") {
    const customCommand = getCustomPromptByUid(command.prompt);
    const prompt = customCommand.prompt;
    let customContext = null;

    if (customCommand.context) {
      customContext = getUnionContext(
        capturedRoamContext,
        customCommand.context
      );
    }

    return {
      handled: false,
      prompt,
      customContext,
    };
  }

  // Translation commands
  if (
    (command.id === 11 || Math.floor(command.id / 100) === 11) &&
    command.id !== 19
  ) {
    const selectedLgg =
      command.id === 11
        ? defaultLgg
        : command.id === 1199
        ? customLgg
        : command.name;

    if (defaultLgg !== selectedLgg) {
      setDefaultLgg(selectedLgg);
      extensionStorage.set("translationDefaultLgg", selectedLgg);
    }

    let prompt = command.prompt ? completionCommands[command.prompt] : "";
    prompt = prompt.replace("<language>", selectedLgg);

    return { handled: false, prompt };
  }

  // Direct prompt commands
  if (command.id === 19) {
    return { handled: false, prompt: command.prompt };
  }

  // Continue conversation
  if (command.name === "Continue the conversation") {
    const parentUid = getParentBlock(focusedBlockUid.current);
    let convParams = getConversationParamsFromHistory(parentUid);
    let conversationStyle = null;

    if (!convParams) {
      convParams = { uid: parentUid };
      if (selectedBlocks.current)
        convParams.selectedUids = selectedBlocks.current;
      if (lastBuiltinCommand.current) {
        convParams.command = lastBuiltinCommand.current.command;
        convParams.context = lastBuiltinCommand.current.context;
        convParams.style = lastBuiltinCommand.current.style;
      }
      await addToConversationHistory(convParams);
    } else {
      conversationStyle = convParams?.style;
      convParams?.context && setRoamContext(convParams?.context);
    }

    return { handled: false, conversationStyle };
  }

  // AI Model selection
  if (command.category === "AI MODEL") {
    const newModel = command.model;
    let newCommand;

    // Determine which command to use based on context
    if (command.isOutlinerAgent && command.rootUid) {
      newCommand = commands.find((c) => c.id === 21);
    } else if (command.isInConversation) {
      newCommand = commands.find((c) => c.id === 10);
    } else {
      newCommand = commands.find((c) => c.id === 1);
    }

    if (newModel.includes("-search")) {
      newCommand.includeUids = false;
    }

    return {
      handled: false,
      command: newCommand,
      model: newModel,
    };
  }

  // Default prompt processing for other commands
  if (!command.prompt && command.category !== "CUSTOM PROMPTS") {
    let prompt = command.prompt
      ? completionCommands[command.prompt]
      : command.id !== 19
      ? ""
      : command.prompt;

    if (command.customPrompt) {
      prompt = prompt.replace("<target content>", command.customPrompt);
    }

    return { handled: false, prompt };
  }

  return { handled: false };
};
