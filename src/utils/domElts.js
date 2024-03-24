import React from "react";
import ReactDOM from "react-dom";
import InstantButtons from "../components/InstantButtons";

export const displaySpinner = async (targetUid) => {
  let targetBlockElt, spinner, intervalId;
  setTimeout(() => {
    targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);
    const previousSpinner = targetBlockElt.querySelector(".speech-spinner");
    if (previousSpinner) previousSpinner.remove();
    spinner = document.createElement("strong");
    spinner.classList.add("speech-spinner");
    if (targetBlockElt) targetBlockElt.appendChild(spinner);
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
  const spinner = document.querySelector(".speech-spinner");
  if (spinner) spinner.remove();
};

export const insertParagraphForStream = (targetUid) => {
  const targetBlockElt = document.querySelector(`[id*="${targetUid}"]`);
  const previousStreamElt = targetBlockElt.querySelector(".speech-stream");
  if (previousStreamElt) previousStreamElt.remove();
  const streamElt = document.createElement("p");
  streamElt.classList.add("speech-stream");
  if (targetBlockElt) targetBlockElt.appendChild(streamElt);
  displaySpinner(targetUid);
  return streamElt;
};

export const insertInstantButtons = (props) => {
  const targetBlockElt = document.querySelector(`[id*="${props.targetUid}"]`);
  const previousContainer = targetBlockElt.parentElement.querySelector(
    ".speech-instant-container"
  );
  let container;
  if (previousContainer) {
    ReactDOM.unmountComponentAtNode(previousContainer);
    container = previousContainer;
  } else {
    container = document.createElement("div");
    container.classList.add("speech-instant-container");
    targetBlockElt.insertAdjacentElement("afterend", container);
  }
  ReactDOM.render(<InstantButtons {...props} />, container);
};
