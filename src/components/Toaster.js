import { Button, Intent, Position, Toaster } from "@blueprintjs/core";
import ReactDOM from "react-dom";

export const AppToaster = Toaster.create({
  className: "color-toaster",
  position: Position.TOP,
  intent: Intent.WARNING,
  icon: "warning-sign",
  maxToasts: 1,
  timeout: 12000,
});

export const AgentToaster = Toaster.create({
  className: "search-agent-toaster",
  position: Position.TOP,
  intent: Intent.NONE,
  icon: "form",
  maxToasts: 1,
});

export const ThinkingToaster = Toaster.create({
  className: "thinking-toaster",
  position: Position.TOP,
  intent: Intent.NONE,
  isCloseButtonShown: false,
  canEscapeKeyClear: true,
  maxToasts: 1,
});

export const displayThinkingToast = (message = "") => {
  const toastId = ThinkingToaster.show({
    message,
    timeout: 0,
    isCloseButtonShown: false,
  });
  const thinkingToasterStream = document.querySelector(
    ".thinking-toaster .bp3-toast-message"
  );
  if (thinkingToasterStream) {
    thinkingToasterStream.innerText += `\n\n`;
    addButtonsToThinkingToaster(toastId);
  }
  return thinkingToasterStream;
};

const addButtonsToThinkingToaster = (toaster) => {
  const thinkingToasterElt = document.querySelector(
    ".thinking-toaster .bp3-toast"
  );
  if (!thinkingToasterElt) return;
  const newDiv = document.createElement("div");
  newDiv.classList.add("buttons");
  thinkingToasterElt.appendChild(newDiv);

  const props = { minimal: true, size: "small" };

  const buttonSectionJSX = (
    <>
      <Button
        text="Copy to clipboard"
        {...props}
        intent="primary"
        onClick={() => {
          const msgElt = thinkingToasterElt.querySelector(".bp3-toast-message");
          navigator.clipboard.writeText(msgElt.innerText);
        }}
      />
      <Button text="Close" {...props} onClick={() => ThinkingToaster.clear()} />
    </>
  );

  ReactDOM.render(buttonSectionJSX, newDiv);
};
