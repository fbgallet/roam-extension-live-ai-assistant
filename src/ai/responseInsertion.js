import {
  assistantCharacter,
  chatRoles,
  contextInstruction,
  defaultTemplate,
  getInstantAssistantRole,
  defaultModel,
  userContextInstructions,
  openRouterModels,
  ollamaModels,
  isResponseToSplit,
} from "..";
import {
  addContentToBlock,
  createChildBlock,
  createSiblingBlock,
  getParentBlock,
  getTreeByUid,
  insertBlockInCurrentView,
  isExistingBlock,
  updateArrayOfBlocks,
  updateBlock,
} from "../utils/roamAPI";
import {
  hierarchicalResponseFormat,
  instructionsOnJSONResponse,
  instructionsOnOutline,
  introduceStylePrompt,
  stylePrompts,
} from "./prompts";
import { AppToaster } from "../components/VoiceRecorder";
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

export const lastCompletion = {
  prompt: null,
  targetUid: null,
  context: null,
  typeOfCompletion: null,
};

async function aiCompletion({
  instantModel,
  prompt,
  content = "",
  responseFormat,
  targetUid,
  isInConversation,
  withSuggestions,
  selectedUids,
  target,
}) {
  let aiResponse;
  let model = instantModel || defaultModel;

  const llm = modelAccordingToProvider(model);
  if (!llm) return "";

  if (
    llm.provider === "OpenAI" ||
    llm.provider === "openRouter" ||
    llm.provider === "groq"
  ) {
    aiResponse = await openaiCompletion(
      llm.library,
      llm.id,
      prompt,
      content,
      responseFormat,
      targetUid
    );
  } else if (llm.provider === "ollama") {
    aiResponse = await ollamaCompletion(
      llm.id,
      prompt,
      content,
      responseFormat,
      targetUid
    );
  } else {
    aiResponse = await claudeCompletion(
      llm.id,
      prompt,
      content,
      responseFormat,
      targetUid
    );
  }

  if (responseFormat === "json_object") {
    let parsedResponse = JSON.parse(aiResponse);
    if (typeof parsedResponse.response === "string")
      parsedResponse.response = JSON.parse(parsedResponse.response);
    aiResponse = parsedResponse.response;
  }
  if (aiResponse)
    insertInstantButtons({
      model: llm.prefix + llm.id,
      prompt,
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
      target,
    });
  return aiResponse;
}

export const aiCompletionRunner = async ({
  e,
  sourceUid,
  prompt = "",
  instantModel,
  includeUids = false,
  target,
  withSuggestions,
  selectedUids,
  style,
  roamContext,
}) => {
  const withAssistantRole = target === "new" ? true : false;

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
    roamContext
  );
  if (noData) return;

  if (style !== "Normal") {
    let stylePromptText;
    if (BUILTIN_STYLES.includes(style)) stylePromptText = stylePrompts[style];
    else {
      const customStl = customStyles.find((custom) => custom.name === style);
      if (customStl) stylePromptText = customStl.prompt;
    }
    if (stylePromptText)
      completedPrompt += introduceStylePrompt + stylePromptText;
  }
  console.log("completedPrompt:", completedPrompt);

  insertCompletion({
    prompt: completedPrompt,
    targetUid,
    context,
    instantModel,
    typeOfCompletion:
      (target === "replace" || target === "append") &&
      selectionUids &&
      selectionUids.length
        ? "SelectionOutline"
        : "gptCompletion",
    isInConversation,
    withSuggestions,
    withAssistantRole,
    target,
    selectedUids: selectionUids,
  });
};

export const insertCompletion = async ({
  prompt,
  targetUid,
  context,
  typeOfCompletion = "gptCompletion",
  instantModel,
  isRedone,
  isInConversation,
  withAssistantRole = true,
  withSuggestions,
  target,
  selectedUids,
}) => {
  lastCompletion.prompt = prompt;
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
        : chatRoles.assistant
      : "";

  let content;

  let isContextInstructionToInsert = false;
  uidRegex.lastIndex = 0;
  if (uidRegex.test(context)) isContextInstructionToInsert = true;

  if (isRedone || isInConversation) content = context;
  else {
    content =
      assistantCharacter +
      (responseFormat === "text" ? hierarchicalResponseFormat : "") +
      (context && !context.includes(contextInstruction)
        ? (isContextInstructionToInsert ? contextInstruction : "") +
          userContextInstructions +
          "\n\nUSER INPUT (content to rely to or apply the next user prompt to, and refered as 'context', between double angle brackets):\n<< " +
          context +
          " >>"
        : "");
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
  } else {
    if (typeof prompt === "string") {
      // else prompt is already conversation object
      if (isInConversation) {
        prompt = getConversationArray(getParentBlock(targetUid));
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
    content,
    responseFormat,
    targetUid,
    isInConversation,
    withSuggestions,
    selectedUids,
    target,
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
  const splittedResponse = splitParagraphs(content);
  if (
    (!isResponseToSplit || splittedResponse.length === 1) &&
    !hierarchyFlagRegex.test(splittedResponse[0])
  )
    if (forceInChildren)
      await createChildBlock(
        targetUid,
        splittedResponse[0],
        format?.open,
        format?.heading
      );
    else await addContentToBlock(targetUid, splittedResponse[0]);
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
  if (!templateUid && !defaultTemplate) return;
  const tree = getTreeByUid(templateUid || defaultTemplate);
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
