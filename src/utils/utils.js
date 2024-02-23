// import assert from "node:assert";
import { gptModel, isMobileViewContext, tokensLimit } from "..";
import { getEncoding } from "js-tiktoken";

export const uidRegex = /\(\([^\)]{9}\)\)/g;
export const pageRegex = /\[\[.*\]\]/g; // very simplified, not recursive...
export const contextRegex = /\{\{context:(.[^\}]*)\}\}/g;
export const dateStringRegex = /^[0-9]{2}-[0-9]{2}-[0-9]{4}$/;
const encoding = getEncoding("cl100k_base");

export function getTreeByUid(uid) {
  // // with pull
  //   if (uid) {
  //     return window.roamAlphaAPI.pull(
  //       "[:block/uid :block/string :block/children {:block/children  ...} :block/open {:block/refs [:block/uid]} :block/order {:block/page [:block/uid]}]",
  //       [":block/uid", uid]
  //     );
  //   } else return null;
  // }
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
    .map((block) => ({ string: block.string, uid: block.uid }));
}

export function getBlockContentByUid(uid) {
  let result = window.roamAlphaAPI.pull("[:block/string]", [":block/uid", uid]);
  if (result) return result[":block/string"];
  else return "";
}

function getParentBlock(uid) {
  let result = window.roamAlphaAPI.pull("[:block/uid {:block/parents ...}]", [
    ":block/uid",
    uid,
  ]);
  if (result) return result[":block/parents"].at(-1)[":block/uid"];
  else return "";
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

export function createSiblingBlock(currentUid, position) {
  const currentOrder = getBlockOrderByUid(currentUid);
  const parentUid = getParentBlock(currentUid);
  const siblingUid = createChildBlock(
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
  if (result[0][0].children) return result[0][0].children[0].uid;
  return null;
}

export function processNotesInTree(tree, callback, callbackArgs) {
  //  tree = tree.sort((a, b) => a.order - b.order);
  for (let i = 0; i < tree.length; i++) {
    let content = tree[i].string;
    callback(callbackArgs);
    let subTree = tree[i].children;
    if (subTree) {
      processNotesInTree(subTree, callback);
    }
  }
}

export function updateArrayOfBlocks(arrayOfBlocks) {
  if (arrayOfBlocks.length) {
    arrayOfBlocks.forEach((block) =>
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: block.uid,
          string: block.content,
        },
      })
    );
  }
}

export function createChildBlock(parentUid, content, order = "last") {
  const uid = window.roamAlphaAPI.util.generateUID();
  window.roamAlphaAPI.createBlock({
    location: { "parent-uid": parentUid, order: order },
    block: { string: content, uid: uid },
  });
  return uid;
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

export function addContentToBlock(uid, contentToAdd) {
  const currentContent = getBlockContentByUid(uid).trimEnd();
  // currentContent += currentContent ? " " : "";
  window.roamAlphaAPI.updateBlock({
    block: {
      uid: uid,
      string: (currentContent ? currentContent + " " : "") + contentToAdd,
    },
  });
}

export const displaySpinner = async (targetUid) => {
  let currentElement, spinner, intervalId;
  setTimeout(() => {
    currentElement = document.querySelector(`[id*="${targetUid}"]`);
    spinner = document.createElement("strong");
    spinner.classList.add("speech-spinner");
    if (currentElement) currentElement.appendChild(spinner);
    intervalId = setInterval(() => {
      updateSpinnerText(spinner, [" .", " ..", " ...", " "]);
    }, 600);
  }, 20);
  return intervalId;

  function updateSpinnerText(container, frames) {
    const currentIndex = frames.indexOf(container.innerText);
    const nextIndex = currentIndex + 1 < frames.length ? currentIndex + 1 : 0;
    container.innerText = frames[nextIndex];
  }
};

export const removeSpinner = (intervalId) => {
  clearInterval(intervalId);
  let spinner = document.querySelector(".speech-spinner");
  if (spinner) spinner.remove();
};

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

export const getFocusAndSelection = () => {
  const currentUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
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

export const getResolvedContentFromBlocks = (blocksUids) => {
  let content = "";
  if (blocksUids.length > 0)
    blocksUids.forEach((uid) => {
      let resolvedContent = resolveReferences(getBlockContentByUid(uid));
      content += `/n((${uid})) ${resolvedContent}`;
    });
  return content;
};

export const resolveReferences = (content, refsArray = []) => {
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
      if (uidRegex.test(resolvedRef) && isNewRef)
        resolvedRef = resolveReferences(resolvedRef, refsArray);
      content = content.replace(match, resolvedRef);
    }
  }
  return content;
};

export function convertTreeToLinearArray(tree, maxContentLevel, maxRefLevel) {
  let linearArray = [];

  function traverseArray(tree, leftShift = "", level = 1) {
    if (tree[0].order) tree = tree.sort((a, b) => a.order - b.order);
    tree.forEach((element) => {
      if (element.string) {
        let uidString =
          maxRefLevel && level > maxRefLevel ? "" : "((" + element.uid + "))";
        linearArray.push(
          uidString + leftShift + "- " + resolveReferences(element.string)
        );
      } else level--;
      if (element.children) {
        if (maxContentLevel && level >= maxContentLevel) return;
        traverseArray(element.children, leftShift /* "    "*/, level + 1);
      }
    });
  }

  traverseArray(tree);

  return linearArray;
}

export const getAndNormalizeContext = async (
  startBlock,
  blocksSelectionUids,
  roamContext
) => {
  let context = "";
  if (blocksSelectionUids && blocksSelectionUids.length > 0)
    context = getResolvedContentFromBlocks(blocksSelectionUids);
  else if (startBlock)
    context = resolveReferences(getBlockContentByUid(startBlock));
  else if (isMobileViewContext && window.innerWidth < 500)
    context = getResolvedContentFromBlocks(
      getBlocksSelectionUids(true).slice(0, -1)
    );
  if (roamContext) {
    if (roamContext.mainPage) {
      const viewUid =
        await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
      context += getFlattenedContentFromTree(viewUid);
    }
    if (roamContext.linkedRefs) {
      const pageUid = await getMainPageUid();
      context += getFlattenedContentFromLinkedReferences(pageUid);
    }
    if (roamContext.logPages) {
      let startDate;
      if (isCurrentPageDNP()) {
        startDate = new Date(await getMainPageUid());
      }
      context += getFlattenedContentFromLog(
        roamContext.logPagesNb || 2,
        startDate
      );
    }
    if (roamContext.sidebar) {
      context += getFlattenedContentFromSidebar();
    }
  }

  return context;
};

const getFlattenedContentFromTree = (parentUid) => {
  let flattednedBlocks = "";
  if (parentUid) {
    let tree = getTreeByUid(parentUid);
    if (tree) {
      let content = convertTreeToLinearArray(tree).join("\n");
      if (content.length > 2 || content.replace("\n", "").trim())
        flattednedBlocks = "\n" + content;
    }
  }
  return flattednedBlocks.trim();
};

export const getFlattenedContentFromLinkedReferences = (pageUid) => {
  const refTrees = getLinkedReferencesTrees(pageUid);
  const pageName = getPageNameByPageUid(pageUid);
  let linkedRefsArray = [
    `Content from linked references of [[${pageName}]] page:`,
  ];
  refTrees.forEach((tree) =>
    linkedRefsArray.push(convertTreeToLinearArray(tree, 2, 1).join("\n"))
  );
  let flattenedRefsString = linkedRefsArray.join("\n\n");
  // console.log("flattenedRefsString :>> ", flattenedRefsString);
  console.log("length :>> ", flattenedRefsString.length);

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
        flattednedBlocks += getFlattenedContentFromTree(uid);
      else {
        flattednedBlocks += getFlattenedContentFromLinkedReferences(uid);
      }
      flattednedBlocks += index < sidebarNodes.length - 1 ? "\n\n" : "";
    }
  });
  console.log("flattedned blocks from Sidebar :>> ", flattednedBlocks);
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

export const getFlattenedContentFromLog = (nbOfDays, startDate) => {
  let processedDays = 0;
  let flattenedBlocks = "";
  let tokens = 0;
  let date = startDate || getYesterdayDate();
  while (
    tokens < tokensLimit[gptModel] &&
    (!nbOfDays || processedDays < nbOfDays)
  ) {
    let dnpUid = window.roamAlphaAPI.util.dateToPageUid(date);
    let dayContent = getFlattenedContentFromTree(dnpUid);
    if (dayContent.length > 0) {
      let dayTitle = window.roamAlphaAPI.util.dateToPageTitle(date);
      flattenedBlocks += `\n${dayTitle}:\n` + dayContent + "\n\n";
      if (flattenedBlocks.length > 36000) {
        tokens = encoding.encode(flattenedBlocks).length;
      }
      if (tokens > tokensLimit[gptModel]) {
        flattenedBlocks = flattenedBlocks.slice(
          0,
          -(dayContent.length + dayTitle.length + 4)
        );
      }
    }
    processedDays++;
    date = getYesterdayDate(date);
  }
  console.log("flattenedBlocks :>> ", flattenedBlocks);
  console.log(
    "Number of days inserted into the context window :>> ",
    processedDays
  );
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

const getMatchingInlineContext = (text) => {
  const matches = contextRegex.exec(text);
  if (!matches || matches.length < 2) return null;
  return { command: matches[0], options: matches[1] };
};

export const getRoamContextFromPrompt = (prompt) => {
  const elts = ["linkedRefs", "sidebar", "mainPage", "logPages"];
  const roamContext = {};
  let hasContext = false;
  const inlineCommand = getMatchingInlineContext(prompt);
  if (!inlineCommand) return null;
  const { command, options } = inlineCommand;
  elts.forEach((elt) => {
    if (options.includes(elt)) {
      roamContext[elt] = true;
      if (elt === "logPages") {
        if (options.includes("logPages(")) {
          let nbOfDays = prompt.split("logPages(")[1].split(")")[0];
          console.log("nbOfDays :>> ", nbOfDays);
          if (!isNaN(nbOfDays)) roamContext.logPagesNb = Number(nbOfDays);
          console.log("roamContext.logPagesNb :>> ", roamContext.logPagesNb);
        }
      }
      hasContext = true;
    }
  });
  if (hasContext)
    return {
      roamContext: roamContext,
      updatedPrompt: prompt.replace(command, ""),
    };
  return null;
};
