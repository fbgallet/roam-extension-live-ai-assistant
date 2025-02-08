import { ControlGroup } from "@blueprintjs/core";
import {
  chatRoles,
  defaultModel,
  exclusionStrings,
  getInstantAssistantRole,
  isMobileViewContext,
  maxCapturingDepth,
  maxUidDepth,
} from "..";
import { highlightHtmlElt, insertInstantButtons } from "../utils/domElts";
import {
  builtInPromptRegex,
  contextRegex,
  customTagRegex,
  numbersRegex,
  pageRegex,
  sbParamRegex,
  uidRegex,
} from "../utils/regex";
import {
  addContentToBlock,
  createChildBlock,
  createSiblingBlock,
  getBlockContentByUid,
  getBlocksMentioningTitle,
  getBlocksSelectionUids,
  getLastTopLevelOfSeletion,
  getMainPageUid,
  getPageUidByBlockUid,
  getParentBlock,
  getPreviousSiblingBlock,
  getTopOrActiveBlockUid,
  getTreeByUid,
  insertBlockInCurrentView,
  isCurrentPageDNP,
  isLogView,
  resolveReferences,
} from "../utils/roamAPI";
import {
  completionCommands,
  contextAsPrompt,
  instructionsOnTemplateProcessing,
} from "./prompts";
import { faArrowRightArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { BUILTIN_COMMANDS, PREBUILD_COMMANDS } from "./prebuildCommands";

export const getInputDataFromRoamContext = async (
  e,
  sourceUid,
  prompt,
  instantModel,
  includeUids = false,
  withHierarchy,
  withAssistantRole,
  target,
  selectedUids,
  roamContext
) => {
  const isCommandPrompt = prompt ? true : false;
  if (selectedUids?.length) sourceUid = undefined;
  if (!sourceUid && !selectedUids?.length) {
    let { currentUid, selectionUids } = getFocusAndSelection();
    sourceUid = currentUid;
    selectedUids = selectionUids;
  }
  let currentBlockContent;
  if (sourceUid) currentBlockContent = getBlockContentByUid(sourceUid);

  if (!sourceUid && !selectedUids?.length && !e) return { noData: true };

  if (currentBlockContent) {
    if (prompt.toLowerCase().includes("<target content>"))
      prompt = prompt.replace(/<target content>/i, currentBlockContent);
    else prompt += "\n" + currentBlockContent;
  }

  let { completedPrompt, targetUid, remaininSelectionUids, isInConversation } =
    await getFinalPromptAndTarget(
      sourceUid,
      selectedUids,
      prompt,
      instantModel,
      includeUids,
      withHierarchy,
      withAssistantRole,
      isCommandPrompt,
      target
    );

  const roamContextFromKeys = e && (await handleModifierKeys(e));

  const inlineContext = currentBlockContent
    ? getRoamContextFromPrompt(getBlockContentByUid(sourceUid)) // non resolved content
    : null;
  // TO TEST
  if (inlineContext)
    completedPrompt = completedPrompt.replace(
      currentBlockContent,
      inlineContext.updatedPrompt
    );

  const globalContext = {
    linkedRefs:
      roamContext?.linkedRefs ||
      roamContextFromKeys?.linkedRefs ||
      inlineContext?.roamContext?.linkedRefs,
    sidebar:
      roamContext?.sidebar ||
      roamContextFromKeys?.sidebar ||
      inlineContext?.roamContext?.sidebar,
    mainPage:
      roamContext?.mainPage ||
      roamContextFromKeys?.mainPage ||
      inlineContext?.roamContext?.mainPage,
    logPages:
      roamContext?.logPages ||
      roamContextFromKeys?.logPages ||
      inlineContext?.roamContext?.logPages,
  };

  let context = await getAndNormalizeContext({
    blocksSelectionUids: remaininSelectionUids,
    roamContext: globalContext,
    focusedBlock: sourceUid,
    withHierarchy: true,
    withUid: includeUids,
  });

  if (completedPrompt.toLowerCase().includes("<target content>") && context) {
    completedPrompt = completedPrompt.replace(/<target content>/i, context);
  }

  console.log("context :>> ", context);

  return {
    targetUid,
    completedPrompt,
    context,
    isInConversation,
    selectionUids: selectedUids,
  };
};

const getFinalPromptAndTarget = async (
  sourceUid,
  selectionUids,
  prompt,
  instantModel,
  includeUids,
  withHierarchy,
  withAssistantRole,
  isCommandPrompt,
  target
) => {
  const isInConversation =
    sourceUid && !isCommandPrompt ? isPromptInConversation(sourceUid) : false;
  const assistantRole =
    withAssistantRole || isInConversation
      ? instantModel
        ? getInstantAssistantRole(instantModel)
        : chatRoles.assistant
      : "";
  let targetUid;

  if (
    !sourceUid &&
    selectionUids.length
    // &&
    // (document.querySelector(".block-highlight-blue") ||
    //   target === "replace" ||
    //   target === "append")
  ) {
    if (target !== "replace" && target !== "append") {
      const lastTopLevelBlock = getLastTopLevelOfSeletion(selectionUids);
      const topLevelInView =
        await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
      // can't create sibling if top parent block is top block in view
      if (lastTopLevelBlock === topLevelInView)
        targetUid = await createChildBlock(topLevelInView);
      else targetUid = await createSiblingBlock(lastTopLevelBlock);
      await addContentToBlock(targetUid, assistantRole);
    } else {
      targetUid = selectionUids[0];
    }
    const content = getResolvedContentFromBlocks(
      selectionUids,
      includeUids,
      withHierarchy
    );

    if (prompt.toLowerCase().includes("<target content>"))
      prompt = prompt.replace(/<target content>/i, content);
    else prompt += "\n" + content;
    selectionUids = [];
  } else {
    if (target === "replace" || target === "append") {
      targetUid = sourceUid;
    } else {
      targetUid = sourceUid
        ? await createChildBlock(
            isInConversation ? getParentBlock(sourceUid) : sourceUid,
            assistantRole
          )
        : await insertBlockInCurrentView(assistantRole);
    }
    if (!prompt) prompt = contextAsPrompt;
    // prompt = getBlockContentByUid(sourceUid) ? "" : contextAsPrompt;
  }
  return {
    completedPrompt: prompt,
    targetUid,
    isInConversation,
    remaininSelectionUids: selectionUids,
  };
};

export const handleModifierKeys = async (e) => {
  const roamContext = {
    linkedRefs: false,
    sidebar: false,
    mainPage: false,
    logPages: false,
  };
  if (!e) return null;
  if (e.shiftKey) roamContext.sidebar = true;
  if (e.metaKey || e.ctrlKey) {
    if (isLogView() || (await isCurrentPageDNP())) {
      AppToaster.show({
        message:
          "Warning! Using past daily note pages as context can quickly reach maximum token limit if a large number of days if processed. ",
      });
      roamContext.logPages = true;
    } else roamContext.linkedRefs = true;
  }
  if (e.altKey) roamContext.page = true;
  return roamContext;
};

export const isPromptInConversation = (promptUid) => {
  const directParentUid = getParentBlock(promptUid);
  // If current is at top level, it's not in a conversation
  // if (directParentUid === getPageUidByBlockUid(promptUid)) return false;
  const previousSiblingUid = getPreviousSiblingBlock(promptUid);
  const isInConversation =
    previousSiblingUid &&
    chatRoles.genericAssistantRegex &&
    chatRoles.genericAssistantRegex.test(previousSiblingUid.string)
      ? true
      : false;
  if (isInConversation) {
    // const conversationButton = document.querySelector(
    //   ".speech-instant-container:not(:has(.fa-rotage-right)):has(.fa-comments)"
    // );
    // conversationButton && conversationButton.remove();
    insertInstantButtons({ targetUid: promptUid, isToRemove: true });
  }
  return isInConversation;
};

export const getTemplateForPostProcessing = async (
  parentUid,
  depth,
  uidsToExclude,
  withInstructions = true,
  isToHighlight = true
) => {
  let prompt = "";
  let excluded;
  let allBlocks = [];
  let isInMultipleBlocks = true;
  let tree = getTreeByUid(parentUid);
  if (parentUid && tree) {
    if (tree.length && tree[0].children) {
      isToHighlight && highlightHtmlElt({ eltUid: parentUid });
      // prompt is a template as children of the current block
      let { linearArray, excludedUids, allBlocksUids } =
        convertTreeToLinearArray(
          tree[0].children,
          depth,
          99,
          true,
          uidsToExclude.length ? uidsToExclude : "{text}"
        );
      allBlocks = allBlocksUids;
      excluded = excludedUids;
      prompt =
        (withInstructions ? instructionsOnTemplateProcessing : "") +
        linearArray.join("\n");
    } else {
      return null;
    }
  } else return null;
  return {
    stringified: prompt,
    isInMultipleBlocks: isInMultipleBlocks,
    allBlocks,
    excluded,
  };
};

export function getFlattenedContentFromArrayOfBlocks(arrayOfBlocks) {
  let flattenedContent = "";
  if (Array.isArray(arrayOfBlocks) && arrayOfBlocks.length) {
    arrayOfBlocks.forEach(
      (block) => (flattenedContent += block.content + "\n\n")
    );
  } else {
    return typeof arrayOfBlocks === "string" ? arrayOfBlocks : "";
  }
  return flattenedContent.trim();
}

export const getFocusAndSelection = (currentUid) => {
  let currentBlockContent, position;
  const focusedBlock = window.roamAlphaAPI.ui.getFocusedBlock();
  const selectionUids = getBlocksSelectionUids();

  if (focusedBlock) {
    !currentUid && (currentUid = focusedBlock["block-uid"]);
    currentBlockContent = currentUid
      ? resolveReferences(getBlockContentByUid(currentUid))
      : "";
    position = focusedBlock["window-id"].includes("sidebar")
      ? "sidebar"
      : "main";
  } else {
    if (selectionUids.length) {
      let firstSelectionElt =
        document.querySelector(".block-highlight-blue") ||
        document.querySelector(".rm-multiselect-block-overlay");
      if (!firstSelectionElt)
        firstSelectionElt = document.querySelector(
          `.roam-block[id$="${selectionUids[0]}"]`
        );
      let sidebar =
        firstSelectionElt &&
        firstSelectionElt.closest("#roam-right-sidebar-content");
      position = sidebar ? "sidebar" : "main";
    } else position = null;
  }

  return { currentUid, currentBlockContent, selectionUids, position };
};

export const getResolvedContentFromBlocks = (
  blocksUids,
  withUid = false,
  withHierarchy
) => {
  let content = "";
  let parents = [];
  if (blocksUids.length > 0)
    blocksUids.forEach((uid, index) => {
      let directParent = getParentBlock(uid);
      let level = parents.indexOf(directParent);

      if (level === -1) {
        parents.push(directParent);
        level += parents.length;
      }
      let hierarchyShift = withHierarchy ? getNChar(" ", level) + "- " : "";
      let resolvedContent = resolveReferences(getBlockContentByUid(uid));
      content +=
        (index > 0 ? "\n" : "") +
        hierarchyShift +
        (withUid ? `((${uid})) ` : "") +
        resolvedContent;
    });
  return content;
};

const getNChar = (char, nb, factor = 2) => {
  let str = "";
  if (nb <= 0) return str;
  for (let i = 0; i < nb * factor; i++) {
    str += char;
  }
  return str;
};

export function convertTreeToLinearArray(
  tree,
  maxCapturing = 99,
  maxUid = 99,
  withDash = false,
  uidsToExclude = ""
) {
  let linearArray = [];
  let allBlocksUids = [];
  let excludedUids = [];

  function traverseArray(tree, leftShift = "", level = 1) {
    if (tree[0].order) tree = tree.sort((a, b) => a.order - b.order);
    tree.forEach((element) => {
      allBlocksUids.push(element.uid);
      let toExcludeWithChildren = false;
      let content = element.string;
      if (content) {
        let uidString =
          (maxUid && level > maxUid) || !maxUid
            ? ""
            : "((" + element.uid + ")) ";
        toExcludeWithChildren = exclusionStrings.some((str) =>
          content.includes(str)
        );
        let toExcludeAsBlock =
          uidsToExclude.includes(element.uid) ||
          (uidsToExclude === "{text}" && content.includes("{text}"));
        if (toExcludeAsBlock) {
          content = content.replace("{text}", "").trim();
          excludedUids.push(element.uid);
        }
        if (!toExcludeWithChildren /*&& !toExcludeAsBlock*/)
          linearArray.push(
            leftShift +
              (!withDash || level === 1 //&&
                ? //((maxUid && level > maxUid) || !maxUid)
                  ""
                : "- ") +
              (toExcludeAsBlock ? "" : uidString) +
              resolveReferences(content)
          );
      } else level--;
      if (element.children && !toExcludeWithChildren) {
        if (maxCapturing && level >= maxCapturing) return;
        traverseArray(element.children, leftShift + "  ", level + 1);
      }
    });
  }

  traverseArray(tree);

  return { linearArray, allBlocksUids, excludedUids };
}

export const getAndNormalizeContext = async ({
  startBlock = undefined,
  blocksSelectionUids = undefined,
  roamContext,
  focusedBlock = undefined,
  model = defaultModel,
  maxDepth = null,
  maxUid = null,
  uidToExclude,
  withHierarchy = false,
  withUid = true,
}) => {
  let context = "";
  if (blocksSelectionUids && blocksSelectionUids.length > 0)
    context = getResolvedContentFromBlocks(
      blocksSelectionUids,
      maxUid,
      withHierarchy
    );
  // else if (startBlock)
  //   context = resolveReferences(getBlockContentByUid(startBlock));
  else if (isMobileViewContext && window.innerWidth < 500)
    context = getResolvedContentFromBlocks(
      getBlocksSelectionUids(true).slice(0, -1),
      maxUid,
      withHierarchy
    );
  if (roamContext) {
    if (roamContext.block) {
      let blockUids = [];
      if (roamContext.blockArgument?.length) {
        blockUids = roamContext.blockArgument;
      }
      blockUids.forEach(
        (uid) =>
          (context +=
            "\n\n" +
            getFlattenedContentFromTree({
              parentUid: uid,
              maxCapturing: maxDepth || 99,
              maxUid: withUid && 99,
              withDash: withHierarchy,
            }))
      );
    }
    if (roamContext.page) {
      let pageUids = [];
      if (roamContext.pageArgument?.length) {
        pageUids = roamContext.pageArgument.map((title) =>
          getPageUidByPageName(title)
        );
      }
      if (!pageUids.length) {
        highlightHtmlElt({ selector: ".roam-article > div:first-child" });
        pageUids = [
          await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid(),
        ];
      }
      pageUids.forEach(
        (uid) =>
          (context +=
            "\n\n" +
            getFlattenedContentFromTree({
              parentUid: uid,
              maxCapturing: maxDepth || 99,
              maxUid: withUid && 99,
              withDash: withHierarchy,
            }))
      );
    }
    if (roamContext.linkedRefs) {
      let pageUids = [];
      if (roamContext.linkedRefsArgument?.length) {
        pageUids = roamContext.linkedRefs.map((title) =>
          getPageUidByPageName(title)
        );
      }
      if (!pageUids.length) {
        highlightHtmlElt({ selector: ".rm-reference-main" });
        pageUids = [await getMainPageUid()];
      }
      pageUids.forEach(
        (uid) =>
          (context +=
            "\n\n" +
            getFlattenedContentFromLinkedReferences(uid, maxDepth, maxUid))
      );
    }
    if (roamContext.logPages) {
      let startDate;
      if (isLogView()) {
        if (focusedBlock) {
          startDate = new Date(getPageUidByBlockUid(focusedBlock));
        }
        highlightHtmlElt({ selector: ".roam-log-container" });
      } else if (isCurrentPageDNP()) {
        startDate = new Date(await getMainPageUid());
        highlightHtmlElt({ selector: ".rm-title-display" });
      } else {
        startDate = new Date();
      }
      context += getFlattenedContentFromLog(
        roamContext.logPagesArgument || logPagesNbDefault,
        startDate,
        model,
        maxDepth,
        maxUid
      );
    }
    if (roamContext.sidebar) {
      highlightHtmlElt({ selector: "#roam-right-sidebar-content" });
      context += getFlattenedContentFromSidebar(uidToExclude, withUid);
    }
  }

  return context.trim();
};

export const getFlattenedContentFromTree = ({
  parentUid,
  maxCapturing,
  maxUid,
  withDash = false,
  isParentToIgnore = false,
  tree = undefined,
}) => {
  let flattenedBlocks = "";
  if (parentUid || tree) {
    if (!tree) tree = getTreeByUid(parentUid);
    if (tree) {
      let { linearArray } = convertTreeToLinearArray(
        isParentToIgnore ? tree[0].children : tree,
        maxCapturing,
        maxUid,
        withDash
      );
      let content = linearArray.join("\n");
      if (content.length > 1 && content.replace("\n", "").trim())
        flattenedBlocks = "\n" + content;
    }
  }
  return flattenedBlocks.trim();
};

export const getFlattenedContentFromLinkedReferences = (
  pageUid,
  maxDepth,
  maxUid
) => {
  const refTrees = getLinkedReferencesTrees(pageUid);
  const pageName = getPageNameByPageUid(pageUid);
  let linkedRefsArray = [
    `Content from linked references of [[${pageName}]] page:`,
  ];

  console.log("maxCapturingDepth :>> ", maxCapturingDepth);
  console.log("maxUidDepth :>> ", maxUidDepth);

  refTrees.forEach((tree) => {
    let { linearArray } = convertTreeToLinearArray(
      tree,
      maxDepth || maxCapturingDepth.refs,
      maxUid || maxUidDepth.refs
    );
    linkedRefsArray.push(linearArray.join("\n"));
  });
  let flattenedRefsString = linkedRefsArray.join("\n\n");
  console.log("flattenedRefsString :>> ", flattenedRefsString);
  // console.log("length :>> ", flattenedRefsString.length);

  return flattenedRefsString;
};

export function getFlattenedContentFromSidebar(uidToExclude, withUid = true) {
  let sidebarNodes = window.roamAlphaAPI.ui.rightSidebar.getWindows();
  let flattednedBlocks = "\n";
  sidebarNodes.forEach((node, index) => {
    let uid = "";
    if (node.type === "block") uid = node["block-uid"];
    if (node.type === "outline" || node.type === "mentions") {
      uid = node["page-uid"];
      const pageName = getPageNameByPageUid(uid);
      if (node.type === "outline")
        flattednedBlocks += `\nContent of [[${pageName}]] page:\n`;
    }
    if (uid !== "" && uid !== uidToExclude) {
      if (node.type !== "mentions")
        flattednedBlocks += getFlattenedContentFromTree({
          parentUid: uid,
          maxCapturing: maxCapturingDepth.page,
          maxUid: withUid && maxUidDepth.page,
          withDash: true,
        });
      else {
        flattednedBlocks += getFlattenedContentFromLinkedReferences(uid);
      }
      flattednedBlocks += index < sidebarNodes.length - 1 ? "\n\n" : "";
    }
  });
  // console.log("flattedned blocks from Sidebar :>> ", flattednedBlocks);
  return flattednedBlocks;
}

export const getFlattenedContentFromLog = (
  nbOfDays,
  startDate,
  model,
  maxDepth,
  maxUid
) => {
  let processedDays = 0;
  let flattenedBlocks = "";
  let tokens = 0;
  let date = startDate || getYesterdayDate();

  // **** Version using tokenizer from js-tiktoken
  while (
    tokens < tokensLimit[model] &&
    (!nbOfDays || processedDays < nbOfDays)
  ) {
    let dnpUid = window.roamAlphaAPI.util.dateToPageUid(date);
    let dayContent = getFlattenedContentFromTree({
      parentUid: dnpUid,
      maxCapturing: maxDepth || maxCapturingDepth.dnp,
      maxUid: maxUid || maxUidDepth.dnp,
    });
    if (dayContent.length > 0) {
      let dayTitle = window.roamAlphaAPI.util.dateToPageTitle(date);
      flattenedBlocks += `\n${dayTitle}:\n` + dayContent + "\n\n";
      if (flattenedBlocks.length > 24000) {
        tokens = tokenizer
          ? tokenizer.encode(flattenedBlocks).length
          : flattenedBlocks.length * 3;
      }
      if (tokens > tokensLimit[model]) {
        console.log(
          "Context truncated to fit model context window. Tokens:",
          tokens
        );
        AppToaster.show({
          message: `The token limit (${tokensLimit[model]}) has been exceeded (more than ${tokens} needed), only ${processedDays} DNPs have been processed to fit ${model} token window.`,
        });
        flattenedBlocks = flattenedBlocks.slice(
          0,
          -(dayContent.length + dayTitle.length + 4)
        );
      }
    }
    processedDays++;
    date = getYesterdayDate(date);
  }
  // console.log("processedDays :>> ", processedDays);
  // console.log("flattenedBlocks :>> ", flattenedBlocks);
  return flattenedBlocks;
};

const getMatchingInlineCommand = (text, regex) => {
  regex.lastIndex = 0;
  let matches = text.match(regex);
  if (!matches || matches.length < 2) {
    uidRegex.lastIndex = 0;
    if (!uidRegex.test(text)) return null;
    regex.lastIndex = 0;
    let newText = resolveReferences(text, [], true);
    matches = newText.match(regex);
    if (!matches || matches.length < 2) return null;
  }
  return { command: matches[0], options: matches[1] };
};

export const getTemplateFromPrompt = (prompt) => {
  const templateCommand = getMatchingInlineCommand(prompt, templateRegex);
  if (!templateCommand) {
    return null;
  }
  const { command, options } = templateCommand;
  uidRegex.lastIndex = 0;
  let templateUid = uidRegex.test(options.trim())
    ? options.trim().replace("((", "").replace("))", "")
    : null;
  if (!templateUid) {
    AppToaster.show({
      message:
        "Valid syntax for inline template is ((template: ((block-reference)))).",
    });
    return null;
  }
  return {
    templateUid: templateUid,
    updatedPrompt: prompt.replace(command, "").trim(),
  };
};

export const getRoamContextFromPrompt = (prompt, alert = true) => {
  const elts = ["linkedRefs", "sidebar", "page", "block"];
  const roamContext = {};
  let hasContext = false;
  const inlineCommand = getMatchingInlineCommand(prompt, contextRegex);
  if (!inlineCommand) return null;
  let { command, options } = inlineCommand;
  prompt = prompt.replace("ref", "linkedRefs").replace("log", "logPages");
  options = options.replace("ref", "linkedRefs").replace("log", "logPages");
  // console.log("options :>> ", options);
  elts.forEach((elt) => {
    if (options.includes(elt)) {
      roamContext[elt] = true;
      getArgumentFromOption(prompt, options, elt, roamContext);
      hasContext = true;
    }
  });
  if (hasContext)
    return {
      roamContext: roamContext,
      updatedPrompt: prompt.replace(command, "").trim(),
    };
  if (alert)
    AppToaster.show({
      message:
        "Valid options for ((context: )) command: block(uid1+uid2+...), page or page(title1+title2+...), linkedRefs or linkedRefs(title), sidebar, logPages. " +
        "For the last one, you can precise the number of days, eg.: logPages(30)",
      timeout: 0,
    });
  return null;
};

const getArgumentFromOption = (prompt, options, optionName, roamContext) => {
  if (options.includes(`${optionName}(`)) {
    if (optionName === "block")
      prompt = prompt.replaceAll("((", "").replaceAll("))", "");
    console.log("prompt in getArgumentFromOption :>> ", prompt);
    let argument = prompt.split(`${optionName}(`)[1].split(")")[0];
    const args = [];
    const splittedArgument = argument.split("+");
    console.log("splittedArgument :>> ", splittedArgument);
    splittedArgument.forEach((arg) => {
      switch (optionName) {
        case "logPages":
          arg = Number(arg);
          break;
        case "block":
          arg = extractNormalizedUidFromRef(arg);
          break;
        case "linkedRefs":
        case "page":
          arg = normlizePageTitle(arg);
      }
      arg && args.push(arg);
    });
    roamContext[`${optionName}Argument`] = args;
    console.log("args :>> ", args);
    // optionName === "logPages"
    //   ? Number(argument)
    //   :
    //   normlizePageTitle(argument);
    roamContext[`${optionName}`] = true;
  }
};

export const getMaxDephObjectFromList = (list) => {
  let [page, refs, dnp] = getThreeNumbersFromList(list);
  return { page, refs, dnp };
};

export const getThreeNumbersFromList = (list) => {
  const matchingNb = list.match(numbersRegex);
  let arrayOfThreeNumbers = [];
  if (!matchingNb) return [99, 99, 99];
  for (let i = 0; i < 3; i++) {
    arrayOfThreeNumbers.push(
      Number((matchingNb.length > i && matchingNb[i]) || matchingNb[0])
    );
  }
  return arrayOfThreeNumbers;
};

export const getArrayFromList = (list, separator = ",") => {
  const splittedList = list.split(separator).map((elt) => elt.trim());
  if (splittedList.length === 1 && !splittedList[0].trim()) return [];
  return splittedList;
};

export const getConversationArray = (parentUid) => {
  let tree = getTreeByUid(parentUid);
  if (!tree) return null;
  const conversation = tree[0].string
    ? [{ role: "user", content: tree[0].string }]
    : [];
  if (tree[0].children.length) {
    const orderedChildrenTree = tree[0].children.sort(
      (a, b) => a.order - b.order
    );
    for (let i = 0; i < orderedChildrenTree.length - 1; i++) {
      const child = orderedChildrenTree[i];
      let turnFlattenedContent = getFlattenedContentFromTree({
        parentUid: child.uid,
        maxCapturing: 99,
        maxUid: null,
        withDash: true,
      });
      if (chatRoles.genericAssistantRegex.test(getBlockContentByUid(child.uid)))
        conversation.push({ role: "assistant", content: turnFlattenedContent });
      else conversation.push({ role: "user", content: turnFlattenedContent });
    }
  }
  return conversation;
};

export const getContextFromSbCommand = async (
  context = "",
  currentUid,
  selectedUids,
  contextDepth,
  includeRefs,
  model
) => {
  sbParamRegex.lastIndex = 0;
  pageRegex.lastIndex = 0;
  if (context || selectedUids) {
    if (context && sbParamRegex.test(context.trim())) {
      let contextObj;
      context = context.trim().slice(1, -1);
      contextObj = getRoamContextFromPrompt(`((context: ${context}))`, false);
      if (!contextObj) {
        const splittedContext = context.split("+");
        contextObj = {
          roamContext: {
            block: true,
            blockArgument: [],
          },
        };
        splittedContext.forEach((item) => {
          const arg = extractNormalizedUidFromRef(item);
          arg && contextObj.roamContext.blockArgument.push(arg);
        });
      }
      context = await getAndNormalizeContext({
        blocksSelectionUids: selectedUids,
        roamContext: contextObj?.roamContext,
        focusedBlock: currentUid,
        model,
        maxDepth: contextDepth,
        maxUid: includeRefs === "true" ? contextDepth || undefined : undefined,
      });
    } else if (context && pageRegex.test(context.trim())) {
      pageRegex.lastIndex = 0;
      const matchingName = context.trim().match(pageRegex);
      const pageName = matchingName[0].slice(2, -2);
      const pageUid = getPageUidByPageName(pageName);
      context = getFlattenedContentFromTree({
        parentUid: pageUid,
        withDash: true,
      });
      context +=
        "\n\n" +
        getFlattenedContentFromLinkedReferences(
          pageUid,
          contextDepth,
          includeRefs === "true" ? contextDepth || undefined : undefined
        );
    } else {
      const contextUid = extractNormalizedUidFromRef(context.trim());
      if (contextUid) {
        context = getFlattenedContentFromTree({
          parentUid: contextUid,
          maxCapturing: 99,
          maxUid: includeRefs === "true" ? contextDepth || undefined : 0,
          withDash: true, // always insert a dash at the beginning of a line to mimick block structure
        });
      } else context = resolveReferences(context);
      if (selectedUids && selectedUids.length > 0)
        context +=
          (context ? "\n\n" : "") +
          getResolvedContentFromBlocks(
            selectedUids,
            includeRefs === "true" ? true : false
          );
    }
  }
  return context;
};

export const getCustomPromptByUid = (uid) => {
  let prompt =
    getFlattenedContentFromTree({
      parentUid: uid,
      maxCapturing: 99,
      maxUid: 0,
      withDash: true,
      isParentToIgnore: true,
    }) + "\n";
  if (prompt.toLowerCase().includes("<built-in:")) {
    let matchingPrompt = prompt.match(builtInPromptRegex);
    if (matchingPrompt) {
      const builtInName = matchingPrompt[1].trim().toLowerCase();
      let secondParam;
      if (matchingPrompt.length > 2) secondParam = matchingPrompt[2];
      const builtInCommand = BUILTIN_COMMANDS.find(
        (cmd) =>
          cmd.name.toLowerCase() === builtInName ||
          cmd.prompt?.toLowerCase() === builtInName
      );
      if (builtInCommand) {
        prompt = prompt.replace(
          matchingPrompt[0],
          completionCommands[builtInCommand.prompt]
        );
        if (builtInCommand === "translate" && secondParam)
          prompt = prompt.replace("<language>", secondParam);
      }
    }
  }
  return prompt;
};

export const getOrderedCustomPromptBlocks = (tag) => {
  let blocks = getBlocksMentioningTitle(tag);
  let ordered =
    blocks &&
    blocks
      .map((cmd) => {
        return {
          uid: cmd.uid,
          content: cmd.content
            .replace(customTagRegex[tag], "")
            .trim()
            .split(" ")
            .slice(0, tag.includes("style") ? 4 : 6)
            .join(" "),
        };
      })
      .sort((a, b) =>
        a.content?.localeCompare(b.content, undefined, {
          sensitivity: "base",
          ignorePunctuation: true,
        })
      );
  return ordered || [];
};
