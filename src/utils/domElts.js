// import React from "react";
import ReactDOM from "react-dom";
import InstantButtons from "../components/InstantButtons";
import { extensionStorage, isComponentVisible, position } from "..";
import { getSpeechRecognitionAPI } from "../audio/audio";
import App from "../App";
import TokensDialog from "../components/TokensDisplay";
import { getFocusAndSelection } from "../ai/dataExtraction";
import { AppToaster } from "../components/Toaster";

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

  console.log("currentBlockUid :>> ", currentBlockUid);

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
  console.log("targetUid :>> ", targetUid);
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
    if (frames[nextIndex] === " ") container.innerHTML = "&nbsp;";
  }
};

export const removeSpinner = (intervalId) => {
  clearInterval(intervalId);
  const spinner = document.querySelector(".speech-spinner");
  if (spinner) spinner.remove();
};

export const insertParagraphForStream = (targetUid) => {
  let targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);
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
        break;
      case "logPages":
        selector = ".roam-log-container";
        break;
      case "pageTitle":
        selector = ".rm-title-display";
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
  if (!elts.length) return;
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
  console.log("targetUid :>> ", targetUid);
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
