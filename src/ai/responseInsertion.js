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
  retryPrompt,
  roamBasicsFormat,
  roamKanbanFormat,
  roamTableFormat,
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
  modelAccordingToProvider,
  ollamaCompletion,
  openaiCompletion,
  verifyTokenLimitAndTruncate,
} from "./aiAPIsHub";
import {
  getConversationArray,
  getFlattenedContentFromArrayOfBlocks,
  getInputDataFromRoamContext,
} from "./dataExtraction";
import { uidRegex } from "../utils/regex";
import { BUILTIN_STYLES, customStyles } from "../components/ContextMenu";
import { AppToaster } from "../components/Toaster";

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
}) {
  let aiResponse;
  let model = instantModel || defaultModel;

  const llm = modelAccordingToProvider(model);
  if (!llm) return "";
  if (!llm.library || (llm.provider !== "ollama" && !llm.library?.apiKey)) {
    AppToaster.show({
      message: `Provide an API key to use ${llm.name} model. See doc and settings.`,
      timeout: 15000,
    });
    return "";
  }

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
    systemPrompt,
    prompt,
    content,
    responseFormat,
    targetUid,
    isButtonToInsert,
  };

  if (
    llm.provider === "OpenAI" ||
    llm.provider === "openRouter" ||
    llm.provider === "groq" ||
    llm.provider === "DeepSeek" ||
    llm.provider === "Grok" ||
    llm.provider === "Google"
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
  command = undefined,
  systemPrompt = "",
  instantModel = undefined,
  includeUids = false,
  target = "new",
  withSuggestions = false,
  selectedUids = [],
  selectedText = undefined,
  style = defaultStyle,
  roamContext = undefined,
  isButtonToInsert = true,
  forceNotInConversation = false,
}) => {
  const withAssistantRole = target === "new" ? true : false;

  // console.log("prompt in aiCompletionRunner :>> ", prompt);

  if (style !== "Normal") {
    let stylePromptText;
    if (BUILTIN_STYLES.includes(style)) stylePromptText = stylePrompts[style];
    else {
      const customStl = customStyles.find((custom) => custom.name === style);
      if (customStl) stylePromptText = customStl.prompt;
    }
    if (stylePromptText) systemPrompt = introduceStylePrompt + stylePromptText;
  }
  if (!systemPrompt) systemPrompt = defaultAssistantCharacter;
  systemPrompt +=
    roamBasicsFormat +
    `\nCurrent date and time are: ${getRelativeDateAndTimeString(sourceUid)}` +
    hierarchicalResponseFormat;

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
    includeUids || target === "replace" || target === "append",
    true, // withHierarchy
    withAssistantRole,
    target,
    selectedUids,
    selectedText,
    roamContext,
    forceNotInConversation
  );
  if (noData) return;

  console.log("systemPrompt :>> ", systemPrompt);
  console.log("completed prompt :>> ", completedPrompt);

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

  let isContextInstructionToInsert = false;
  uidRegex.lastIndex = 0;
  if (uidRegex.test(context)) isContextInstructionToInsert = true;

  if (!systemPrompt) systemPrompt = defaultAssistantCharacter;

  if (!systemPrompt.includes("Current date and time are:"))
    systemPrompt +=
      roamBasicsFormat +
      `\nCurrent date and time are: ${getRelativeDateAndTimeString(targetUid)}`;
  if (
    !systemPrompt.includes(hierarchicalResponseFormat) &&
    responseFormat === "text"
  )
    systemPrompt += hierarchicalResponseFormat;
  if (!isRedone && !isInConversation) {
    //content = context;
    content =
      context && !context.includes(contextInstruction)
        ? (isContextInstructionToInsert ? contextInstruction : "") +
          userContextInstructions +
          "\n\nThe input content to rely to or apply the next user prompt to, and eventually refered as 'context', is inserted below between '<begin>' and '<end>' tags (these tags are not a part of the context):\n<begin>" +
          context +
          "\n<end>"
        : "";
    content = await verifyTokenLimitAndTruncate(model, prompt, content);
  }

  // if (typeOfCompletion === "gptCompletion") {
  if (typeOfCompletion === "SelectionOutline" && !isRedone) {
    prompt = instructionsOnOutline + prompt;
  }

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

  let aiResponse = await aiCompletion({
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
    insertStructuredAIResponse({ targetUid, content: aiResponse, target });
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
