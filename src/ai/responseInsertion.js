import {
  chatRoles,
  contextInstruction,
  getInstantAssistantRole,
  defaultModel,
  userContextInstructions,
  openRouterModels,
  ollamaModels,
  isResponseToSplit,
  defaultStyle,
  extensionStorage,
  uidsInPrompt,
  isTitleToAdd,
  ANTHROPIC_API_KEY,
} from "..";
import {
  addContentToBlock,
  createChildBlock,
  createSiblingBlock,
  getParentBlock,
  getRelativeDateAndTimeString,
  getTreeByUid,
  insertBlockInCurrentView,
  isExistingBlock,
  updateArrayOfBlocks,
  updateBlock,
} from "../utils/roamAPI";
import {
  defaultAssistantCharacter,
  hierarchicalResponseFormat,
  instructionsOnOutline,
  introduceStylePrompt,
  responseSummary,
  retryPrompt,
  roamBasicsFormat,
  roamKanbanFormat,
  roamTableFormat,
  roamUidsPrompt,
  stylePrompts,
} from "./prompts";
import {
  displaySpinner,
  insertInstantButtons,
  removeSpinner,
  simulateClick,
} from "../utils/domElts";
import {
  hierarchyFlagRegex,
  parseAndCreateBlocks,
  splitParagraphs,
} from "../utils/format";
import {
  claudeCompletion,
  googleCompletion,
  imageGeneration,
  isAPIKeyNeeded,
  modelAccordingToProvider,
  ollamaCompletion,
  openaiCompletion,
} from "./aiAPIsHub";
import {
  concatAdditionalPrompt,
  getConversationArray,
  getFlattenedContentFromArrayOfBlocks,
  getInputDataFromRoamContext,
} from "./dataExtraction";
import { uidRegex } from "../utils/regex";
import { customStyles } from "../components/contextMenu";
import { BUILTIN_STYLES } from "./styleConstants";
import { AppToaster } from "../components/Toaster";
import { hasTrueBooleanKey } from "../utils/dataProcessing";
import { openChatPopup } from "../components/full-results-popup";

export const lastCompletion = {
  prompt: null,
  systemPrompt: null,
  targetUid: null,
  context: null,
  typeOfCompletion: null,
};

export async function aiCompletion({
  instantModel,
  prompt,
  command = "",
  style = "",
  systemPrompt = "",
  content = "",
  responseFormat = "text",
  targetUid = "",
  withSuggestions = false,
  selectedUids = null,
  roamContext = null,
  target = "",
  isButtonToInsert = true,
  includePdfInContext = true,
}) {
  let aiResponse;
  let model = instantModel || defaultModel;

  const llm = modelAccordingToProvider(model);
  if (!llm) return "";
  if (isAPIKeyNeeded(llm)) return "";

  const lastTurn = Array.isArray(prompt) ? prompt.at(-1).content : prompt;

  if (
    lastTurn.toLowerCase().includes("table") ||
    content.includes("{{[[table]]}}")
  ) {
    systemPrompt += "\n" + roamTableFormat;
  }
  if (
    lastTurn.toLowerCase().includes("kanban") ||
    content.includes("{{[[kanban]]}}")
  ) {
    systemPrompt += "\n" + roamKanbanFormat;
  }

  let completionOptions = {
    aiClient: llm.library,
    model: llm.id,
    provider: llm.provider,
    systemPrompt,
    prompt,
    command,
    content,
    responseFormat,
    targetUid,
    isButtonToInsert,
    thinking: llm.thinking,
    includePdfInContext,
  };

  if (llm.provider === "Google") {
    aiResponse = await googleCompletion(completionOptions);
  } else if (
    llm.provider === "OpenAI" ||
    llm.provider === "openRouter" ||
    llm.provider === "groq" ||
    llm.provider === "DeepSeek" ||
    llm.provider === "Grok" ||
    llm.provider === "custom"
  ) {
    aiResponse = await openaiCompletion(completionOptions);
  } else if (llm.provider === "ollama") {
    aiResponse = await ollamaCompletion(completionOptions);
  } else {
    aiResponse = await claudeCompletion(completionOptions);
  }

  if (responseFormat === "json_object") {
    let parsedResponse = JSON.parse(aiResponse);
    if (typeof parsedResponse.response === "string")
      parsedResponse.response = JSON.parse(parsedResponse.response);
    aiResponse = parsedResponse.response;
  }

  if (aiResponse && isButtonToInsert)
    insertInstantButtons({
      model: llm.prefix + llm.id,
      prompt,
      command,
      style,
      systemPrompt,
      content,
      responseFormat,
      targetUid,
      isStreamStopped: true,
      response:
        responseFormat === "text"
          ? aiResponse
          : getFlattenedContentFromArrayOfBlocks(aiResponse),
      withSuggestions,
      selectedUids,
      roamContext,
      target,
    });
  return aiResponse;
}

export const aiCompletionRunner = async ({
  e,
  sourceUid,
  prompt = "",
  additionalPrompt = "",
  command = "",
  systemPrompt = "",
  instantModel = undefined,
  includeUids = false,
  includeChildren = false,
  target = "new",
  withSuggestions = false,
  selectedUids = [],
  selectedText = undefined,
  style = defaultStyle,
  roamContext = undefined,
  isButtonToInsert = true,
  forceNotInConversation = false,
  includePdfInContext = true,
}) => {
  let withAssistantRole = target === "new" ? true : false;

  // console.log("prompt in aiCompletionRunner :>> ", prompt);
  console.log("roamContext in aiCompletionRunner :>> ", roamContext);

  console.log("style :>> ", style);
  systemPrompt = getStylePrompt(style);
  console.log("systemPrompt as style :>> ", systemPrompt);

  if (prompt === "Web search") {
    // console.log("instantModel :>> ", instantModel);
    if (!instantModel) instantModel = extensionStorage.get("webModel");
    command = "Web search";
    prompt = "";
  }

  if (prompt === "Fetch url") {
    if (!ANTHROPIC_API_KEY) {
      AppToaster.show({
        message: `An Anthropic API key is needed for the fetch API feature`,
        timeout: 10000,
      });
      return;
    }
    instantModel = "claude-haiku-4-5-20251001";
    command = "Fetch url";
    prompt = "";
    target = "new w/o";
    withAssistantRole = false;
  }

  // console.log("includeUids from aiCompletionRunner :>> ", includeUids);

  let {
    targetUid,
    completedPrompt,
    context,
    isInConversation,
    noData,
    selectionUids,
  } = await getInputDataFromRoamContext(
    e,
    sourceUid,
    prompt,
    instantModel,
    (includeUids && uidsInPrompt) ||
      target === "replace" ||
      target === "append",
    includeChildren,
    true, // withHierarchy
    withAssistantRole,
    target,
    selectedUids,
    selectedText,
    roamContext,
    forceNotInConversation
  );
  if (noData) return;

  console.log("context :>> ", context);

  if ((sourceUid || selectedText) && !selectedUids?.length && !context)
    includeUids = false;
  if (!systemPrompt) systemPrompt = defaultAssistantCharacter;
  systemPrompt +=
    roamBasicsFormat +
    (uidsInPrompt && includeUids ? roamUidsPrompt : "") +
    `\n\nCurrent date and time are: ${getRelativeDateAndTimeString(
      sourceUid
    )}` +
    hierarchicalResponseFormat;

  if (additionalPrompt && !completedPrompt.includes(additionalPrompt))
    completedPrompt = concatAdditionalPrompt(completedPrompt, additionalPrompt);
  // console.log("systemPrompt :>> ", systemPrompt);
  console.log("completed prompt from aiCompletionRunner :>> ", completedPrompt);

  insertCompletion({
    prompt: completedPrompt,
    systemPrompt,
    targetUid,
    context,
    instantModel,
    command,
    style,
    typeOfCompletion:
      (target === "replace" || target === "append") && selectionUids.length
        ? "SelectionOutline"
        : "gptCompletion",
    isInConversation: forceNotInConversation ? false : isInConversation,
    withSuggestions,
    withAssistantRole,
    target,
    selectedUids: selectionUids,
    roamContext,
    isButtonToInsert,
  });
};

export const insertCompletion = async ({
  prompt,
  systemPrompt = "",
  targetUid,
  context,
  typeOfCompletion = "gptCompletion",
  instantModel,
  command,
  style,
  isRedone,
  isToRedoBetter,
  isInConversation,
  withAssistantRole = true,
  withSuggestions,
  target,
  selectedUids,
  roamContext,
  isButtonToInsert = true,
  retryInstruction,
}) => {
  lastCompletion.prompt = prompt;
  lastCompletion.systemPrompt = systemPrompt;
  lastCompletion.targetUid = targetUid;
  lastCompletion.context = context;
  lastCompletion.typeOfCompletion = typeOfCompletion;
  lastCompletion.instantModel = instantModel;
  lastCompletion.withAssistantRole = withAssistantRole;
  lastCompletion.withSuggestions = withSuggestions;
  lastCompletion.target = target;
  lastCompletion.selectedUids = selectedUids;

  let model = instantModel || defaultModel;

  if (model === "first OpenRouter model") {
    model = openRouterModels.length
      ? "openRouter/" + openRouterModels[0]
      : "gpt-4o-mini";
  } else if (model === "first Ollama local model") {
    model = ollamaModels.length ? "ollama/" + ollamaModels[0] : "gpt-4o-mini";
  }
  const responseFormat =
    typeOfCompletion === "SelectionOutline" ? "json_object" : "text";
  const assistantRole =
    withAssistantRole || isInConversation
      ? instantModel
        ? getInstantAssistantRole(instantModel)
        : chatRoles?.assistant || ""
      : "";

  let content;

  if (!systemPrompt) systemPrompt = defaultAssistantCharacter;

  let isTitleCompatible = false;
  if (
    isTitleToAdd &&
    withAssistantRole &&
    typeOfCompletion === "gptCompletion" &&
    responseFormat === "text"
  ) {
    isTitleCompatible = true;
    if (!systemPrompt.includes(responseSummary))
      systemPrompt += responseSummary;
  }

  if (!systemPrompt.includes("Current date and time are:"))
    systemPrompt += `\nCurrent date and time are: ${getRelativeDateAndTimeString(
      targetUid
    )}`;
  if (!systemPrompt.includes(roamBasicsFormat))
    systemPrompt +=
      roamBasicsFormat +
      (uidsInPrompt && (context || selectedUids?.length) ? roamUidsPrompt : "");
  if (
    !systemPrompt.includes(hierarchicalResponseFormat) &&
    responseFormat === "text"
  )
    systemPrompt += hierarchicalResponseFormat;
  // console.log("systemPrompt :>> ", systemPrompt);
  if (!isRedone && !isInConversation) {
    content =
      context && !context.includes(contextInstruction)
        ? contextInstruction +
          userContextInstructions +
          "\n\nThe input content to rely to or apply the next user prompt to, and eventually refered as 'context', is inserted below between '<begin>' and '<end>' tags (these tags are not a part of the context):\n<begin>" +
          context +
          "\n<end>"
        : "";
    // content = await verifyTokenLimitAndTruncate(model, prompt, content);
  }

  // if (typeOfCompletion === "gptCompletion") {
  if (typeOfCompletion === "SelectionOutline" && !isRedone) {
    prompt = instructionsOnOutline + prompt;
  }

  console.log("SystemPrompt :>> ", systemPrompt);
  console.log("Context :>> ", content);

  if (isRedone) {
    if (
      isExistingBlock(targetUid) &&
      target !== "replace" &&
      target !== "append"
    ) {
      targetUid = await createSiblingBlock(targetUid, "before");
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: targetUid,
          string: assistantRole,
        },
      });
    } else {
      if (target !== "replace" && target !== "append")
        targetUid = await insertBlockInCurrentView(assistantRole);
    }
    if (isToRedoBetter) {
      const initialPrompt = prompt[0].content;
      prompt.push({
        role: "user",
        content:
          retryPrompt +
          (retryInstruction && retryInstruction !== initialPrompt
            ? "\n\nHere is an additional response from the user to guide the improvement or correction of the initial response: " +
              retryInstruction
            : ""),
      });
    }
  } else {
    if (typeof prompt === "string") {
      // else prompt is already conversation object
      if (isInConversation) {
        prompt = await getConversationArray(getParentBlock(targetUid));
      } else {
        prompt = [
          {
            role: "user",
            content: prompt,
          },
        ];
      }
    }
  }
  // }
  const intervalId = await displaySpinner(targetUid);

  // console.log("command.slice(0, 16) :>> ", command.slice(0, 16));

  let aiResponse =
    command?.slice(0, 16) === "Image generation"
      ? await imageGeneration(
          prompt.at(-1).content + (context ? "\n" + context : ""),
          command?.split("(")[1].split(")")[0],
          model
        )
      : await aiCompletion({
          instantModel: model,
          prompt,
          systemPrompt,
          content,
          responseFormat,
          targetUid,
          command,
          style,
          isInConversation,
          withSuggestions,
          selectedUids,
          roamContext,
          target,
          isButtonToInsert,
          includePdfInContext,
        });
  console.log("aiResponse :>> ", aiResponse);

  if (isInConversation)
    aiResponse = aiResponse.replace(assistantRole, "").trim();
  if (typeOfCompletion === "SelectionOutline" && Array.isArray(aiResponse)) {
    updateArrayOfBlocks(aiResponse, target);
  } else {
    if (target === "replace") {
      simulateClick();
      await updateBlock({ blockUid: targetUid, newContent: "" });
    }
    console.log("command :>> ", command);
    insertStructuredAIResponse({
      targetUid,
      content: aiResponse,
      target,
      isTitleCompatible,
    });
  }
  setTimeout(() => {
    removeSpinner(intervalId);
  }, 100);
};

export async function insertStructuredAIResponse({
  targetUid,
  content,
  forceInChildren = false,
  format = undefined,
  target = undefined,
  isTitleCompatible = false,
}) {
  if (Array.isArray(content)) content = content.join("\n\n");
  const splittedResponse = splitParagraphs(content);
  if (
    (!isResponseToSplit || splittedResponse.length === 1) &&
    !hierarchyFlagRegex.test(splittedResponse[0]) &&
    !content.includes("\n")
  )
    if (forceInChildren)
      await createChildBlock(targetUid, content, format?.open, format?.heading);
    else await addContentToBlock(targetUid, content);
  else {
    if (isTitleToAdd && isTitleCompatible) {
      const [firstLine, ...otherLines] = content.split("\n");
      await addContentToBlock(targetUid, firstLine.trim());
      content = otherLines.join("\n").trim();
    }
    await parseAndCreateBlocks(
      targetUid,
      content,
      target === "replace" || target === "new w/o"
    );
  }
}

export const copyTemplate = async (
  targetUid,
  templateUid,
  maxDepth,
  strToExclude = "{text}"
) => {
  let uidsToExclude = [];
  if (!templateUid) return;
  const tree = getTreeByUid(templateUid);
  uidsToExclude = await copyTreeBranches(
    tree,
    targetUid,
    maxDepth,
    strToExclude
  );
  return uidsToExclude;
};

export const copyTreeBranches = async (
  tree,
  targetUid,
  maxDepth,
  strToExclude,
  isClone = true
) => {
  let uidsToExclude = [];
  // copy only the branches, not the parent block
  if (tree[0].string && tree[0].children) {
    uidsToExclude = await insertChildrenBlocksRecursively(
      targetUid,
      tree[0].children,
      strToExclude,
      maxDepth,
      1,
      isClone
    );
  } else return null;
  return uidsToExclude;
};

export async function insertChildrenBlocksRecursively(
  parentUid,
  children,
  strToExclude,
  maxDepth = 99,
  depth = 1,
  isClone
) {
  let uidsToExclude = [];
  for (let i = 0; i < children.length; i++) {
    let uid = await createChildBlock(
      parentUid,
      strToExclude
        ? children[i].string.replace(strToExclude, "").trim()
        : children[i].string,
      children[i].order,
      children[i].open,
      children[i].heading,
      children[i]["view-type"],
      !isClone && children[i].uid
    );
    if (children[i].string.includes(strToExclude)) uidsToExclude.push(uid);
    if (children[i].children && depth < maxDepth) {
      let moreUidsToExclude = await insertChildrenBlocksRecursively(
        uid,
        children[i].children,
        strToExclude,
        maxDepth,
        ++depth,
        isClone
      );
      uidsToExclude = uidsToExclude.concat(moreUidsToExclude);
    }
  }
  return uidsToExclude;
}

export const getStylePrompt = (style) => {
  if (style === "Normal") return;
  let stylePromptText;
  if (BUILTIN_STYLES.includes(style)) stylePromptText = stylePrompts[style];
  else {
    const customStl = customStyles.find((custom) => custom.name === style);
    if (customStl) stylePromptText = customStl.prompt;
  }
  if (stylePromptText)
    stylePromptText = introduceStylePrompt + stylePromptText + "\n";
  return stylePromptText;
};
