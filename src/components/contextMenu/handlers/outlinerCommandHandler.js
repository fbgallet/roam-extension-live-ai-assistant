import {
  checkOutlineAvailabilityOrOpen,
  insertNewOutline,
  invokeOutlinerAgent,
} from "../../../ai/agents/outliner-agent/invoke-outliner-agent";
import {
  setAsOutline,
  toggleOutlinerSelection,
} from "../../../utils/domElts";
import { extensionStorage } from "../../..";
import { hasTrueBooleanKey } from "../../../utils/dataProcessing";

/**
 * Handles outliner-specific commands
 */
export const handleOutlinerCommand = async ({
  command,
  focusedBlockUid,
  positionInRoamWindow,
  setRootUid,
  updateOutlineSelectionCommand,
  rootUid,
  getInstantPrompt,
  roamContext,
  model,
  style,
  e,
  prompt,
}) => {
  if (command.category === "MY LIVE OUTLINES") {
    checkOutlineAvailabilityOrOpen(
      command.prompt,
      positionInRoamWindow.current
    );
    await extensionStorage.set("outlinerRootUid", command.prompt);
    setRootUid(command.prompt);
    updateOutlineSelectionCommand({ isToSelect: false });
    return true;
  }

  if (command.category === "MY OUTLINE TEMPLATES") {
    await insertNewOutline(
      focusedBlockUid.current,
      command.prompt,
      positionInRoamWindow.current
    );
    setRootUid(extensionStorage.get("outlinerRootUid"));
    updateOutlineSelectionCommand({ isToSelect: false });
    return true;
  }

  if (command.id === 20) {
    await handleOutlineSelection(rootUid, setRootUid, updateOutlineSelectionCommand);
    return true;
  }

  if (command.id === 22) {
    await insertNewOutline(
      focusedBlockUid.current,
      null,
      positionInRoamWindow.current
    );
    setRootUid(extensionStorage.get("outlinerRootUid"));
    updateOutlineSelectionCommand({ isToSelect: false });
    return true;
  }

  // Handle other outliner prompts
  if (rootUid) {
    await invokeOutlinerAgent({
      e,
      sourceUid: focusedBlockUid.current,
      rootUid,
      prompt: prompt || getInstantPrompt(),
      context: hasTrueBooleanKey(roamContext) ? roamContext : null,
      model,
      style,
    });
    return true;
  }

  return false;
};

export const handleOutlineSelection = async (rootUid, setRootUid, updateOutlineSelectionCommand) => {
  // Note: This function needs access to commands state to find command with id 20
  // Will need to be passed as parameter or accessed differently
  const outlinerCommand = { name: rootUid ? "Disable current Live Outline" : "Set as active Live Outline" };
  const isSelectCmd = !outlinerCommand.name?.includes("Disable");
  
  if (isSelectCmd) {
    await setAsOutline();
    setRootUid(extensionStorage.get("outlinerRootUid"));
    updateOutlineSelectionCommand({ isToSelect: false });
  } else {
    toggleOutlinerSelection(rootUid, false);
    await extensionStorage.set("outlinerRootUid", null);
    setRootUid(null);
    updateOutlineSelectionCommand({ isToSelect: true });
  }
};