import {
  chatRoles,
  defaultModel,
  defaultStyle,
  extensionStorage,
  getInstantAssistantRole,
  isUsingWhisper,
} from "..";
import {
  aiCompletionRunner,
  copyTemplate,
  getStylePrompt,
  insertCompletion,
} from "../ai/responseInsertion";
import { specificContentPromptBeforeTemplate } from "../ai/prompts";
import {
  displayTokensDialog,
  setAsOutline,
  simulateClick,
  simulateClickOnRecordingButton,
  toggleComponentVisibility,
} from "./domElts";
import {
  createChildBlock,
  extractNormalizedUidFromRef,
  filterTopLevelBlocks,
  getFirstChildUid,
  resolveReferences,
} from "./roamAPI";
import { invokeNLQueryInterpreter } from "../ai/agents/nl-query";
import { invokeNLDatomicQueryInterpreter } from "../ai/agents/nl-datomic-query";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent/invoke-outliner-agent";
import { invokeMCPAgent } from "../ai/agents/mcp-agent/invoke-mcp-agent";
import { invokeSearchAgent } from "../ai/agents/search-agent/ask-your-graph-invoke";
import { mcpManager } from "../ai/agents/mcp-agent/mcpManager";
import {
  getContextFromSbCommand,
  getFlattenedContentFromTree,
  getFocusAndSelection,
  getTemplateForPostProcessing,
  handleModifierKeys,
} from "../ai/dataExtraction";
import { flexibleUidRegex, sbParamRegex } from "./regex";
import { openChatPopup } from "../components/full-results-popup";

export const loadRoamExtensionCommands = (extensionAPI) => {
  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Start/Pause recording vocal note",
    callback: () => {
      simulateClickOnRecordingButton();
    },
  });
  extensionAPI.ui.commandPalette.addCommand({
    label: `Live AI: Transcribe vocal note`,
    callback: () => {
      const button = document.getElementsByClassName("speech-transcribe")[0];
      if (button) {
        button.focus();
        button.click();
        if (
          !isComponentVisible &&
          document.getElementsByClassName("speech-to-roam")[0]?.style
            .display !== "none"
        )
          toggleComponentVisibility();
      } else simulateClickOnRecordingButton();
    },
  });
  // DEPRECATED IN V.12
  // extensionAPI.ui.commandPalette.addCommand({
  //   label: "Live AI: Translate to English",
  //   callback: () => {
  //     const button = document.getElementsByClassName("speech-translate")[0];
  //     if (button) {
  //       button.focus();
  //       button.click();
  //       if (
  //         !isComponentVisible &&
  //         document.getElementsByClassName("speech-to-roam")[0]?.style
  //           .display !== "none"
  //       )
  //         toggleComponentVisibility();
  //     } else simulateClickOnRecordingButton();
  //   },
  // });
  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Ask AI by voice",
    callback: () => {
      const button = document.getElementsByClassName("speech-completion")[0];
      if (button) {
        button.focus();
        button.click();
        if (
          !isComponentVisible &&
          document.getElementsByClassName("speech-to-roam")[0]?.style
            .display !== "none"
        )
          toggleComponentVisibility();
      } else simulateClickOnRecordingButton();
    },
  });

  // DEPRECATED IN V.12
  // extensionAPI.ui.commandPalette.addCommand({
  //   label:
  //     "Live AI: Transcribe & send as prompt to Outliner Agent",
  //   callback: () => {
  //     const button = document.getElementsByClassName(
  //       "speech-post-processing"
  //     )[0];
  //     if (button) {
  //       button.focus();
  //       button.click();
  //       if (
  //         !isComponentVisible &&
  //         document.getElementsByClassName("speech-to-roam")[0]?.style
  //           .display !== "none"
  //       )
  //         toggleComponentVisibility();
  //     } else simulateClickOnRecordingButton();
  //   },
  // });

  // Deprecated, replaced by an option in settings
  // extensionAPI.ui.commandPalette.addCommand({
  //   label:
  //     "Live AI: Toggle visibility of the button (not permanently)",
  //   callback: () => {
  //     isComponentVisible = !isComponentVisible;
  //     unmountComponent(position);
  //     mountComponent(position);
  //     toggleComponentVisibility();
  //   },
  // });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Outliner Agent, set active outline or apply prompt",
    callback: async (e) => {
      const focusedUid =
        window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
      const isOutlineActive = extensionStorage.get("outlinerRootUid");
      if (!isOutlineActive) {
        await setAsOutline(focusedUid);
        return;
      }
      invokeOutlinerAgent({
        e,
        //   sourceUid: window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"],
      });
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Tokens usage and cost overview",
    callback: () => {
      setTimeout(() => {
        displayTokensDialog();
      }, 100);
    },
  });

  const openContextMenu = (blockUid) => {
    setTimeout(() => {
      const centerX = window.innerWidth / 4 - 150;
      const centerY = window.innerHeight / 5;
      window.LiveAI.toggleContextMenu({
        e: { clientX: centerX, clientY: centerY },
        focusUid: blockUid ? blockUid : undefined,
      });
    }, 50);
  };

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Ask AI (prompt in focused/selected blocks)",
    callback: async (e) => {
      aiCompletionRunner({
        e,
        sourceUid: window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"],
      });
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Context menu (all commands & built-in prompts)",
    "default-hotkey": "ctrl-super-a",
    callback: (e) => openContextMenu(),
  });

  // Deprecated, not very usefull !
  // window.roamAlphaAPI.ui.blockContextMenu.addCommand({
  //   label: "Live AI context menu",
  //   callback: (e) => openContextMenu(e["block-uid"]),
  // });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Natural language Query Agent",
    callback: async () => {
      let { currentUid, currentBlockContent } = getFocusAndSelection();
      await invokeNLQueryInterpreter({
        rootUid: currentUid,
        prompt: currentBlockContent,
      });
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Natural language Datomic :q Agent",
    callback: async () => {
      let { currentUid, currentBlockContent } = getFocusAndSelection();
      await invokeNLDatomicQueryInterpreter({
        rootUid: currentUid,
        prompt: currentBlockContent,
      });
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: View results (last Ask Your Graph query)",
    callback: () => {
      // Use shared utility function from FullResultsPopup
      import("../components/full-results-popup")
        .then(({ openLastAskYourGraphResults }) => {
          openLastAskYourGraphResults();
        })
        .catch(() => {
          alert("Could not load FullResultsPopup functionality");
        });
    },
  });

  extensionAPI.ui.commandPalette.addCommand({
    label: "Live AI: Open Chat panel",
    callback: async (e) => {
      const { currentUid, selectionUids } = getFocusAndSelection();

      let roamContext = {};
      if (selectionUids.length) {
        const topLevelBlocks = filterTopLevelBlocks(selectionUids);
        roamContext.block = true;
        roamContext.blockArgument = [...topLevelBlocks];
      }
      openChatPopup({
        rootUid: currentUid,
        roamContext,
        viewMode: "chat-only",
      });
    },
  });

  // Add SmartBlock command
  const speechCmd = {
    text: "LIVEAIVOICE",
    help: "Start recording a vocal note using Speech-to-Roam extension",
    handler: (context) => () => {
      simulateClickOnRecordingButton();
      return [""];
    },
  };
  const menuCmd = {
    text: "LIVEAIMENU",
    help: "Open Live AI context menu",
    handler: (sbContext) => () => {
      const centerX = window.innerWidth / 2 - 250;
      const centerY = window.innerHeight / 5;
      window.LiveAI.toggleContextMenu({
        e: { clientX: centerX, clientY: centerY },
        focusUid: sbContext.currentUid,
      });
      return [""];
    },
  };
  const chatCmd = {
    text: "LIVEAIGEN",
    help: `Live AI text generation and chat.
      \nParameters:
      \n1: prompt (text | block ref | {current} | {ref1+ref2+...}, default: {current} block content)
      \n2: context or content to apply the prompt to (text | block ref | {current} | {children} | {ref1+ref2+...} | defined context, ex. {page(name)+ref(name)})
      \n3: target block reference | {replace[-]} | {append} (default: first child)
      \n4: model (model ID or void string or "default" for default Live AI model)
      \n5: levels within the refs/log to include in the context (number, default fixed in settings)
      \n6: includes all block references in context (true/false, default: false)`,
    handler:
      (sbContext) =>
      async (
        prompt = "{current}",
        context,
        target,
        model,
        contextDepth,
        includeRefs = "false"
      ) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        let {
          stringifiedPrompt,
          targetUid,
          stringifiedContext,
          instantModel,
          toAppend,
        } = await getInfosFromSmartBlockParams({
          sbContext,
          prompt,
          context,
          target,
          model,
          contextDepth,
          includeRefs,
        });

        insertCompletion({
          systemPrompt: await getStylePrompt(defaultStyle),
          prompt: stringifiedPrompt,
          targetUid,
          context: stringifiedContext,
          instantModel: instantModel || model,
          typeOfCompletion: "gptCompletion",
          isInConversation: false,
        });
        return [toAppend];
      },
  };

  const templateCmd = {
    text: "LIVEAITEMPLATE",
    help: `Live AI response following a template.
      \nParameters:
      \n1: template ({children} or block ref, default: children blocks)
      \n2: context or content to apply the prompt to (text | block ref | {current} | {children} | {ref1+ref2+...} | defined context, ex. {page(name)+ref(name)})
      \n3: target block reference (default: first child)
      \n4: model (model ID or void string or "default" for default Live AI model)
      \n5: levels within the refs/log to include in the context (number, default fixed in settings)
      \n6: includes all block references in context (true/false, default: false)`,
    handler:
      (sbContext) =>
      async (
        template = "{children}",
        context,
        target,
        model,
        contextDepth,
        includeRefs = "false"
      ) => {
        const assistantRole = model
          ? getInstantAssistantRole(model)
          : chatRoles?.assistant || "";
        const currentUid = sbContext.currentUid;
        let { currentBlockContent, selectionUids } =
          getFocusAndSelection(currentUid);
        let targetUid;
        let uidsToExclude = [];
        // disabled option to extract only a limited amount of levels in the prompt
        // depth = depth && !isNaN(depth) ? parseInt(depth) : undefined;

        if (target) targetUid = extractNormalizedUidFromRef(target.trim());

        let delay = 0;

        if (template.trim() && template !== "{children}") {
          const templateUid = extractNormalizedUidFromRef(template.trim());
          uidsToExclude = await copyTemplate(
            targetUid || currentUid,
            templateUid,
            99 //depth
          );
          delay = 100;
        }

        setTimeout(async () => {
          template = await getTemplateForPostProcessing(
            targetUid || currentUid,
            99, //depth,
            uidsToExclude
          );
          template =
            specificContentPromptBeforeTemplate +
            currentBlockContent +
            "\n\n" +
            template.stringified;

          context = await getContextFromSbCommand(
            context,
            currentUid,
            selectionUids,
            contextDepth,
            includeRefs
          );

          if (!targetUid) targetUid = getFirstChildUid(currentUid);

          insertCompletion({
            prompt: template,
            targetUid,
            context,
            instantModel: model,
            typeOfCompletion: "gptPostProcessing",
            isInConversation: false,
          });
        }, delay);
        return [currentBlockContent ? "" : assistantRole];
      },
  };

  const agentCmd = {
    text: "LIVEAIAGENT",
    help: `Live AI Agent calling.
      \nParameters:
      \n1: Agent name (nlquery, qquery or datomic, mcp:servername, search or askyourgraph)
      \n2: prompt (text | block ref | {current} | {ref1+ref2+...}, default: {current} block content)
      \n2: context or content to apply the prompt to (text | block ref | {current} | {children} | {ref1+ref2+...} | defined context, ex. {page(name)+ref(name)})
      \n3: target block reference (default: first child)
      \n4: model (model ID or void string or "default" for default Live AI model)`,
    handler:
      (sbContext) =>
      async (agent, prompt = "{current}", context, target, model) => {
        const currentUid = sbContext.currentUid;
        await new Promise((resolve) => setTimeout(resolve, 100));
        let { stringifiedPrompt, targetUid, stringifiedContext, instantModel } =
          await getInfosFromSmartBlockParams({
            sbContext,
            prompt,
            context,
            target,
            model,
            isRoleToInsert: false,
          });
        let agentName = agent.toLowerCase().trim().replace("agent", "");
        let mcpServerName = null;

        // Check if it's MCP with server name format: "mcp:server name"
        if (agentName.startsWith("mcp:")) {
          mcpServerName = agentName.substring(4).trim(); // Remove "mcp:" prefix
          agentName = "mcp";
        }

        switch (agentName) {
          case "nlquery":
            await invokeNLQueryInterpreter({
              model: instantModel || model,
              currentUid,
              targetUid,
              prompt: stringifiedPrompt,
            });
            break;
          case "qquery":
          case "datomic":
            await invokeNLDatomicQueryInterpreter({
              model: instantModel || model,
              rootUid: currentUid,
              targetUid,
              prompt: stringifiedPrompt,
            });
            break;
          case "mcp":
            // For MCP agent, find server by name if specified
            const connectedServers = mcpManager.getConnectedServers();
            if (connectedServers.length === 0) {
              return "ERROR: No MCP servers connected. Please configure an MCP server first.";
            }

            let targetServer;
            if (mcpServerName) {
              // Find server by name (case insensitive, partial match)
              targetServer = connectedServers.find((server) =>
                server.name.toLowerCase().includes(mcpServerName.toLowerCase())
              );
              if (!targetServer) {
                return `ERROR: MCP server containing "${mcpServerName}" not found. Available servers: ${connectedServers
                  .map((s) => s.name)
                  .join(", ")}`;
              }
            } else {
              // Use first available server if no specific server name provided
              targetServer = connectedServers[0];
            }

            await invokeMCPAgent({
              model: instantModel || model,
              rootUid: currentUid,
              targetUid,
              prompt: stringifiedPrompt,
              serverId: targetServer.serverId,
              serverName: targetServer.name,
            });
            break;
          case "askyourgraph":
          case "search":
            await invokeSearchAgent({
              model: instantModel || model,
              rootUid: currentUid,
              targetUid,
              target: "",
              prompt: stringifiedPrompt,
            });
            break;
          default:
            return "ERROR: a correct agent name is needed as first parameter of this SmartBlock. Available agents: nlquery, qquery or datomic, mcp:servername, search or askyourgraph.";
        }
        return "";
      },
  };

  if (window.roamjs?.extension?.smartblocks) {
    window.roamjs.extension.smartblocks.registerCommand(speechCmd);
    window.roamjs.extension.smartblocks.registerCommand(menuCmd);
    window.roamjs.extension.smartblocks.registerCommand(chatCmd);
    window.roamjs.extension.smartblocks.registerCommand(templateCmd);
    window.roamjs.extension.smartblocks.registerCommand(agentCmd);
  } else {
    document.body.addEventListener(`roamjs:smartblocks:loaded`, () => {
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(speechCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(menuCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(chatCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(templateCmd);
      window.roamjs?.extension.smartblocks &&
        window.roamjs.extension.smartblocks.registerCommand(agentCmd);
    });
  }
};

const getInfosFromSmartBlockParams = async ({
  sbContext,
  prompt,
  context,
  target,
  model,
  contextDepth,
  includeRefs,
  isRoleToInsert = true,
}) => {
  if (!model || model === "default") model = defaultModel;
  const assistantRole = isRoleToInsert
    ? model
      ? getInstantAssistantRole(model)
      : chatRoles?.assistant || ""
    : "";
  const currentUid = sbContext.currentUid;
  let currentBlockContent = sbContext.currentContent;
  let { selectionUids } = getFocusAndSelection(currentUid);
  let toAppend = "";
  let targetUid;
  let isContentToReplace = false;

  let stringifiedPrompt = "";
  if (sbParamRegex.test(prompt) || flexibleUidRegex.test(prompt)) {
    if (sbParamRegex.test(prompt)) prompt = prompt.slice(1, -1);
    const splittedPrompt = prompt.split("+");
    splittedPrompt.forEach((subPrompt) => {
      if (subPrompt === "current")
        stringifiedPrompt +=
          (stringifiedPrompt ? "\n\n" : "") + currentBlockContent;
      else {
        const promptUid = extractNormalizedUidFromRef(subPrompt);
        if (promptUid) {
          stringifiedPrompt +=
            (stringifiedPrompt ? "\n\n" : "") +
            getFlattenedContentFromTree({
              parentUid: promptUid,
              maxCapturing: 99,
              maxUid: 0,
              withDash: true,
            });
        } else
          stringifiedPrompt += (stringifiedPrompt ? "\n\n" : "") + subPrompt;
      }
    });
  } else stringifiedPrompt = resolveReferences(prompt);
  prompt = stringifiedPrompt;

  context =
    context === "{current}"
      ? currentBlockContent
      : await getContextFromSbCommand(
          context,
          currentUid,
          selectionUids,
          contextDepth,
          includeRefs,
          model
        );

  if ((!target && !currentBlockContent.trim()) || target === "{current}") {
    target = "{replace}";
  }

  if (target && target.slice(0, 8) === "{append:") {
    toAppend = target.slice(8, -1);
    target = "{append}";
  }

  switch (target) {
    case "{replace}":
    case "{replace-}":
      isContentToReplace = true;
      simulateClick(document.querySelector(".roam-body-main"));
    case "{append}":
      targetUid = currentUid;
      break;
    default:
      const uid = target ? extractNormalizedUidFromRef(target.trim()) : "";
      targetUid = uid || (await createChildBlock(currentUid, assistantRole));
  }
  if (isContentToReplace) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await window.roamAlphaAPI.updateBlock({
      block: {
        uid: targetUid,
        string: target === "{replace-}" ? "" : assistantRole,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    stringifiedPrompt: prompt,
    targetUid,
    stringifiedContext: context,
    instantModel: model,
    toAppend,
  };
};
