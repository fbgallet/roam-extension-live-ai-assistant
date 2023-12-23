export const uidRegex = /\(\([^\)]{9}\)\)/g;
export const pageRegex = /\[\[.*\]\]/g; // very simplified, not recursive...

export function getTreeByUid(uid) {
  if (uid) {
    return window.roamAlphaAPI.pull(
      "[:block/uid :block/string :block/children {:block/children  ...} :block/open {:block/refs [:block/uid]} :block/order {:block/page [:block/uid]}]",
      [":block/uid", uid]
    );
  } else return null;
}

// Same function with .q
//
// export function getTreeByUid(uid) {
//   if (uid)
//     return window.roamAlphaAPI.q(`[:find (pull ?page
//                      [:block/uid :block/string :block/children :block/refs
//                         {:block/children ...} ])
//                       :where [?page :block/uid "${uid}"]  ]`)[0];
//   else return null;
// }

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

export async function getTopOrActiveBlockUid() {
  let currentBlockUid = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
  if (currentBlockUid) return currentBlockUid;
  else {
    let uid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
    return getFirstChildUid(uid);
  }
}

function getFirstChildUid(uid) {
  let q = `[:find (pull ?c
                       [:block/uid :block/children {:block/children ...}])
                    :where [?c :block/uid "${uid}"]  ]`;
  return window.roamAlphaAPI.q(q)[0][0].children[0].uid;
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
  const currentContent = getBlockContentByUid(uid);
  window.roamAlphaAPI.updateBlock({
    block: { uid: uid, string: currentContent + contentToAdd },
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
