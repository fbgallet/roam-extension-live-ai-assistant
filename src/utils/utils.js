// import assert from "node:assert";
import {
  exclusionStrings,
  defaultModel,
  isMobileViewContext,
  logPagesNbDefault,
  maxCapturingDepth,
  maxUidDepth,
  tokensLimit,
  chatRoles,
} from "..";
import { tokenizer } from "../ai/aiCommands";
import { AppToaster } from "../components/VoiceRecorder";

export const uidRegex = /\(\([^\)]{9}\)\)/g;
export const flexibleUidRegex = /\(?\(?([^\)]{9})\)?\)?/;
export const pageRegex = /\[\[.*\]\]/g; // very simplified, not recursive...
export const contextRegex = /\(\(context:.?([^\)]*)\)\)/;
export const templateRegex = /\(\(template:.?(\(\([^\)]{9}\)\))\)\)/;
export const dateStringRegex = /^[0-9]{2}-[0-9]{2}-[0-9]{4}$/;
export const numbersRegex = /\d+/g;
export const roamImageRegex = /!\[[^\]]*\]\((http[^\s)]+)\)/g;
export const sbParam = /\{.*\}/;

export function getTreeByUid(uid) {
  if (uid)
    return window.roamAlphaAPI.q(`[:find (pull ?page
                     [:block/uid :block/string :block/children :block/refs :block/order
                        {:block/children ...} ])
                      :where [?page :block/uid "${uid}"]  ]`)[0];
  else return null;
}

export async function getFirstLevelBlocksInCurrentView() {
  let zoomUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
  if (!zoomUid) return null;
  return getOrderedDirectChildren(zoomUid);
}

function getOrderedDirectChildren(uid) {
  if (!uid) return null;
  let result = window.roamAlphaAPI.q(`[:find (pull ?page
                      [:block/uid :block/string :block/children :block/order
                         {:block/children  ...} ])
                       :where [?page :block/uid "${uid}"] ]`)[0][0];
  if (!result.children) {
    return null;
  }
  return result.children
    .sort((a, b) => a.order - b.order)
    .map((block) => ({
      string: block.string,
      uid: block.uid,
      order: block.order,
    }));
}

export function getBlockContentByUid(uid) {
  let result = window.roamAlphaAPI.pull("[:block/string]", [":block/uid", uid]);
  if (result) return result[":block/string"];
  else return "";
}

export function isExistingBlock(uid) {
  let result = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
  if (result) return true;
  return false;
}

export function getParentBlock(uid) {
  let result = window.roamAlphaAPI.pull(
    "[:block/uid {:block/parents [:block/uid {:block/children [:block/uid]}]}]",
    [":block/uid", uid]
  );
  if (result) {
    const directParent = result[":block/parents"]?.find((parent) =>
      parent[":block/children"]?.some((child) => child[":block/uid"] === uid)
    );
    return directParent[":block/uid"];
  } else return "";
}

export function getPreviousSiblingBlock(currentUid) {
  const parentUid = getParentBlock(currentUid);
  const tree = getOrderedDirectChildren(parentUid);
  const currentBlockOrder = tree.find(
    (block) => block.uid === currentUid
  ).order;
  if (!currentBlockOrder) return null;
  return tree.find((block) => block.order === currentBlockOrder - 1);
}

export function getPageUidByBlockUid(uid) {
  let result = window.roamAlphaAPI.pull("[:block/uid {:block/page ...}]", [
    ":block/uid",
    uid,
  ]);
  if (result) return result[":block/page"][":block/uid"];
  else return "";
}

export async function getMainPageUid() {
  let uid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
  let pageUid = window.roamAlphaAPI.pull("[{:block/page [:block/uid]}]", [
    ":block/uid",
    uid,
  ]);
  if (pageUid === null) return uid;
  return pageUid[":block/page"][":block/uid"];
}

function getPageNameByPageUid(uid) {
  let r = window.roamAlphaAPI.data.pull("[:node/title]", [":block/uid", uid]);
  if (r != null) return r[":node/title"];
  else return "undefined";
}

function getBlockOrderByUid(uid) {
  let result = window.roamAlphaAPI.pull("[:block/order]", [":block/uid", uid]);
  if (result) return result[":block/order"];
  else return "";
}

export function getLinkedReferencesTrees(pageUid) {
  if (!pageUid) return null;
  let result = window.roamAlphaAPI.q(
    `[:find
      (pull ?node [:block/uid :block/string :edit/time :block/children
      {:block/children ...}])
  :where
    [?test-Ref :block/uid "${pageUid}"]
    [?node :block/refs ?test-Ref]
  ]`
  );
  // sorted by edit time from most recent to older
  const reverseTimeSorted = result.sort((a, b) => b[0].time - a[0].time);
  return reverseTimeSorted;
}

export async function createSiblingBlock(currentUid, position) {
  const currentOrder = getBlockOrderByUid(currentUid);
  const parentUid = getParentBlock(currentUid);
  const siblingUid = await createChildBlock(
    parentUid,
    "",
    position === "before" ? currentOrder : currentOrder + 1
  );
  return siblingUid;
}

export async function getTopOrActiveBlockUid() {
  let currentBlockUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  if (currentBlockUid) return currentBlockUid;
  else {
    let uid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
    if (getBlockContentByUid(uid)) return uid;
    return getFirstChildUid(uid);
  }
}

export function getFirstChildUid(uid) {
  let q = `[:find (pull ?c
                       [:block/uid :block/children {:block/children ...}])
                    :where [?c :block/uid "${uid}"]  ]`;
  let result = window.roamAlphaAPI.q(q);
  if (!result.length) return null;
  if (result[0][0].children) return result[0][0].children[0].uid;
  return null;
}

export function focusOnBlockInMainWindow(blockUid) {
  window.roamAlphaAPI.ui.setBlockFocusAndSelection({
    location: {
      "block-uid": blockUid,
      "window-id": "main-window",
    },
  });
}

export function updateArrayOfBlocks(arrayOfBlocks) {
  if (arrayOfBlocks.length) {
    arrayOfBlocks.forEach((block) =>
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: block.uid.replaceAll("(", "").replaceAll(")", "").trim(),
          string: block.content,
        },
      })
    );
  }
}

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

export async function createChildBlock(
  parentUid,
  content = "",
  order = "last",
  open = true,
  heading = 0
) {
  const uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.createBlock({
    location: { "parent-uid": parentUid, order: order },
    block: { string: content, uid: uid, open: open, heading: heading },
  });
  return uid;
}

export async function copyTreeBranches(tree, targetUid, maxDepth, strToRemove) {
  // copy only the branches, not the parent block
  if (tree[0].string && tree[0].children) {
    await insertChildrenBlocksRecursively(
      targetUid,
      tree[0].children,
      strToRemove,
      maxDepth
    );
  } else return null;
}

async function insertChildrenBlocksRecursively(
  parentUid,
  children,
  strToRemove,
  maxDepth = 99,
  depth = 1
) {
  for (let i = 0; i < children.length; i++) {
    let uid = await createChildBlock(
      parentUid,
      strToRemove
        ? children[i].string.replace(strToRemove, "").trim()
        : children[i].string,
      children[i].order
    );
    if (children[i].children && depth < maxDepth)
      insertChildrenBlocksRecursively(
        uid,
        children[i].children,
        strToRemove,
        maxDepth,
        ++depth
      );
  }
}

export async function insertBlockInCurrentView(content, order) {
  let zoomUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
  // If not on a given page, but in Daily Log
  if (!zoomUid) {
    zoomUid = window.roamAlphaAPI.util.dateToPageUid(new Date());
    // TODO : send a message "Added on DNP page"
  }
  const newUid = window.roamAlphaAPI.util.generateUID();
  window.roamAlphaAPI.createBlock({
    location: {
      "parent-uid": zoomUid,
      order: order === "first" || order === 0 ? 0 : "last",
    },
    block: {
      string: content,
      uid: newUid,
    },
  });
  return newUid;
}

export async function addContentToBlock(uid, contentToAdd) {
  const currentContent = getBlockContentByUid(uid).trimEnd();
  // currentContent += currentContent ? " " : "";
  await window.roamAlphaAPI.updateBlock({
    block: {
      uid: uid,
      string: (currentContent ? currentContent + " " : "") + contentToAdd,
    },
  });
}

export const getBlocksSelectionUids = (reverse) => {
  let selectedBlocksUids = [];
  let blueSelection = !reverse
    ? document.querySelectorAll(".block-highlight-blue")
    : document.querySelectorAll(".rm-block-main");
  let checkSelection = roamAlphaAPI.ui.individualMultiselect.getSelectedUids();
  if (blueSelection.length === 0) blueSelection = null;
  if (blueSelection) {
    blueSelection.forEach((node) => {
      let inputBlock = node.querySelector(".rm-block__input");
      if (!inputBlock) return;
      selectedBlocksUids.push(inputBlock.id.slice(-9));
    });
  } else if (checkSelection.length !== 0) {
    selectedBlocksUids = checkSelection;
  }
  return selectedBlocksUids;
};

export const getFocusAndSelection = (currentUid) => {
  !currentUid &&
    (currentUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"]);
  const selectionUids = getBlocksSelectionUids();
  const currentBlockContent = currentUid
    ? resolveReferences(getBlockContentByUid(currentUid))
    : "";
  return { currentUid, currentBlockContent, selectionUids };
};

export const getReferencesCitation = (blockUids) => {
  let citation = "";
  if (blockUids.length > 0) {
    blockUids.forEach(
      (uid, index) =>
        (citation += ` [${index}](((${uid})))${
          index < blockUids.length - 1 ? "," : ""
        }`)
    );
    return "blocks used as context:" + citation;
  }
  return "";
};

export const getResolvedContentFromBlocks = (blocksUids, withUid = false) => {
  let content = "";
  if (blocksUids.length > 0)
    blocksUids.forEach((uid) => {
      let resolvedContent = resolveReferences(getBlockContentByUid(uid));
      content += "\n" + (withUid ? `((${uid})) ` : "") + resolvedContent;
    });
  return content;
};

export const resolveReferences = (content, refsArray = [], once = false) => {
  uidRegex.lastIndex = 0;
  if (uidRegex.test(content)) {
    uidRegex.lastIndex = 0;
    let matches = content.matchAll(uidRegex);
    for (const match of matches) {
      let refUid = match[0].slice(2, -2);
      // prevent infinite loop !
      let isNewRef = !refsArray.includes(refUid);
      refsArray.push(refUid);
      let resolvedRef = getBlockContentByUid(refUid);
      uidRegex.lastIndex = 0;
      if (uidRegex.test(resolvedRef) && isNewRef && !once)
        resolvedRef = resolveReferences(resolvedRef, refsArray);
      content = content.replace(match, resolvedRef);
    }
  }
  return content;
};

export function convertTreeToLinearArray(
  tree,
  maxCapturing = 99,
  maxUid = 99,
  withDash = false,
  instantExclusion
) {
  let linearArray = [];

  // console.log("exclusionStrings :>> ", exclusionStrings);
  instantExclusion && exclusionStrings.concat(instantExclusion);

  function traverseArray(tree, leftShift = "", level = 1) {
    if (tree[0].order) tree = tree.sort((a, b) => a.order - b.order);
    tree.forEach((element) => {
      let toExclude = false;
      if (element.string) {
        let uidString =
          (maxUid && level > maxUid) || !maxUid
            ? ""
            : "((" + element.uid + "))";
        toExclude = exclusionStrings.some((str) =>
          element.string.includes(str)
        );
        if (!toExclude)
          linearArray.push(
            uidString +
              leftShift +
              ((!withDash || level === 1) &&
              ((maxUid && level > maxUid) || !maxUid)
                ? ""
                : "- ") +
              resolveReferences(element.string)
          );
      } else level--;
      if (element.children && !toExclude) {
        if (maxCapturing && level >= maxCapturing) return;
        traverseArray(element.children, leftShift + "  ", level + 1);
      }
    });
  }

  traverseArray(tree);

  return linearArray;
}

export const getAndNormalizeContext = async (
  startBlock,
  blocksSelectionUids,
  roamContext,
  focusedBlock,
  model = defaultModel
) => {
  let context = "";
  if (blocksSelectionUids && blocksSelectionUids.length > 0)
    context = getResolvedContentFromBlocks(blocksSelectionUids);
  // else if (startBlock)
  //   context = resolveReferences(getBlockContentByUid(startBlock));
  else if (isMobileViewContext && window.innerWidth < 500)
    context = getResolvedContentFromBlocks(
      getBlocksSelectionUids(true).slice(0, -1)
    );
  if (roamContext) {
    if (roamContext.mainPage) {
      highlightHtmlElt(".roam-article > div:first-child");
      const viewUid =
        await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
      context += getFlattenedContentFromTree(viewUid);
    }
    if (roamContext.linkedRefs) {
      highlightHtmlElt(".rm-reference-main");
      const pageUid = await getMainPageUid();
      context += getFlattenedContentFromLinkedReferences(pageUid);
    }
    if (roamContext.logPages) {
      let startDate;
      if (isLogView()) {
        if (focusedBlock) {
          startDate = new Date(getPageUidByBlockUid(focusedBlock));
        }
        highlightHtmlElt(".roam-log-container");
      } else if (isCurrentPageDNP()) {
        startDate = new Date(await getMainPageUid());
        highlightHtmlElt(".rm-title-display");
      }
      context += getFlattenedContentFromLog(
        roamContext.logPagesNb || logPagesNbDefault,
        startDate,
        model
      );
    }
    if (roamContext.sidebar) {
      highlightHtmlElt("#roam-right-sidebar-content");
      context += getFlattenedContentFromSidebar();
    }
  }

  return context;
};

export const getFlattenedContentFromTree = (
  parentUid,
  maxCapturing,
  maxUid,
  withDash = false
) => {
  let flattenedBlocks = "";
  if (parentUid) {
    let tree = getTreeByUid(parentUid);
    if (tree) {
      let content = convertTreeToLinearArray(
        tree,
        maxCapturing,
        maxUid,
        withDash
      ).join("\n");
      if (content.length > 1 && content.replace("\n", "").trim())
        flattenedBlocks = "\n" + content;
    }
  }
  return flattenedBlocks.trim();
};

export const getFlattenedContentFromLinkedReferences = (pageUid) => {
  const refTrees = getLinkedReferencesTrees(pageUid);
  const pageName = getPageNameByPageUid(pageUid);
  let linkedRefsArray = [
    `Content from linked references of [[${pageName}]] page:`,
  ];
  refTrees.forEach((tree) =>
    linkedRefsArray.push(
      convertTreeToLinearArray(
        tree,
        maxCapturingDepth.refs,
        maxUidDepth.refs
      ).join("\n")
    )
  );
  let flattenedRefsString = linkedRefsArray.join("\n\n");
  // console.log("flattenedRefsString :>> ", flattenedRefsString);
  // console.log("length :>> ", flattenedRefsString.length);

  return flattenedRefsString;
};

export function getFlattenedContentFromSidebar() {
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
    if (uid !== "") {
      if (node.type !== "mentions")
        flattednedBlocks += getFlattenedContentFromTree(
          uid,
          maxCapturingDepth.page,
          maxUidDepth.page
        );
      else {
        flattednedBlocks += getFlattenedContentFromLinkedReferences(uid);
      }
      flattednedBlocks += index < sidebarNodes.length - 1 ? "\n\n" : "";
    }
  });
  // console.log("flattedned blocks from Sidebar :>> ", flattednedBlocks);
  return flattednedBlocks;
}

export const highlightHtmlElt = (selector, elt) => {
  if (!elt) elt = document.querySelector(selector);
  if (!elt || elt.classList.contains("highlight-elt")) return;
  elt.classList.add("highlight-elt");
  setTimeout(() => {
    elt.classList.remove("highlight-elt");
  }, 6000);
};

export const simulateClick = (elt) => {
  const options = {
    bubbles: true,
    cancelable: true,
    view: window,
    target: elt,
    which: 1,
    button: 0,
  };
  elt.dispatchEvent(new MouseEvent("mousedown", options));
  elt.dispatchEvent(new MouseEvent("mouseup", options));
  elt.dispatchEvent(new MouseEvent("click", options));
};

export const getFlattenedContentFromLog = (nbOfDays, startDate, model) => {
  let processedDays = 0;
  let flattenedBlocks = "";
  let tokens = 0;
  let date = startDate || getYesterdayDate();

  // In the absence of using a tokenizer,
  // a very approximate lower limit would be 3 tokens per character
  // while (
  //   flattenedBlocks.length < tokensLimit[model] * 3 &&
  //   (!nbOfDays || processedDays < nbOfDays)
  // ) {
  //   let dnpUid = window.roamAlphaAPI.util.dateToPageUid(date);
  //   let dayContent = getFlattenedContentFromTree(
  //     dnpUid,
  //     maxCapturingDepth.dnp,
  //     maxUidDepth.dnp
  //   );
  //   if (dayContent.length > 0) {
  //     let dayTitle = window.roamAlphaAPI.util.dateToPageTitle(date);
  //     flattenedBlocks += `\n${dayTitle}:\n` + dayContent + "\n\n";
  //     if (flattenedBlocks.length > tokensLimit[model] * 3) {
  //       flattenedBlocks = flattenedBlocks.slice(
  //         0,
  //         -(dayContent.length + dayTitle.length + 4)
  //       );
  //     }
  //   }
  //   processedDays++;
  //   date = getYesterdayDate(date);
  // }

  // **** Version using tokenizer from js-tiktoken
  while (
    tokens < tokensLimit[model] &&
    (!nbOfDays || processedDays < nbOfDays)
  ) {
    let dnpUid = window.roamAlphaAPI.util.dateToPageUid(date);
    let dayContent = getFlattenedContentFromTree(
      dnpUid,
      maxCapturingDepth.dnp,
      maxUidDepth.dnp
    );
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

export const isLogView = () => {
  if (document.querySelector("#rm-log-container")) return true;
  return false;
};

export const isCurrentPageDNP = async () => {
  const pageUid = await getMainPageUid();
  return dateStringRegex.test(pageUid);
};

const getYesterdayDate = (date = null) => {
  if (!date) date = new Date();
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
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

export const getRoamContextFromPrompt = (prompt) => {
  console.log("prompt :>> ", prompt);
  const elts = ["linkedRefs", "sidebar", "mainPage", "logPages"];
  const roamContext = {};
  let hasContext = false;
  const inlineCommand = getMatchingInlineCommand(prompt, contextRegex);
  if (!inlineCommand) return null;
  let { command, options } = inlineCommand;
  console.log("options :>> ", options);
  options = options
    .replace("ref", "linkedRefs")
    .replace("page", "mainPage")
    .replace("log", "logPages");
  // console.log("options :>> ", options);
  elts.forEach((elt) => {
    if (options.includes(elt)) {
      roamContext[elt] = true;
      if (elt === "logPages") {
        if (options.includes("logPages(")) {
          let nbOfDays = prompt.split("logPages(")[1].split(")")[0];
          if (!isNaN(nbOfDays)) roamContext.logPagesNb = Number(nbOfDays);
        }
      }
      hasContext = true;
    }
  });
  if (hasContext)
    return {
      roamContext: roamContext,
      updatedPrompt: prompt.replace(command, "").trim(),
    };
  AppToaster.show({
    message:
      "Valid options for ((context: )) command: mainPage, linkedRefs, sidebar, logPages. " +
      "For the last one, you can precise the number of days, eg.: logPages(30)",
    timeout: 0,
  });
  return null;
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
  const conversation = [{ role: "user", content: tree[0].string }];
  if (tree[0].children.length) {
    const orderedChildrenTree = tree[0].children.sort(
      (a, b) => a.order - b.order
    );
    for (let i = 0; i < orderedChildrenTree.length - 1; i++) {
      const child = orderedChildrenTree[i];
      let turnFlattenedContent = getFlattenedContentFromTree(
        child.uid,
        99,
        null
      );
      if (chatRoles.genericAssistantRegex.test(getBlockContentByUid(child.uid)))
        conversation.push({ role: "assistant", content: turnFlattenedContent });
      else conversation.push({ role: "user", content: turnFlattenedContent });
    }
  }
  return conversation;
};

export const extractNormalizedUidFromRef = (str) => {
  if (!str || (str && !(str.length === 9 || str.length === 13))) return "";
  const matchingResult = str.match(flexibleUidRegex);
  if (!matchingResult) return "";
  return isExistingBlock(matchingResult[1]) ? matchingResult[1] : "";
};

export const getContextFromSbCommand = async (
  context = "",
  currentUid,
  selectedUids,
  includeRefs
) => {
  if (context || selectedUids) {
    if (context && sbParam.test(context.trim())) {
      const contextObj = getRoamContextFromPrompt(
        `((context: ${context.trim().slice(1, -1)}))`
      );
      context = await getAndNormalizeContext(
        null,
        selectedUids,
        contextObj?.roamContext,
        currentUid
      );
    } else {
      const contextUid = extractNormalizedUidFromRef(context.trim());
      if (contextUid) {
        context = getFlattenedContentFromTree(
          contextUid,
          99,
          includeRefs === "true" ? undefined : 0,
          true // always insert a dash at the beginning of a line to mimick block structure
        );
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

export const getInstructionsFromSbCommand = (instructions) => {
  if (instructions) {
    const instructionsUid = extractNormalizedUidFromRef(instructions.trim());
    if (instructionsUid) {
      instructions = getFlattenedContentFromTree(instructionsUid, 99, 0);
    } else instructions = resolveReferences(instructions);
  }
  return instructions;
};
