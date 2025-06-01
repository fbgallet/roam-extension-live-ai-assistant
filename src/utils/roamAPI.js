import { copyTreeBranches } from "../ai/responseInsertion";
import { sliceByWordLimit } from "./dataProcessing";
import {
  dateStringRegex,
  dnpUidRegex,
  flexibleUidRegex,
  strictPageRegex,
  uidRegex,
} from "./regex";

export function getTreeByUid(uid) {
  if (uid)
    return window.roamAlphaAPI.q(`[:find (pull ?page
                     [:block/uid :block/string :block/children :block/refs :block/order :block/open :block/heading :children/view-type
                        {:block/children ...} ])
                      :where [?page :block/uid "${uid}"]  ]`)[0];
  else return null;
}

export function treeToUidArray(tree, isParentToIgnore = false) {
  console.log("tree :>> ", tree);
  const result = [];
  if (!tree) {
    return result;
  }
  const rootBlock = Array.isArray(tree) ? tree[0] : tree;
  if (!rootBlock) {
    return result;
  }

  function traverseBlock(block, ignoreParent) {
    if (!ignoreParent && block["uid"] && block["string"]) {
      result.push(block["uid"]);
    }
    const children = block["children"];
    if (children && Array.isArray(children) && children.length > 0) {
      const sortedChildren = [...children].sort((a, b) => {
        const orderA = a["order"] || 0;
        const orderB = b["order"] || 0;
        return orderA - orderB;
      });
      sortedChildren.forEach((child) => {
        traverseBlock(child);
      });
    }
  }
  traverseBlock(rootBlock, isParentToIgnore);
  return result;
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

export function getLastTopLevelOfSeletion(selectionUids) {
  if (!selectionUids || !selectionUids.length) return null;
  let lastUid = selectionUids[0];
  let lastOrder = 0;
  const orderedChildrenTree = getOrderedDirectChildren(getParentBlock(lastUid));
  selectionUids.forEach((uid) => {
    const ordered = orderedChildrenTree.find((item) => item.uid === uid);
    if (ordered && ordered.order > lastOrder) {
      lastUid = uid;
      lastOrder = ordered.order;
    }
  });
  return lastUid;
}

export function getBlockContentByUid(uid) {
  if (!uid) return "";
  let result = window.roamAlphaAPI.pull("[:block/string]", [":block/uid", uid]);
  if (result) return result[":block/string"];
  else return "";
}

export function getBlocksMentioningTitle(title) {
  let result = window.roamAlphaAPI.q(`[:find ?block-uid ?block-string
    :where 
    [?page :node/title "${title}"]
    [?block :block/refs ?page]
    [?block :block/uid ?block-uid]
    [?block :block/string ?block-string]]`);
  if (!result.length) return null;
  return result.map((block) => {
    return { uid: block[0], content: block[1] };
  });
}

export function getPathOfBlock(uid) {
  let result = window.roamAlphaAPI
    .q(`[:find (pull ?block [{:block/parents [:block/uid :block/string]}])
  :where
  [?block :block/uid "${uid}"]]`);
  if (!result) return null;
  return result[0][0].parents?.map((p) => {
    return { uid: p.uid, string: p.string };
  });
}

export function getFormattedPath(uid, maxWords, directParentMaxWords) {
  const path = getPathOfBlock(uid);
  if (!path) return "";
  let formattedPath = "";
  for (let i = 0; i < path.length; i++) {
    const isDirectParent = i === path.length - 1;
    formattedPath +=
      sliceByWordLimit(
        path[i].string || "",
        isDirectParent && directParentMaxWords ? maxWords : directParentMaxWords
      ) + (isDirectParent ? "" : " > ");
  }
  return formattedPath;
}

export function isExistingBlock(uid) {
  let result = window.roamAlphaAPI.pull("[:block/uid]", [":block/uid", uid]);
  if (result) return true;
  return false;
}

export function isBlockClosedWithChildren(uid) {
  if (!uid) return null;
  let result = window.roamAlphaAPI.pull("[:block/children :block/open]", [
    ":block/uid",
    uid,
  ]);
  if (!result || !result[":block/children"]) return false;
  return !result[":block/open"];
}

export function getParentBlock(uid) {
  let result = window.roamAlphaAPI.pull(
    "[:block/uid {:block/parents [:block/uid {:block/children [:block/uid]}]}]",
    [":block/uid", uid]
  );
  // console.log("result :>> ", result);
  if (result) {
    const directParent = result[":block/parents"]?.find((parent) =>
      parent[":block/children"]?.some((child) => child[":block/uid"] === uid)
    );
    // console.log("directParent :>> ", directParent);
    if (directParent && ":block/uid" in directParent)
      return directParent[":block/uid"];
  }
  return null;
}

export function getUidAndTitleOfMentionedPagesInBlock(uid) {
  let result = window.roamAlphaAPI.pull(
    "[{:block/refs [:block/uid :node/title]}]",
    [":block/uid", uid]
  );
  if (!result) return null;
  return result[":block/refs"]
    .filter((ref) => ref[":node/title"])
    .map((ref) => {
      return { uid: ref[":block/uid"], title: ref[":node/title"] };
    });
}

// export function getTopParentAmongBlocks(blockUids) {
//   let result = window.roamAlphaAPI.q(
//     `[:find ?uids
//       :in $ [?all-uids ...]
//   :where
//   [?blocks :block/uid ?all-uids]
//   [?parents :block/children ?blocks]
//   [?children :block/parents ?parents]
//   [?parents :block/uid ?uids]
//   ]`,
//     blockUids
//   );
//   let topParent;
//   for (let i = 0; i < result.length; i++) {
//     if (blockUids.includes(result[i][0])) {
//       topParent = result[i][0];
//       break;
//     }
//   }
//   return topParent;
// }

export function getPreviousSiblingBlock(currentUid) {
  if (!currentUid) return null;
  const parentUid = getParentBlock(currentUid);
  if (!parentUid) return null;
  const tree = getOrderedDirectChildren(parentUid);
  const currentBlockOrder = tree.find(
    (block) => block.uid === currentUid
  ).order;
  if (!currentBlockOrder) return null;
  return tree.find((block) => block.order === currentBlockOrder - 1);
}

export function getPageUidByBlockUid(uid) {
  if (!uid) return null;
  let result = window.roamAlphaAPI.pull("[:block/uid {:block/page ...}]", [
    ":block/uid",
    uid,
  ]);
  if (result && result[":block/page"])
    return result[":block/page"][":block/uid"];
  else return "";
}

export function getPageUidByPageName(title) {
  let r = window.roamAlphaAPI.data.pull("[:block/uid]", [":node/title", title]);
  if (r != null) return r[":block/uid"];
  else return null;
}

export async function getMainViewUid() {
  return await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
}

export async function getMainPageUid() {
  let uid = await getMainViewUid();
  let pageUid = window.roamAlphaAPI.pull("[{:block/page [:block/uid]}]", [
    ":block/uid",
    uid,
  ]);
  if (pageUid === null) return uid;
  return pageUid[":block/page"][":block/uid"];
}

export async function getPageStatus(blockUid) {
  let currentPageUid;
  if (blockUid) currentPageUid = getPageUidByBlockUid(blockUid);
  const mainPageUid = await getMainPageUid();
  let zoomUid = await getMainViewUid();
  return {
    zoomOrMainPageUid:
      blockUid && !mainPageUid && !zoomUid ? currentPageUid : zoomUid,
    isZoomInMainPage: zoomUid && zoomUid !== mainPageUid,
    currentPageUid: currentPageUid, // !== mainPageUid ? currentPageUid : null,
  };
}

export function getPageNameByPageUid(uid) {
  let r = window.roamAlphaAPI.data.pull("[:node/title]", [":block/uid", uid]);
  if (r != null) return r[":node/title"];
  else return "undefined";
}

export function getBlockOrderByUid(uid) {
  let result = window.roamAlphaAPI.pull("[:block/order]", [":block/uid", uid]);
  if (result) return result[":block/order"];
  else return "last";
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

export async function createSiblingBlock(
  currentUid,
  position,
  content = "",
  format
) {
  const currentOrder =
    typeof position === "number" ? position : getBlockOrderByUid(currentUid);
  const parentUid = getParentBlock(currentUid);
  const siblingUid = await createChildBlock(
    parentUid,
    content,
    position === "before"
      ? typeof currentOrder === "number"
        ? currentOrder
        : 0
      : typeof currentOrder === "number"
      ? currentOrder + 1
      : "last",
    format?.open || true,
    format?.heading
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

export async function createNextSiblingIfPossible(sourceUid) {
  // otherwise (current block is top zoom block) create children block
  let targetUid;
  const topLevelInView =
    await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
  // can't create sibling if top parent block is top block in view
  if (sourceUid === topLevelInView)
    targetUid = await createChildBlock(topLevelInView);
  else targetUid = await createSiblingBlock(sourceUid);
  return targetUid;
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

export function getFirstChildContent(uid) {
  let result = window.roamAlphaAPI.q(`[:find ?first-child-uid
    :where
    [?parent-block :block/uid "${uid}"]
    [?parent-block :block/children ?first-child]
    [?first-child :block/order 0]
    [?first-child :block/uid ?first-child-uid]]`);
  if (!result.length) return null;
  return result[0][0];
}

export function focusOnBlockInMainWindow(blockUid) {
  window.roamAlphaAPI.ui.setBlockFocusAndSelection({
    location: {
      "block-uid": blockUid,
      "window-id": "main-window",
    },
  });
}

export async function updateBlock({
  blockUid,
  newContent = undefined,
  format = {},
}) {
  await window.roamAlphaAPI.updateBlock({
    block: {
      uid: blockUid,
      string: newContent,
      ...format,
    },
  });
}

export function updateArrayOfBlocks(arrayOfBlocks, mode) {
  if (arrayOfBlocks.length) {
    arrayOfBlocks.forEach((block) => {
      const uid = block.uid.replaceAll("(", "").replaceAll(")", "").trim();
      window.roamAlphaAPI.updateBlock({
        block: {
          uid: uid,
          string:
            mode === "append"
              ? getBlockContentByUid(uid).trim() + " " + block.content.trim()
              : block.content,
        },
      });
    });
  }
}

export function moveBlock({ blockUid, targetParentUid, order }) {
  window.roamAlphaAPI.moveBlock({
    location: { "parent-uid": targetParentUid, order: order || "last" },
    block: { uid: blockUid },
  });
}

export async function deleteBlock(blockUid) {
  await window.roamAlphaAPI.deleteBlock({ block: { uid: blockUid } });
}

export function reorderBlocks({ parentUid, newOrder }) {
  window.roamAlphaAPI.data.block.reorderBlocks({
    location: { "parent-uid": parentUid },
    blocks: newOrder,
  });
}

export async function createChildBlock(
  parentUid,
  content = "",
  order = "last",
  open = true,
  heading = 0,
  viewType = "bullet",
  uid
) {
  if (!uid) uid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.createBlock({
    location: { "parent-uid": parentUid, order: order },
    block: {
      string: content,
      uid: uid,
      open: open,
      heading: heading,
      "children-view-type": viewType,
    },
  });
  return uid;
}

const deleteChildren = async (parentUid) => {
  const directChildren = getOrderedDirectChildren(parentUid);
  // console.log("directChildren :>> ", directChildren);
  if (directChildren) {
    await Promise.all(
      directChildren.map(async (child) => await deleteBlock(child.uid))
    );
  }
};

export const replaceChildrenByNewTree = async (
  parentUid,
  newTree,
  isClone = false
) => {
  await deleteChildren(parentUid);
  await copyTreeBranches(newTree, parentUid, 99, null, isClone);
};

export async function insertBlockInCurrentView(content, order) {
  let zoomUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
  // If not on a given page, but in Daily Log
  if (!zoomUid) {
    zoomUid = window.roamAlphaAPI.util.dateToPageUid(new Date());
    // TODO : send a message "Added on DNP page"
  }
  const newUid = window.roamAlphaAPI.util.generateUID();
  await window.roamAlphaAPI.createBlock({
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

export async function addContentToBlock(uid, contentToAdd, format = {}) {
  const currentContent = getBlockContentByUid(uid).trimEnd();
  // currentContent += currentContent ? " " : "";
  await window.roamAlphaAPI.updateBlock({
    block: {
      uid: uid,
      string: (currentContent ? currentContent + " " : "") + contentToAdd,
      ...format,
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
      const uid = inputBlock.id.slice(-9);
      if (!selectedBlocksUids.includes(uid)) selectedBlocksUids.push(uid);
      if (isBlockClosedWithChildren(uid)) {
        let childrenUidsList = treeToUidArray(getTreeByUid(uid), true);
        selectedBlocksUids.push(...childrenUidsList);
      }
    });
  } else if (checkSelection.length !== 0) {
    selectedBlocksUids = checkSelection;
  }
  return selectedBlocksUids;
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

export const resolveReferences = (content, refsArray = [], once = false) => {
  uidRegex.lastIndex = 0;
  // console.log("content :>> ", content);
  if (uidRegex.test(content)) {
    uidRegex.lastIndex = 0;
    let matches = content.match(uidRegex);
    for (const match of matches) {
      let refUid = match.slice(2, -2);
      // prevent infinite loop !
      let isNewRef = !refsArray.includes(refUid);
      refsArray.push(refUid);
      let resolvedRef;
      if (isExistingBlock(refUid)) {
        resolvedRef = getBlockContentByUid(refUid);
        uidRegex.lastIndex = 0;
        if (uidRegex.test(resolvedRef) && isNewRef && !once)
          resolvedRef = resolveReferences(resolvedRef, refsArray);
      } else {
        resolvedRef = match;
      }
      content = content.replaceAll(match, resolvedRef);
    }
  }
  return content;
};

export const isLogView = () => {
  if (document.querySelector("#rm-log-container")) return true;
  return false;
};

export const isCurrentPageDNP = async () => {
  const pageUid = await getMainPageUid();
  return dnpUidRegex.test(pageUid);
};

export const getDNPTitleFromDate = (date) => {
  return window.roamAlphaAPI.util.dateToPageTitle(date);
};

export const getCurrentOrRelativeDateString = (uid) => {
  const currentPageUid = uid && getPageUidByBlockUid(uid);
  const currentDate =
    currentPageUid && dnpUidRegex.test(currentPageUid)
      ? getFormattedDate(getDateStringFromDnpUid(currentPageUid))
      : getFormattedDate(new Date());
  return currentDate;
};

export const getRelativeDateAndTimeString = (uid) => {
  const currentDate = getCurrentOrRelativeDateString(uid);
  const now = new Date();
  let hours = now.getHours();
  let minutes = now.getMinutes();
  hours = hours < 10 ? "0" + hours : hours;
  minutes = minutes < 10 ? "0" + minutes : minutes;
  return `${currentDate} ${hours}:${minutes}`;
};

export const getYesterdayDate = (date = null) => {
  if (!date) date = new Date();
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
};

const getFormattedDate = (date) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const formattedDate = formatter.format(date);
  return formattedDate;
};

export const getDateStringFromDnpUid = (dnpUid) => {
  const parts = dnpUid.split("-");
  const date = new Date(parts[2], parts[0] - 1, parts[1]);
  return date;
};

export const extractNormalizedUidFromRef = (str, testIfExist = true) => {
  if (!str || (str && !(str.length === 9 || str.length === 13))) return "";
  const matchingResult = str.match(flexibleUidRegex);
  if (!matchingResult) return "";
  return testIfExist
    ? isExistingBlock(matchingResult[1])
      ? matchingResult[1]
      : ""
    : matchingResult[1];
};

export const normalizePageTitle = (str) => {
  if (strictPageRegex.test(str)) return str.slice(2, -2);
  else return str;
};

// only used on templates to remove {text} flag
export const cleanFlagFromBlocks = (flag, blockUids) => {
  blockUids.forEach((uid) =>
    window.roamAlphaAPI.updateBlock({
      block: {
        uid: uid,
        string: getBlockContentByUid(uid).replace(flag, "").trim(),
      },
    })
  );
};
