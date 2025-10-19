// import React from "react";
import ReactDOM from "react-dom";
import DOMPurify from "dompurify";
import InstantButtons from "../components/InstantButtons";
import {
  extensionStorage,
  isComponentVisible,
  position,
  updateAvailableModels,
} from "..";
import { getSpeechRecognitionAPI } from "../audio/audio";
import App from "../App";
import TokensDialog from "../components/TokensDisplay";
import AskGraphModeDialog from "../components/AskGraphModeDialog";
import AskGraphFirstTimeDialog from "../components/AskGraphFirstTimeDialog";
import { getFocusAndSelection } from "../ai/dataExtraction";
import { AppToaster } from "../components/Toaster";
import { chatWithLinkedRefs } from "../components/full-results-popup";

export function mountComponent(
  position,
  props,
  isCapturingCurrentFocus = true
) {
  if (window.roamAlphaAPI.platform.isMobile) position = "top";
  let currentBlockUid = isCapturingCurrentFocus
    ? window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"]
    : undefined;
  let container = document.querySelector(
    `.speech-to-roam-container-${position}`
  );

  if (!container) {
    createContainer(position);
    return mountComponent(position);
  }

  updateAvailableModels();

  if (!props) {
    props = {};
    // props.transcribeOnly = isTranslateIconDisplayed ? false : true;
  }
  // No access to microphone in mobile App and desktop App on MacOs
  // so speech-to-roam doesn't work at all in this context
  props.worksOnPlatform =
    (window.roamAlphaAPI.platform.isDesktop &&
      !window.roamAlphaAPI.platform.isPC) ||
    window.roamAlphaAPI.platform.isMobileApp
      ? false
      : true;

  // Web API speech recognition doesn't work on Electron app nor Firefox nor Arc browser
  props.position = position;
  props.mic =
    !window.roamAlphaAPI.platform.isDesktop &&
    navigator.userAgent.indexOf("Firefox") === -1 &&
    !getComputedStyle(document.documentElement).getPropertyValue(
      "--arc-palette-background"
    ) // specific to Arc browser
      ? getSpeechRecognitionAPI()
      : null;

  // isSafari = true;

  ReactDOM.render(
    <App
      blockUid={currentBlockUid}
      isVisible={isComponentVisible}
      {...props}
    />,
    container
  );
}

export function unmountComponent(position) {
  const node = document.querySelector(`.speech-to-roam-container-${position}`);
  if (node) ReactDOM.unmountComponentAtNode(node);
}

export function toggleComponentVisibility() {
  let componentElt = document.getElementsByClassName("speech-to-roam")[0];
  if (!componentElt) return;
  componentElt.style.display === "none"
    ? (componentElt.style.display = "inherit")
    : (componentElt.style.display = "none");
}

export const simulateClick = (
  elt = document.querySelector(".roam-body-main")
) => {
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

export function simulateClickOnRecordingButton() {
  const button = document.getElementsByClassName("speech-record-button")[0];
  if (
    !isComponentVisible &&
    document.getElementsByClassName("speech-to-roam")[0]?.style.display ===
      "none"
  ) {
    toggleComponentVisibility();
    if (position === "left") window.roamAlphaAPI.ui.leftSidebar.open();
  }
  if (button) {
    button.focus();
    button.click();
  }
}

export function createContainer(position) {
  const rootPosition =
    position === "top"
      ? document.querySelector(".rm-topbar")
      : document.querySelector(".roam-sidebar-content");
  const newElt = document.createElement("span");
  position === "left" && newElt.classList.add("log-button");
  newElt.classList.add(
    "speech-to-roam",
    `speech-to-roam-container-${position}`
  );
  const todayTomorrowExtension = document.querySelector("#todayTomorrow");
  if (todayTomorrowExtension && position === "top")
    todayTomorrowExtension.insertAdjacentElement("afterend", newElt);
  else
    rootPosition.insertBefore(
      newElt,
      position === "top"
        ? rootPosition.firstChild
        : document.querySelector(".rm-left-sidebar__daily-notes").nextSibling
    );
}

export function removeContainer(position) {
  const container = document.querySelector(
    `.speech-to-roam-container-${position}`
  );
  if (container) container.remove();
}

export const displaySpinner = async (targetUid) => {
  // console.log("targetUid :>> ", targetUid);

  // Safety check: if targetUid is null, undefined, or invalid, return early
  if (!targetUid || targetUid === "undefined" || targetUid === "null") {
    console.warn("⚠️ displaySpinner called with invalid targetUid:", targetUid);
    return null; // Return null instead of intervalId to indicate no spinner was created
  }

  let targetBlockElt, spinner, intervalId;
  setTimeout(() => {
    targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);
    if (targetBlockElt?.tagName.toLowerCase() === "textarea") {
      targetBlockElt = targetBlockElt.parentElement;
    }
    const previousSpinner = targetBlockElt.querySelector(".speech-spinner");
    if (previousSpinner) previousSpinner.remove();
    spinner = document.createElement("strong");
    spinner.classList.add("speech-spinner");
    if (targetBlockElt) targetBlockElt.appendChild(spinner);
    intervalId = setInterval(() => {
      updateSpinnerText(spinner, [" .", " ..", " ...", " "]);
    }, 300);
  }, 100);
  return intervalId;

  function updateSpinnerText(container, frames) {
    const currentIndex = frames.indexOf(container.innerText);
    const nextIndex = currentIndex + 1 < frames.length ? currentIndex + 1 : 0;
    container.innerText = frames[nextIndex];
    if (frames[nextIndex] === " ")
      container.innerHTML = DOMPurify.sanitize("&nbsp;");
  }
};

export const removeSpinner = (intervalId) => {
  // Only clear interval if intervalId is valid
  if (intervalId) {
    clearInterval(intervalId);
  }
  const spinner = document.querySelector(".speech-spinner");
  if (spinner) spinner.remove();
};

export const insertParagraphForStream = (targetUid) => {
  let targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);

  if (!targetBlockElt) targetBlockElt = document.querySelector(".rm-block");
  const previousStreamElt = targetBlockElt.querySelector(".speech-stream");
  if (previousStreamElt) previousStreamElt.remove();
  const streamElt = document.createElement("p");
  streamElt.classList.add("speech-stream");
  if (targetBlockElt) targetBlockElt.appendChild(streamElt);
  //displaySpinner(targetUid);
  return streamElt;
};

export const insertInstantButtons = async (props) => {
  let targetElts = [...document.querySelectorAll(`[id$="${props.targetUid}"]`)];

  if (!targetElts.length) return;

  targetElts = targetElts
    .map((elt) =>
      elt.id.includes("sidebar-window")
        ? elt.querySelector(`[id$="${props.targetUid}"]`)
        : elt
    )
    .filter((elt, index, array) => index === 0 || elt !== array[index - 1]);

  targetElts = targetElts
    .filter((elt) => elt != null)
    .map((elt) => elt.closest(".rm-block-main"));

  const selector = `.liveai-instant-btn-${
    props.isOutlinerAgent ? "outliner-" : ""
  }container`;

  const previousContainerElts =
    targetElts.length &&
    targetElts
      .map((elt) => elt.parentElement.querySelector(selector))
      .filter((elt) => elt != null);

  if (previousContainerElts.length) {
    previousContainerElts.forEach((elt) => {
      elt && ReactDOM.unmountComponentAtNode(elt);
    });
    setTimeout(() => {
      previousContainerElts.forEach((elt) => elt.remove());
    }, 200);
    if (props.isToRemove) {
      return;
    }
  }

  targetElts.forEach((elt) => {
    let container = document.createElement("div");
    container.classList.add(selector.slice(1));
    if (props.isOutlinerAgent) elt.nextElementSibling.appendChild(container);
    else elt.appendChild(container);
    ReactDOM.render(<InstantButtons {...props} />, container);
  });
};

export const displayTokensDialog = () => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(".tokens-dialog-container");
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("tokens-dialog-container");
  targetElt.appendChild(container);
  function unmountTokensDialog() {
    const node = document.querySelector(".tokens-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }
  ReactDOM.render(
    <TokensDialog isOpen={true} onClose={unmountTokensDialog} />,
    container
  );
};

export const displayAskGraphModeDialog = (dialogData) => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(".askgraph-mode-dialog-container");
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("askgraph-mode-dialog-container");
  targetElt.appendChild(container);

  function unmountAskGraphModeDialog() {
    const node = document.querySelector(".askgraph-mode-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }

  ReactDOM.render(
    <AskGraphModeDialog
      isOpen={true}
      onClose={unmountAskGraphModeDialog}
      currentMode={dialogData.currentMode}
      suggestedMode={dialogData.suggestedMode}
      userQuery={dialogData.userQuery}
      onModeSelect={(selectedMode, rememberChoice) => {
        // Close dialog first
        unmountAskGraphModeDialog();
        // Then call the callback
        if (dialogData.onModeSelect) {
          dialogData.onModeSelect(selectedMode, rememberChoice);
        }
      }}
    />,
    container
  );
};

export const displayAskGraphFirstTimeDialog = (dialogData) => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(
      ".askgraph-firsttime-dialog-container"
    );
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("askgraph-firsttime-dialog-container");
  targetElt.appendChild(container);

  function unmountAskGraphFirstTimeDialog() {
    const node = document.querySelector(".askgraph-firsttime-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }

  ReactDOM.render(
    <AskGraphFirstTimeDialog
      isOpen={true}
      onClose={unmountAskGraphFirstTimeDialog}
      onModeSelect={(selectedMode) => {
        // Close dialog first
        unmountAskGraphFirstTimeDialog();
        // Then call the callback
        if (dialogData.onModeSelect) {
          dialogData.onModeSelect(selectedMode);
        }
      }}
    />,
    container
  );
};

export const highlightHtmlElt = ({
  roamElt = undefined,
  selector = undefined,
  eltUid = undefined,
  isFixed = false,
  isInset = false,
  color = "",
  onlyChildren = true,
  isToRemove = false,
}) => {
  if (roamElt) {
    switch (roamElt) {
      case "sidebar":
        selector = "#roam-right-sidebar-content";
        isInset = true;
        break;
      case "logPages":
        selector = ".roam-log-container";
        break;
      case "pageTitle":
      case "page":
        selector = ".roam-article > div:first-child";
        break;
      case "linkedRefs":
        selector = ".rm-reference-main";
        break;
      case "mainPage":
        selector = ".roam-article > div:first-child";
        break;
    }
  }
  let elts = [];
  if (!eltUid) elts = [...document.querySelectorAll(selector)];
  else {
    let eltToHighlight = [
      ...document.querySelectorAll(`.roam-block[id$="${eltUid}"]`),
    ];
    eltToHighlight = eltToHighlight.concat([
      ...document.querySelectorAll(`.rm-block-input[id$="${eltUid}"]`),
    ]);
    // console.log("eltToHighlight :>> ", eltToHighlight);
    if (eltToHighlight && eltToHighlight.length)
      elts = eltToHighlight
        .map((elt) =>
          elt.tagName === "TEXTAREA"
            ? elt.parentElement.parentElement
            : elt.parentElement
        )
        .map((elt) => (onlyChildren ? elt.nextElementSibling : elt));
  }
  const highightSelector = `${isFixed ? "fixed-" : ""}highlight-elt${
    color ? "-" + color : ""
  }${isInset ? "-inset" : ""}`;
  if (!elts?.length) return;
  elts.forEach((elt) => {
    if (!elt.classList.contains(highightSelector) && !isToRemove) {
      elt.classList.add(highightSelector);
      if (isFixed || color === "blue") return;
      setTimeout(() => {
        elt.classList.remove(highightSelector);
      }, 6000);
    } else if (isToRemove) {
      elt.classList.remove(highightSelector);
    }
  });
};

export const setAsOutline = async (rootUid) => {
  let { currentUid, selectionUids } = getFocusAndSelection();
  !rootUid &&
    (rootUid =
      currentUid || (selectionUids.length ? selectionUids[0] : undefined));

  if (!rootUid) {
    AppToaster.show({
      message: `A block has to be focused or an outline has to selected to be set as the target for Outliner Agent`,
    });
    return null;
  } else {
    await extensionStorage.set("outlinerRootUid", rootUid);
    toggleOutlinerSelection(extensionStorage.get("outlinerRootUid"), true);
    return rootUid;
  }
};

export const toggleOutlinerSelection = (targetUid, isSelected) => {
  // console.log("targetUid :>> ", targetUid);
  if (targetUid)
    setTimeout(() => {
      highlightHtmlElt({
        eltUid: targetUid,
        isFixed: true,
        color: "blue",
        isToRemove: !isSelected,
      });
      insertInstantButtons({
        targetUid,
        isOutlinerAgent: true,
        isToRemove: !isSelected,
      });
    }, 100);
  if (isComponentVisible) {
    // remount Speech component to update Outliner Agent icon
    unmountComponent(position);
    mountComponent(position, { outlineState: isSelected }, false);
  }
};

// Event listeners for page navigation
export function addPageNavigationListeners() {
  window.addEventListener("popstate", onPageLoad);
}

export function removePageNavigationListeners() {
  window.removeEventListener("popstate", onPageLoad);
}

export function onPageLoad() {
  setTimeout(() => {
    insertAskLinkedReferencesButton();
  }, 50);
}

// Insert the Ask Linked References button in the references section
function insertAskLinkedReferencesButton() {
  // Don't insert the button in daily log
  const logPages = document.querySelector(".roam-log-container");
  if (logPages) return;

  // Check if we're in a context where references section exists
  const referencesContainer = document.querySelector(".rm-reference-container");
  if (!referencesContainer) return;

  const flexContainer = referencesContainer.querySelector(".flex-h-box");
  if (!flexContainer) return;

  const mentionsSearch = flexContainer.querySelector(".rm-mentions-search");
  if (!mentionsSearch) return;

  // Check if button already exists
  const existingButton = flexContainer.querySelector(".ask-linked-refs-button");
  if (existingButton) return;

  // Create the button
  const button = document.createElement("button");
  button.className = "bp3-button bp3-minimal bp3-small ask-linked-refs-button";
  button.style.marginRight = "2px";
  button.innerHTML = `
    <span class="bp3-icon bp3-icon-chat" style="padding: 0 7px;"></span>
  `;
  button.title = "Live AI: Ask Linked Refenreces of this page";

  // Add click handler
  button.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await chatWithLinkedRefs({});
    } catch (error) {
      console.error("Error invoking current page references:", error);
      AppToaster.show({
        message: `Failed to ask linked references: ${error.message}`,
        intent: "warning",
        timeout: 5000,
      });
    }
  });

  // Insert button before the mentions search
  flexContainer.insertBefore(button, mentionsSearch);
}
