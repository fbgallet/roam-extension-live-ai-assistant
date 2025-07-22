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

export const MCPToaster = Toaster.create({
  className: "mcp-toaster",
  position: Position.TOP_RIGHT,
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
    addButtonsToToaster(toastId, ".thinking-toaster", ThinkingToaster);
  }
  return thinkingToasterStream;
};

export const displayMCPToast = (message = "") => {
  const toastId = MCPToaster.show({
    message,
    timeout: 0,
    isCloseButtonShown: false,
  });

  // Use requestAnimationFrame to wait for DOM update, then setTimeout for render completion
  setTimeout(() => {
    const mcpToasterStream = document.querySelector(
      ".mcp-toaster .bp3-toast-message"
    );
    if (mcpToasterStream) {
      // mcpToasterStream.innerText = message + `\n\n`;
      addButtonsToToaster(toastId, ".mcp-toaster", MCPToaster);

      // Store the element globally so it can be accessed later
      window.mcpToasterStreamElement = mcpToasterStream;
    }
  }, 50); // Slightly longer delay to ensure full render

  // Return a function that retrieves the element
  const getToasterElement = () => {
    return (
      window.mcpToasterStreamElement ||
      document.querySelector(".mcp-toaster .bp3-toast-message")
    );
  };

  return getToasterElement();
};

const addButtonsToToaster = (toastId, toasterSelector, toasterInstance) => {
  const toasterElt = document.querySelector(`${toasterSelector} .bp3-toast`);
  if (!toasterElt) return;
  const newDiv = document.createElement("div");
  newDiv.classList.add("buttons");
  toasterElt.appendChild(newDiv);

  const props = { minimal: true, size: "small" };

  const buttonSectionJSX = (
    <>
      <Button
        text="Copy to clipboard"
        {...props}
        intent="primary"
        onClick={() => {
          const msgElt = toasterElt.querySelector(".bp3-toast-message");
          navigator.clipboard.writeText(msgElt.innerText);
        }}
      />
      <Button text="Close" {...props} onClick={() => toasterInstance.clear()} />
    </>
  );

  ReactDOM.render(buttonSectionJSX, newDiv);
};
