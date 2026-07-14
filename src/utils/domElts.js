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
import ScopeSelectionDialog from "../components/ScopeSelectionDialog";
import { getFocusAndSelection } from "../ai/dataExtraction";
import { AppToaster } from "../components/Toaster";
import {
  chatWithLinkedRefs,
  chatWithQuery,
  chatWithDatomicQuery,
} from "../components/full-results-popup";
import {
  autoCompleteTableRow,
  autoCompleteTableColumn,
  generateTableRows,
  generateTableColumns,
} from "../ai/tableCompletion";
import { getTableModel } from "./roamTable";
import { openTableAutocompleteDialog } from "../components/TableAutocompleteDialog";
import ModelsMenu from "../components/ModelsMenu";
import {
  faBolt,
  faLayerGroup,
  faTableColumns,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import ModelConfigDialog from "../components/model-config/ModelConfigDialog";
import ModelMigrationDialog from "../components/model-config/ModelMigrationDialog";
import MCPConfigComponent from "../components/MCPConfigComponent";
import { Dialog, Tooltip, ContextMenu } from "@blueprintjs/core";

export function mountComponent(
  position,
  props,
  isCapturingCurrentFocus = true,
) {
  if (window.roamAlphaAPI.platform.isMobile) position = "top";
  let currentBlockUid = isCapturingCurrentFocus
    ? window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"]
    : undefined;
  let container = document.querySelector(
    `.speech-to-roam-container-${position}`,
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
      "--arc-palette-background",
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
    container,
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
  elt = document.querySelector(".roam-body-main"),
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
    `speech-to-roam-container-${position}`,
  );
  const todayTomorrowExtension = document.querySelector("#todayTomorrow");
  if (todayTomorrowExtension && position === "top")
    todayTomorrowExtension.insertAdjacentElement("afterend", newElt);
  else if (
    window.roamAlphaAPI.platform.isDesktop &&
    !window.roamAlphaAPI.platform.isMobile &&
    !window.roamAlphaAPI.platform.isMobileApp &&
    position === "top"
  ) {
    const rightArrow = document.querySelector(".rm-electron-nav-forward-btn");
    rightArrow.insertAdjacentElement("afterend", newElt);
  } else
    rootPosition.insertBefore(
      newElt,
      position === "top"
        ? rootPosition.firstChild
        : document.querySelector(".rm-left-sidebar__daily-notes").nextSibling,
    );
}

export function removeContainer(position) {
  const container = document.querySelector(
    `.speech-to-roam-container-${position}`,
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
  // Wait ~100ms for the target block to be rendered in the DOM, but AWAIT it so the
  // real intervalId is returned. Returning before the setTimeout fired meant the id
  // was always undefined: the interval was never cleared, and a fast-returning caller
  // (e.g. the silence guard) could call removeSpinner BEFORE the spinner even existed,
  // leaving the dots animating forever.
  await new Promise((resolve) => {
    setTimeout(() => {
      targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);

      // If block doesn't exist in DOM (e.g., chat-agent-tool, query-composer), skip spinner
      if (!targetBlockElt) {
        console.warn(
          "⚠️ displaySpinner: Block not found in DOM for UID:",
          targetUid,
        );
        return resolve();
      }

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
      resolve();
    }, 100);
  });
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
  let targetBlockElt;

  // Check if this is a chat UI streaming request
  if (targetUid === "chatResponse") {
    // Look for the chat streaming container in the Full Results Chat panel
    targetBlockElt = document.querySelector(
      ".full-results-chat-streaming-container",
    );

    // If not found, create it in the chat messages area
    if (!targetBlockElt) {
      const chatMessagesArea = document.querySelector(
        ".full-results-chat-messages",
      );
      if (chatMessagesArea) {
        targetBlockElt = document.createElement("div");
        targetBlockElt.classList.add("full-results-chat-streaming-container");
        chatMessagesArea.appendChild(targetBlockElt);
      }
    }
  } else {
    // Regular Roam block streaming
    targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);
    if (!targetBlockElt) targetBlockElt = document.querySelector(".rm-block");
  }

  if (!targetBlockElt) return null;

  const previousStreamElt = targetBlockElt.querySelector(".speech-stream");
  if (previousStreamElt) previousStreamElt.remove();
  const streamElt = document.createElement("p");
  streamElt.classList.add("speech-stream");
  targetBlockElt.appendChild(streamElt);
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
        : elt,
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

    // Add data attribute to parent .rm-block for CSS performance (replacing :has() selector)
    const blockElement = elt.closest(".rm-block");
    if (blockElement) {
      const hasRefCount = blockElement.querySelector(".rm-block__ref-count");
      if (hasRefCount) {
        blockElement.dataset.hasRefCount = "true";
      }
      if (props.isOutlinerAgent) {
        blockElement.dataset.hasInstantBtnOutliner = "true";
      } else {
        blockElement.dataset.hasInstantBtn = "true";
      }
    }

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
    container,
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
    container,
  );
};

export const displayAskGraphFirstTimeDialog = (dialogData) => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(
      ".askgraph-firsttime-dialog-container",
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
    container,
  );
};

export const displayScopeSelectionDialog = (dialogData) => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(".scope-selection-dialog-container");
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("scope-selection-dialog-container");
  targetElt.appendChild(container);

  function unmountScopeSelectionDialog() {
    const node = document.querySelector(".scope-selection-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }

  ReactDOM.render(
    <ScopeSelectionDialog
      isOpen={true}
      onClose={unmountScopeSelectionDialog}
      scopeOptions={dialogData.scopeOptions}
      recommendedStrategy={dialogData.recommendedStrategy}
      userQuery={dialogData.userQuery}
      forceScopeSelection={dialogData.forceScopeSelection}
      onScopeSelect={(selectedStrategy) => {
        // Close dialog first
        unmountScopeSelectionDialog();
        // Then call the callback
        if (dialogData.onScopeSelect) {
          dialogData.onScopeSelect(selectedStrategy);
        }
      }}
      onSkip={() => {
        // Close dialog first
        unmountScopeSelectionDialog();
        // Then call the skip callback if provided
        if (dialogData.onSkip) {
          dialogData.onSkip();
        }
      }}
      onCancel={() => {
        // Close dialog first
        unmountScopeSelectionDialog();
        // Then call the cancel callback if provided
        if (dialogData.onCancel) {
          dialogData.onCancel();
        }
      }}
    />,
    container,
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
            : elt.parentElement,
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

export const displayModelConfigDialog = (dialogData = {}, initialTab) => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(".model-config-dialog-container");
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("model-config-dialog-container");
  targetElt.appendChild(container);

  function unmountModelConfigDialog() {
    const node = document.querySelector(".model-config-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }

  ReactDOM.render(
    <ModelConfigDialog
      isOpen={true}
      onClose={unmountModelConfigDialog}
      onSave={async (newConfig) => {
        // Close dialog first
        unmountModelConfigDialog();
        // Then call the save callback if provided
        if (dialogData.onSave) {
          await dialogData.onSave(newConfig);
        }
      }}
      initialTab={initialTab}
    />,
    container,
  );
};

export const displayMCPConfigDialog = () => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(".mcp-config-dialog-container");
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("mcp-config-dialog-container");
  targetElt.appendChild(container);

  function unmountMCPConfigDialog() {
    const node = document.querySelector(".mcp-config-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }

  ReactDOM.render(
    <Dialog
      isOpen={true}
      onClose={unmountMCPConfigDialog}
      title="MCP Servers Configuration"
      canOutsideClickClose={true}
      canEscapeKeyClose={true}
    >
      <MCPConfigComponent extensionStorage={extensionStorage} />
    </Dialog>,
    container,
  );
};

export const displayModelMigrationDialog = (
  deprecatedModels = [],
  onMigrate,
) => {
  const targetElt = document.querySelector(".roam-body");
  const previousContainer =
    targetElt &&
    targetElt.parentElement.querySelector(".model-migration-dialog-container");
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
  }
  container = document.createElement("div");
  container.classList.add("model-migration-dialog-container");
  targetElt.appendChild(container);

  function unmountMigrationDialog() {
    const node = document.querySelector(".model-migration-dialog-container");
    if (node) {
      ReactDOM.unmountComponentAtNode(node);
      node.remove();
    }
  }

  ReactDOM.render(
    <ModelMigrationDialog
      isOpen={true}
      onClose={unmountMigrationDialog}
      deprecatedModels={deprecatedModels}
      onMigrate={async (migrations) => {
        unmountMigrationDialog();
        if (onMigrate) {
          await onMigrate(migrations);
        }
      }}
    />,
    container,
  );
};

// Query Observer for "Ask Query" button
let queryObserver = null;
let queryObserverDebounceTimer = null;
let datomicMenuObserver = null;
let tableMenuObserver = null;

/**
 * Extract query block UID from a query title element by traversing up to find .rm-block
 */
function getQueryBlockUidFromTitleElement(titleElement) {
  const blockElement = titleElement.closest(".rm-block");
  if (blockElement) {
    return blockElement.getAttribute("data-block-uid");
  }
  return null;
}

/**
 * Insert a chat button after a query title element
 */
function insertQueryChatButton(titleElement) {
  // Check if button already exists
  if (
    titleElement.nextElementSibling?.classList?.contains(
      "ask-query-button-container",
    )
  ) {
    return;
  }

  const queryBlockUid = getQueryBlockUidFromTitleElement(titleElement);
  if (!queryBlockUid) {
    return;
  }

  // Create a container for the React component
  const container = document.createElement("span");
  container.className = "ask-query-button-container";

  // Insert container after title element
  titleElement.insertAdjacentElement("afterend", container);

  // Render React component with Tooltip
  const QueryChatButton = () => {
    const handleMouseDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleMouseUp = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleClick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        await chatWithQuery({ queryBlockUid });
      } catch (error) {
        console.error("Error invoking query chat:", error);
        AppToaster.show({
          message: `Failed to chat with query results: ${error.message}`,
          intent: "warning",
          timeout: 5000,
        });
      }
    };

    return (
      <Tooltip content="Live AI: Chat with query results" hoverOpenDelay={300}>
        <button
          className="bp3-button bp3-minimal bp3-small ask-query-button"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        >
          <span className="bp3-icon bp3-icon-chat"></span>
        </button>
      </Tooltip>
    );
  };

  ReactDOM.render(<QueryChatButton />, container);
}

/**
 * Insert a "Chat with results" menu item inside a :q query settings popup menu.
 * The menu is a .bp3-menu with class .rm-data-table__settings, rendered in a portal.
 * We find the associated block UID from the popover target (the gear icon inside .rm-data-table).
 */
function insertDatomicQueryChatMenuItem(menuElement) {
  // Check if menu item already exists
  if (menuElement.querySelector(".ask-datomic-query-menu-item")) {
    return;
  }

  // The menu is rendered inside a .bp3-portal > .bp3-overlay > .bp3-popover.
  // The popover target (gear icon) is the element that triggered it.
  // We find the block UID by looking at the .bp3-popover-target or the
  // currently open popover's reference in the DOM.
  // Strategy: find the .rm-data-table element that has an open popover target
  const popoverWrapper = menuElement.closest(".bp3-popover");
  let queryBlockUid = null;

  if (popoverWrapper) {
    // Blueprint v3: the popover and target are siblings inside a .bp3-popover-wrapper
    const wrapper = popoverWrapper.closest(".bp3-popover-wrapper");
    if (wrapper) {
      const blockElement = wrapper.closest(".rm-block");
      if (blockElement) {
        queryBlockUid = blockElement.getAttribute("data-block-uid");
      }
    }
  }

  // Fallback: find any .rm-data-table whose settings button has aria-expanded or is active
  if (!queryBlockUid) {
    const openTarget = document.querySelector(
      ".rm-data-table .bp3-popover-wrapper .bp3-popover-open",
    );
    if (openTarget) {
      const blockElement = openTarget.closest(".rm-block");
      if (blockElement) {
        queryBlockUid = blockElement.getAttribute("data-block-uid");
      }
    }
  }

  if (!queryBlockUid) return;

  // Add a divider before our menu item
  const divider = document.createElement("li");
  divider.className = "bp3-menu-divider";
  menuElement.appendChild(divider);

  // Create a bp3 menu item with label icon on the right
  const menuItem = document.createElement("li");
  menuItem.className = "ask-datomic-query-menu-item";

  ReactDOM.render(
    <a
      className="bp3-menu-item"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await chatWithDatomicQuery({ queryBlockUid });
        } catch (error) {
          console.error("Error invoking :q query chat:", error);
          AppToaster.show({
            message: `Failed to chat with :q query results: ${error.message}`,
            intent: "warning",
            timeout: 5000,
          });
        }
      }}
    >
      <div className="bp3-text-overflow-ellipsis bp3-fill">
        Chat with results
      </div>
      <span className="bp3-icon bp3-icon-chat bp3-icon-standard bp3-menu-item-label" />
    </a>,
    menuItem,
  );

  menuElement.appendChild(menuItem);
}

/**
 * Given a Roam table row/column context menu, resolve which table, which type
 * (row|column) and which index the menu targets. Type is derived from the menu's own
 * items (Insert above/below = row; Insert left/right/Sort = column); the index and the
 * table block uid come from the currently open (or active) row/column pill handle.
 * Resolved lazily at click time so the pill's popover-open state is reliably set.
 */
function getTableTargetFromMenu(menuElement) {
  const isRow = !!menuElement.querySelector(
    ".bp3-icon-arrow-up, .bp3-icon-arrow-down",
  );
  const isColumn = !!menuElement.querySelector(
    ".bp3-icon-arrow-left, .bp3-icon-arrow-right, .bp3-icon-sort",
  );
  const type = isRow ? "row" : isColumn ? "column" : null;
  if (!type) return null;

  const pillSelectors =
    type === "row"
      ? [
          ".rm-table__row-pill-target.bp3-popover-open",
          ".bp3-popover-open .rm-table__row-pill-target",
          ".rm-table__row-pill.visible",
        ]
      : [
          ".rm-table__col-pill-target.bp3-popover-open",
          ".bp3-popover-open .rm-table__col-pill-target",
          ".rm-table__col-pill.visible",
        ];
  let pill = null;
  for (const selector of pillSelectors) {
    pill = document.querySelector(selector);
    if (pill) break;
  }
  if (!pill) return null;

  const cell = pill.closest("td");
  const blockElement = pill.closest(".rm-block");
  const tableBlockUid = blockElement?.getAttribute("data-block-uid");
  if (!cell || !tableBlockUid) return null;

  const index = parseInt(
    cell.getAttribute(type === "row" ? "data-row" : "data-col"),
    10,
  );
  if (Number.isNaN(index)) return null;

  return { type, index, tableBlockUid };
}

/** Close any open Roam/Blueprint popover and drop the caret out of the table cell so
 *  keystrokes go to the dialog input (not the last-focused cell). */
function dismissTableMenuAndBlur() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
    }),
  );
  try {
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
    window.getSelection && window.getSelection()?.removeAllRanges?.();
  } catch (error) {
    // ignore
  }
}

/** Resolve the current main-view uid and open the table auto-complete dialog for a target. */
async function openTableDialog(target, mode, initialModel) {
  dismissTableMenuAndBlur();

  let pageViewUid = null;
  try {
    pageViewUid =
      await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
  } catch (error) {
    // ignore — the "Current page" context option will simply have nothing to include
  }

  const titles = {
    row: "Live AI: auto-complete row",
    column: "Live AI: auto-complete column",
    "multi-row": "Live AI: generate rows",
    "multi-column": "Live AI: generate columns",
  };
  const labels = {
    row: "Fill the empty or [bracketed] cells of this row, guided by the column headers, an example row and your optional instructions:",
    column:
      "Fill the empty or [bracketed] cells of this column, guided by the header, an example value and your optional instructions:",
    "multi-row":
      "Generate new rows below this one, using the whole table (and any context) as a guide:",
    "multi-column":
      "Generate new columns (with AI-proposed headers), using the whole table (and any context) as a guide:",
  };

  openTableAutocompleteDialog({
    mode,
    title: titles[mode],
    label: labels[mode],
    initialModel,
    pageViewUid,
    onSubmit: async ({
      instructions,
      style,
      roamContext,
      includeAllRows,
      overwrite,
      rowCount,
      model,
      thinkingEnabled,
    }) => {
      try {
        if (mode === "row") {
          await autoCompleteTableRow({
            tableBlockUid: target.tableBlockUid,
            rowIndex: target.index,
            instructions,
            style,
            roamContext,
            includeAllRows,
            overwrite,
            model,
            thinkingEnabled,
          });
        } else if (mode === "column") {
          await autoCompleteTableColumn({
            tableBlockUid: target.tableBlockUid,
            colIndex: target.index,
            instructions,
            style,
            roamContext,
            includeAllRows,
            overwrite,
            model,
            thinkingEnabled,
          });
        } else if (mode === "multi-column") {
          await generateTableColumns({
            tableBlockUid: target.tableBlockUid,
            columnCount: rowCount,
            instructions,
            style,
            roamContext,
            model,
            thinkingEnabled,
          });
        } else {
          await generateTableRows({
            tableBlockUid: target.tableBlockUid,
            rowIndex: target.index,
            rowCount,
            instructions,
            style,
            roamContext,
            model,
            thinkingEnabled,
          });
        }
      } catch (error) {
        console.error("Live AI table auto-complete error:", error);
        AppToaster.show({
          message: `Live AI: table auto-complete failed: ${error.message}`,
          intent: "danger",
          timeout: 8000,
        });
      }
    },
  });
}

const noTableTargetToast = () =>
  AppToaster.show({
    message:
      "Live AI: couldn't identify the table row/column. Right-click the row or column handle and try again.",
    intent: "warning",
    timeout: 6000,
  });

/**
 * Build one bp3 menu-item <a> node (faBolt icon on the left). Left-click runs with the
 * current default model; right-click opens ModelsMenu at the cursor to pick a model for
 * this run. The bp3-popover-dismiss class lets Roam close its own menu on click.
 */
function buildTableMenuItemNode({ menuElement, mode, labelText, icon }) {
  const getDefaultModel = () =>
    extensionStorage.get("defaultModel") || undefined;

  return (
    <a
      className="bp3-menu-item bp3-popover-dismiss"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = getTableTargetFromMenu(menuElement);
        if (!target) return noTableTargetToast();
        await openTableDialog(target, mode, getDefaultModel());
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = getTableTargetFromMenu(menuElement);
        if (!target) return noTableTargetToast();
        ContextMenu.show(
          ModelsMenu({
            callback: async ({ model }) => {
              await openTableDialog(target, mode, model);
            },
            setModel: () => {},
          }),
          { left: e.clientX, top: e.clientY },
          null,
        );
      }}
    >
      <span className="bp3-icon">
        <FontAwesomeIcon icon={icon} />
      </span>
      <div className="bp3-text-overflow-ellipsis bp3-fill">{labelText}</div>
    </a>
  );
}

/**
 * Inject Live AI items into a Roam table row/column context menu (portal-rendered
 * .bp3-menu containing a .rm-table__delete-col item): "Live AI: auto-complete" in both
 * row and column menus, plus "Live AI: multi-rows auto-complete" in row menus only.
 */
function insertTableAutocompleteMenuItems(menuElement) {
  if (menuElement.querySelector(".livai-table-autocomplete-item")) return;
  if (!menuElement.querySelector(".rm-table__delete-col")) return;

  const isRow = !!menuElement.querySelector(
    ".bp3-icon-arrow-up, .bp3-icon-arrow-down",
  );
  const isColumn = !!menuElement.querySelector(
    ".bp3-icon-arrow-left, .bp3-icon-arrow-right, .bp3-icon-sort",
  );
  if (!isRow && !isColumn) return;

  const divider = document.createElement("li");
  divider.className = "bp3-menu-divider";
  menuElement.appendChild(divider);

  const mainItem = document.createElement("li");
  mainItem.className = "livai-table-autocomplete-item";
  ReactDOM.render(
    buildTableMenuItemNode({
      menuElement,
      mode: isRow ? "row" : "column",
      labelText: `Live AI: auto-complete/update ${isRow ? "row" : "column"}`,
      icon: faBolt,
    }),
    mainItem,
  );
  menuElement.appendChild(mainItem);

  if (isRow) {
    const multiItem = document.createElement("li");
    multiItem.className = "livai-table-multirow-item";
    ReactDOM.render(
      buildTableMenuItemNode({
        menuElement,
        mode: "multi-row",
        labelText: "Live AI: multi-rows auto-complete",
        icon: faLayerGroup,
      }),
      multiItem,
    );
    menuElement.appendChild(multiItem);
  }

  if (isColumn) {
    const multiItem = document.createElement("li");
    multiItem.className = "livai-table-multicol-item";
    ReactDOM.render(
      buildTableMenuItemNode({
        menuElement,
        mode: "multi-column",
        labelText: "Live AI: multi-column auto-complete",
        icon: faTableColumns,
      }),
      multiItem,
    );
    menuElement.appendChild(multiItem);
  }
}

/**
 * Right-click on a table's "+" add-row / add-col button → open the multi-row /
 * multi-column generate dialog for that table. These buttons live inside the table DOM
 * (not a portal menu), so we catch them with a document-level contextmenu listener.
 */
async function handleTableAddButtonContextMenu(e) {
  const addRowBtn = e.target?.closest?.(".rm-table__add-row-btn");
  const addColBtn = e.target?.closest?.(".rm-table__add-col-btn");
  if (!addRowBtn && !addColBtn) return;

  e.preventDefault();
  e.stopPropagation();

  const blockElement = (addRowBtn || addColBtn).closest(".rm-block");
  const tableBlockUid = blockElement?.getAttribute("data-block-uid");
  if (!tableBlockUid) return noTableTargetToast();

  const defaultModel = extensionStorage.get("defaultModel") || undefined;

  if (addRowBtn) {
    // Anchor on the last row so the generated rows are appended at the bottom.
    const model = getTableModel(tableBlockUid);
    const lastIndex = model && model.rows.length ? model.rows.length - 1 : 0;
    await openTableDialog(
      { type: "row", index: lastIndex, tableBlockUid },
      "multi-row",
      defaultModel,
    );
  } else {
    await openTableDialog(
      { type: "column", index: 0, tableBlockUid },
      "multi-column",
      defaultModel,
    );
  }
}

const stripBlockParens = (uid) => String(uid).replace(/[()]/g, "").trim();

/**
 * Show a small spinner inside each table cell that is about to be (re)generated.
 * `coords` is an array of { row, col, uid } (data-row/data-col in the rendered table).
 * Returns { remove(uid), removeAll() } so a cell's spinner can be cleared the moment
 * that cell is filled (progressive streaming), or all at once at the end.
 */
export function showCellSpinners(tableUid, coords) {
  const noop = { remove() {}, removeAll() {} };
  const tableElt =
    document.querySelector(
      `.roam-block-container[data-block-uid="${tableUid}"]`,
    ) || document.querySelector(`.rm-block[data-block-uid="${tableUid}"]`);
  if (!tableElt || !coords || !coords.length) return noop;

  const hosts = [];
  const hostByUid = new Map();
  coords.forEach(({ row, col, uid }) => {
    const td = tableElt.querySelector(
      `td[data-row="${row}"][data-col="${col}"]`,
    );
    if (!td) return;
    td.classList.add("livai-spinner-cell");
    const spinner = document.createElement("span");
    spinner.className = "livai-cell-spinner";
    td.appendChild(spinner);
    const host = { td, spinner };
    hosts.push(host);
    if (uid != null) hostByUid.set(stripBlockParens(uid), host);
  });

  const clear = (host) => {
    host.spinner.remove();
    host.td.classList.remove("livai-spinner-cell");
  };
  return {
    remove(uid) {
      const key = stripBlockParens(uid);
      const host = hostByUid.get(key);
      if (host) {
        clear(host);
        hostByUid.delete(key);
      }
    },
    removeAll() {
      hosts.forEach(clear);
    },
  };
}

/**
 * Briefly highlight the cells that were just filled/updated so the user can see what
 * changed. Runs after a short delay to let Roam render the new cell content first.
 */
export function revealCells(tableUid, coords) {
  if (!coords || !coords.length) return;
  setTimeout(() => {
    const tableElt =
      document.querySelector(
        `.roam-block-container[data-block-uid="${tableUid}"]`,
      ) || document.querySelector(`.rm-block[data-block-uid="${tableUid}"]`);
    if (!tableElt) return;
    coords.forEach(({ row, col }) => {
      const td = tableElt.querySelector(
        `td[data-row="${row}"][data-col="${col}"]`,
      );
      if (!td) return;
      td.classList.add("livai-cell-revealed");
      setTimeout(() => td.classList.remove("livai-cell-revealed"), 3500);
    });
  }, 180);
}

/**
 * Scan DOM and insert buttons for all query titles
 */
function processQueryTitles() {
  const queryTitles = document.querySelectorAll(".rm-query-title-text");
  queryTitles.forEach((titleElement) => {
    insertQueryChatButton(titleElement);
  });
}

/**
 * Connect the MutationObserver for query titles and :q settings menus
 */
export function connectQueryObserver() {
  // Disconnect any existing observer
  disconnectQueryObserver();

  const targetNode = document.querySelector(".roam-app");
  if (!targetNode) {
    console.warn("⚠️ connectQueryObserver: .roam-app not found");
    return;
  }

  // Process any existing query titles
  processQueryTitles();

  // Observer for native query titles (inside .roam-app)
  queryObserver = new MutationObserver((mutations) => {
    if (queryObserverDebounceTimer) {
      clearTimeout(queryObserverDebounceTimer);
    }
    queryObserverDebounceTimer = setTimeout(() => {
      processQueryTitles();
    }, 50);
  });

  queryObserver.observe(targetNode, {
    childList: true,
    subtree: true,
  });

  // Separate observer for :q settings menus rendered in portals (on document.body)
  // These .bp3-menu.rm-data-table__settings pop up in .bp3-portal outside .roam-app
  datomicMenuObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Check if the added node is or contains a :q settings menu
        const menu = node.matches?.(".rm-data-table__settings")
          ? node
          : node.querySelector?.(".rm-data-table__settings");
        if (menu) {
          insertDatomicQueryChatMenuItem(menu);
        }
      }
    }
  });

  datomicMenuObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Separate observer for Roam table row/column context menus (portal-rendered .bp3-menu
  // containing a .rm-table__delete-col item) to inject "Auto-complete with AI".
  tableMenuObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const deleteItem = node.matches?.(".rm-table__delete-col")
          ? node
          : node.querySelector?.(".rm-table__delete-col");
        if (deleteItem) {
          const menu = deleteItem.closest(".bp3-menu");
          if (menu) insertTableAutocompleteMenuItems(menu);
        }
      }
    }
  });

  tableMenuObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Right-click on a table's "+" add-row / add-col buttons → generate rows/columns.
  document.addEventListener(
    "contextmenu",
    handleTableAddButtonContextMenu,
    true,
  );

  console.log("✅ Query observer connected");
}

/**
 * Disconnect the query observer
 */
export function disconnectQueryObserver() {
  if (queryObserver) {
    queryObserver.disconnect();
    queryObserver = null;
  }
  if (datomicMenuObserver) {
    datomicMenuObserver.disconnect();
    datomicMenuObserver = null;
  }
  if (tableMenuObserver) {
    tableMenuObserver.disconnect();
    tableMenuObserver = null;
  }
  document.removeEventListener(
    "contextmenu",
    handleTableAddButtonContextMenu,
    true,
  );
  if (queryObserverDebounceTimer) {
    clearTimeout(queryObserverDebounceTimer);
    queryObserverDebounceTimer = null;
  }
}
