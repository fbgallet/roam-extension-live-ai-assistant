import { useState, useEffect, useRef } from "react";
import { ContextMenu, Tooltip } from "@blueprintjs/core";

import {
  faMicrophone,
  faMicrophoneSlash,
  faRecordVinyl,
  faBackwardStep,
  faWandMagicSparkles,
  faLanguage,
  faListUl,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Intent, Position, Toaster } from "@blueprintjs/core";
import { closeStream, getStream, newMediaRecorder } from "../audio/audio.js";
import {
  copyTemplate,
  getTemplateForPostProcessing,
  insertCompletion,
  isPromptInConversation,
  transcribeAudio,
  translateAudio,
} from "../ai/aiCommands.js";
import {
  addContentToBlock,
  cleanFlagFromBlocks,
  createChildBlock,
  createSiblingBlock,
  getAndNormalizeContext,
  getBlockContentByUid,
  getBlocksSelectionUids,
  getFirstChildUid,
  getParentBlock,
  getResolvedContentFromBlocks,
  getTemplateFromPrompt,
  highlightHtmlElt,
  insertBlockInCurrentView,
  isCurrentPageDNP,
  isLogView,
  resolveReferences,
} from "../utils/utils.js";
import Timer from "./Timer.jsx";
import {
  chatRoles,
  getInstantAssistantRole,
  defaultModel,
  isSafari,
  isTranslateIconDisplayed,
  isUsingWhisper,
  openaiLibrary,
  isResponseToSplit,
} from "../index.js";
import MicRecorder from "../audio/mic-recorder.js";
import OpenAILogo from "./OpenAILogo.jsx";
import ModelsMenu from "./ModelsMenu.jsx";
import {
  displaySpinner,
  removeSpinner,
  toggleComponentVisibility,
} from "../utils/domElts.js";
import { specificContentPromptBeforeTemplate } from "../ai/prompts.js";
import TokensDisplay from "./TokensDisplay.jsx";
import TokensDialog from "./TokensDisplay.jsx";

export const AppToaster = Toaster.create({
  className: "color-toaster",
  position: Position.TOP,
  intent: Intent.WARNING,
  icon: "warning-sign",
  maxToasts: 1,
  timeout: 12000,
});

function VoiceRecorder({
  blockUid,
  startRecording,
  transcribeOnly,
  translateOnly,
  completionOnly,
  mic,
  position,
  worksOnPlatform,
  isVisible,
}) {
  const [isWorking, setIsWorking] = useState(
    worksOnPlatform ? (mic === null && !isUsingWhisper ? false : true) : false
  );
  const [isListening, setIsListening] = useState(startRecording ? true : false);
  const [isToDisplay, setIsToDisplay] = useState({
    transcribeIcon: !translateOnly && !completionOnly,
    translateIcon:
      !transcribeOnly && !completionOnly && isTranslateIconDisplayed,
    completionIcon: !translateOnly && !transcribeOnly,
  });
  const [time, setTime] = useState(0);
  const [areCommandsToDisplay, setAreCommandsToDisplay] = useState(false);

  const isToTranscribe = useRef(false);
  const stream = useRef(null);
  const audioChunk = useRef([]);
  const record = useRef(null);
  const mediaRecorderRef = useRef(null);
  const safariRecorder = useRef(
    isSafari
      ? new MicRecorder({
          bitRate: 128,
        })
      : null
  );
  const instantVoiceReco = useRef(null);
  const lastCommand = useRef(null);
  const startBlock = useRef(blockUid);
  const targetBlock = useRef(null);
  const blocksSelectionUids = useRef(null);
  const roamContext = useRef({
    linkedRefs: false,
    sidebar: false,
    mainPage: false,
    logPages: false,
    logPagesNb: null,
  });
  const instantModel = useRef(null);

  useEffect(() => {
    return () => {
      if (isSafari) {
        safariRecorder.current.stop();
      } else {
        closeStream(stream.current);
      }
    };
  }, []);

  useEffect(() => {
    let interval = null;

    handleListen();

    if (isListening) {
      interval = setInterval(() => {
        setTime((time) => time + 10);
      }, 10);
    } else {
      clearInterval(interval);
    }
    return () => {
      clearInterval(interval);
    };
  }, [isListening]);

  const handleRecord = async (e) => {
    if (!worksOnPlatform) {
      handleRecordNotAvailable();
    }
    e.preventDefault();
    let currentBlock = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
    if (!isListening && currentBlock) startBlock.current = currentBlock;
    if (!isListening && !blocksSelectionUids.current)
      blocksSelectionUids.current = getBlocksSelectionUids();
    if (window.innerWidth < 500 && position === "left") {
      window.roamAlphaAPI.ui.leftSidebar.close();
    }
    if (stream.current || (isSafari && safariRecorder.current.isInitialized))
      setIsListening((prevState) => !prevState);
    else {
      if (isSafari) {
        await safariRecorder.current.initialize();
        setIsListening((prevState) => !prevState);
      } else {
        stream.current = await getStream();
        setIsListening((prevState) => !prevState);
      }
    }
  };

  const handleRecordNotAvailable = () => {
    AppToaster.show({
      message:
        "Recording isn't currently supported on this platform (Roam Mac Desktop App or Mobile app). You can still use text-only commands. See documentation.",
      timeout: 15000,
    });
  };

  const handleListen = () => {
    if (isListening) {
      // recognition if not in Electron App or Firefox browser
      if (mic) {
        try {
          mic.start();
        } catch (error) {
          console.log(error.message);
        }
        mic.onend = () => {
          // console.log("continue...");
          try {
            mic.start();
          } catch (error) {
            console.log(error.message);
          }
        };
      }
      startRec();
    } else {
      // recognition
      if (mic) {
        mic.stop();
        mic.onend = () => {
          console.log("Stopped Mic on Click");
        };
      }
      stopRec();
    }
    if (mic) {
      mic.onstart = () => {
        // console.log("Mics on");
      };
      mic.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0])
          .map((result) => result.transcript)
          .join("");
        // console.log(transcript);
        instantVoiceReco.current = transcript;
        mic.onerror = (event) => {
          console.log(event.error);
        };
      };
    }
  };

  const handleKeys = async (e) => {
    e.preventDefault();
    if (e.code === "Escape" || e.code === "Backspace") {
      handleBackward(e);
      return;
    }
    if (e.code === "Space") {
      setIsListening((prevState) => !prevState);
      return;
    }
    if (e.code === "Enter") {
      if (translateOnly) {
        handleTranslate(e);
        return;
      } else if (completionOnly) {
        handleCompletion(e);
        return;
      }
      handleTranscribe(e);
    }
    if (e.key.toLowerCase() === "t") {
      handleTranscribe(e);
      return;
    }
    if (e.key.toLowerCase() === "e") {
      handleTranslate(e);
      return;
    }
    if (e.keyCode === 67) {
      // "c", to make it compatible with modifiers
      handleCompletion(e);
      return;
    }
    if (e.keyCode === 80) {
      // "p", to make it compatible with modifiers
      handlePostProcessing(e);
    }
  };

  const handleEltHighlight = async (e) => {
    if (e.shiftKey) {
      highlightHtmlElt("#roam-right-sidebar-content");
    }
    if (e.metaKey || e.ctrlKey) {
      if (isLogView()) highlightHtmlElt(".roam-log-container");
      else if (await isCurrentPageDNP()) highlightHtmlElt(".rm-title-display");
      else highlightHtmlElt(".rm-reference-main");
    }
    if (e.altKey) {
      highlightHtmlElt(".roam-article > div:first-child");
    }
  };

  const startRec = async () => {
    console.log("Start to record");

    if (isSafari) {
      safariRecorder.current
        .start()
        .then(() => {
          console.log("recording");
        })
        .catch((e) => {
          console.error(e);
        });
    } else {
      if (!stream.current) stream.current = await getStream();
      mediaRecorderRef.current = newMediaRecorder(
        audioChunk.current,
        stream.current /*? stream.current : await getStream()*/
      );
      mediaRecorderRef.current.start();

      mediaRecorderRef.current.onstop = (e) => {
        console.log("Mediarecord stopped");
        const audioBlob = new Blob(audioChunk.current);
        const audioFile = new File([audioBlob], "audio.webm", {
          type: "audio/webm",
        });
        if (audioFile.size) {
          record.current = audioFile;
        }
        if (isToTranscribe.current) voiceProcessing();
      };
    }
    setAreCommandsToDisplay(true);
  };

  const stopRec = () => {
    if (isSafari) {
      safariRecorder.current
        .pause()
        .then(() => {
          console.log("in pause");
          if (isToTranscribe.current) voiceProcessing();
        })
        .catch((e) => {
          console.error(e);
        });
    } else {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === "recording"
      ) {
        mediaRecorderRef.current.stop();
      }
    }
  };

  const handleBackward = () => {
    initialize(time ? false : true);
    if (isListening) {
      setIsListening(false);
    }
  };

  const handleTranscribe = () => {
    lastCommand.current = transcribeAudio;
    initializeProcessing();
  };
  const handleTranslate = () => {
    lastCommand.current = translateAudio;
    initializeProcessing();
  };
  const handleCompletion = async (e, model) => {
    if (model) instantModel.current = model;
    lastCommand.current = "gptCompletion";
    await handleModifierKeys(e);
    initializeProcessing();
  };
  const handlePostProcessing = async (e, model) => {
    if (model) instantModel.current = model;
    lastCommand.current = "gptPostProcessing";
    await handleModifierKeys(e);
    handleEltHighlight(e);
    initializeProcessing();
  };
  const handleModifierKeys = async (e) => {
    roamContext.current = {
      linkedRefs: false,
      sidebar: false,
      mainPage: false,
      logPages: false,
    };
    if (e.shiftKey) roamContext.current.sidebar = true;
    if (e.metaKey || e.ctrlKey) {
      if (isLogView() || (await isCurrentPageDNP())) {
        AppToaster.show({
          message:
            "Warning! Using past daily note pages as context can quickly reach maximum token limit if a large number of days if processed. " +
            "Be aware of the potentially high cost: for each request; around $0.02 with GPT-4o-mini, up to $1.30 with GPT-4.",
        });
        roamContext.current.logPages = true;
      } else roamContext.current.linkedRefs = true;
    }
    if (e.altKey) roamContext.current.page = true;
  };

  const initializeProcessing = async () => {
    targetBlock.current =
      window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
    const currentSelection = getBlocksSelectionUids();
    if (!blocksSelectionUids.current || currentSelection.length > 0)
      blocksSelectionUids.current = [...currentSelection];
    if (isListening) {
      isToTranscribe.current = true;
      setIsListening(false);
    } else if (record?.current || safariRecorder?.current?.activeStream)
      voiceProcessing();
    else {
      let prompt = "";
      let toNextSibling = false;
      if (targetBlock.current) {
        prompt = getBlockContentByUid(targetBlock.current).trim();
      } else if (blocksSelectionUids.current.length > 0) {
        prompt = getResolvedContentFromBlocks(
          blocksSelectionUids.current,
          false
        );
        targetBlock.current = blocksSelectionUids.current[0];
        blocksSelectionUids.current = [];
        toNextSibling = true;
      } else return;
      await completionProcessing(prompt, targetBlock.current, toNextSibling);
    }
  };

  const voiceProcessing = async () => {
    if (!record?.current && !safariRecorder?.current.activeStream) {
      console.log("no record available");
      return;
    }
    // Transcribe audio
    if (isSafari) {
      safariRecorder.current
        .stop()
        .getMp3MimeAudioMpeg()
        .then(async ([buffer, blob]) => {
          const audioFile = new File(buffer, "music.mpeg", {
            type: blob.type,
            lastModified: Date.now(),
          });
          audioFileProcessing(audioFile);
        })
        .catch((e) => {
          console.error(e);
        });
    } else {
      return await audioFileProcessing(record.current);
    }
  };

  const audioFileProcessing = async (audioFile) => {
    let toChain = false;
    let voiceProcessingCommand = lastCommand.current;
    let targetUid =
      targetBlock.current ||
      startBlock.current ||
      (await insertBlockInCurrentView(""));
    if (
      lastCommand.current === "gptCompletion" ||
      lastCommand.current === "gptPostProcessing"
    ) {
      voiceProcessingCommand = transcribeAudio;
      toChain = true;
      if (
        targetUid === targetBlock.current ||
        targetUid === startBlock.current
      ) {
        const targetBlockContent = getBlockContentByUid(targetUid).trim();
        if (targetBlockContent && lastCommand.current === "gptCompletion")
          targetUid = await createChildBlock(targetUid, "");
      }
    }
    const intervalId = await displaySpinner(targetUid);
    const hasKey = openaiLibrary && openaiLibrary.key !== "";
    let transcribe =
      instantVoiceReco.current || audioFile
        ? isUsingWhisper && hasKey
          ? await voiceProcessingCommand(audioFile)
          : instantVoiceReco.current
        : "Nothing has been recorded!";
    console.log("SpeechAPI: " + instantVoiceReco.current);
    if (isUsingWhisper && hasKey) console.log("Whisper: " + transcribe);
    if (transcribe === null) {
      transcribe =
        instantVoiceReco.current +
        (toChain
          ? ""
          : " (⚠️ Whisper transcription not working, verify your OpenAI API key or subscription)");
    } else if (
      transcribe === "you" ||
      transcribe === "Sous-titres réalisés para la communauté d'Amara.org" ||
      transcribe === "Subtítulos realizados por la comunidad de Amara.org" ||
      transcribe === "Untertitel der Amara.org-Community" ||
      transcribe === "ご視聴ありがとうございました。"
    ) {
      toChain = false;
      transcribe =
        "⚠️ Nothing has been recorded! Verify your microphone settings.";
    }
    const toInsert =
      toChain && !getBlockContentByUid(targetUid).trim()
        ? chatRoles.user + transcribe
        : transcribe;
    removeSpinner(intervalId);
    // isResponseToSplit ? await parseAndCreateBlocks(targetUid, toInsert) :
    addContentToBlock(targetUid, toInsert);
    if (toChain && transcribe)
      await completionProcessing(transcribe, targetUid);
    initialize(true);
  };

  const completionProcessing = async (prompt, promptUid, toNextSibling) => {
    let uid;
    let waitForBlockCopy = false;
    const assistantRole = instantModel.current
      ? getInstantAssistantRole(instantModel.current)
      : chatRoles.assistant;
    const context = await getAndNormalizeContext(
      lastCommand.current === "gptPostProcessing" ? null : startBlock.current,
      blocksSelectionUids.current,
      roamContext.current,
      null,
      instantModel.current || defaultModel
    );
    if (lastCommand.current === "gptPostProcessing") {
      let inlineTemplate = getTemplateFromPrompt(
        getBlockContentByUid(promptUid)
      );
      let uidsToExclude = [];
      if (inlineTemplate) {
        uidsToExclude = await copyTemplate(
          promptUid,
          inlineTemplate.templateUid
        );
        prompt = resolveReferences(inlineTemplate.updatedPrompt);
        waitForBlockCopy = true;
      } else if (!getFirstChildUid(promptUid)) {
        await copyTemplate(promptUid);
        waitForBlockCopy = true;
      }
      setTimeout(
        async () => {
          let template = await getTemplateForPostProcessing(
            promptUid,
            99,
            uidsToExclude
          );
          // console.log("template :>> ", template);
          let commandType;
          if (!template) {
            // default post-processing
            AppToaster.show({
              message:
                "You are requesting a post-processing completion following a template, but there is neither provided template nor default template defined in settings.",
            });
            commandType = "gptCompletion";
            prompt = prompt;
            uid = await createChildBlock(promptUid, assistantRole);
          } else {
            commandType = "gptPostProcessing";
            prompt =
              specificContentPromptBeforeTemplate +
              prompt +
              "\n\n" +
              template.stringified;
            uid = getFirstChildUid(promptUid);
          }

          // remove {text} mentions from template
          if (template.excluded && template.excluded.length) {
            cleanFlagFromBlocks("{text}", template.excluded);
          }

          await insertCompletion({
            prompt,
            targetUid: uid,
            context,
            typeOfCompletion: commandType,
            instantModel: instantModel.current,
          });
          initialize(true);
        },
        waitForBlockCopy ? 100 : 0
      );
    } else {
      const isInConversation = isPromptInConversation(promptUid);
      if (toNextSibling) {
        uid = await createSiblingBlock(promptUid);
        await addContentToBlock(uid, assistantRole);
      } else {
        uid = await createChildBlock(
          isInConversation ? getParentBlock(promptUid) : promptUid,
          assistantRole
        );
      }
      await insertCompletion({
        prompt,
        targetUid: uid,
        context,
        typeOfCompletion: lastCommand.current,
        instantModel: instantModel.current,
        isRedone: false,
        isInConversation,
      });
      initialize(true);
    }
  };

  const initialize = (complete = true) => {
    if (isSafari) safariRecorder.current.clear();
    else {
      lastCommand.current = null;
      audioChunk.current = [];
      // setDefaultRecord(complete ? null : undefined);
      record.current = complete ? null : undefined;
    }
    if (complete) {
      if (isSafari) {
        safariRecorder.current.stop();
      } else {
        closeStream(stream.current);
        stream.current = null;
      }
      startBlock.current = null;
      targetBlock.current = null;
      blocksSelectionUids.current = null;
      roamContext.current = {
        linkedRefs: false,
        sidebar: false,
        mainPage: false,
        logPages: false,
      };
      instantModel.current = null;
      if (!isVisible) toggleComponentVisibility();
      setIsToDisplay({
        transcribeIcon: true,
        translateIcon: isTranslateIconDisplayed || translateOnly,
        completionIcon: true,
      });
      setAreCommandsToDisplay(false);
    }
    instantVoiceReco.current = "";
    isToTranscribe.current = false;
    setTime(0);
  };

  const voiceRecordingWarningMsg = (
    <p>
      Voice recording is currently not supported on this platform (Roam MacOS
      desktop App or Mobile app).
      <br />
      Use text-only mode. See documentation.
    </p>
  );

  const enableWhisperWarning = (
    <p>
      Native voice recognition doesn't work on Firefox, Arc browser or Electron
      app.
      <br />
      Enable Whisper recognition and/or provide a valid OpenAI API key.
    </p>
  );

  const mainContent = () => {
    return (
      <>
        {isListening ? (
          <Tooltip
            content="Stop/Pause voice recording (Spacebar)"
            hoverOpenDelay="500"
          >
            <FontAwesomeIcon
              icon={faRecordVinyl}
              beatFade
              style={{ color: "#e00000" }}
            />
          </Tooltip>
        ) : isWorking ? (
          <Tooltip
            content="Start/Resume voice recording (Spacebar)"
            hoverOpenDelay="500"
          >
            <FontAwesomeIcon icon={faMicrophone} />
          </Tooltip>
        ) : (
          <Tooltip
            content={voiceRecordingWarningMsg}
            intent="warning"
            hoverOpenDelay="300"
          >
            <FontAwesomeIcon icon={faMicrophoneSlash} />
          </Tooltip>
        )}
      </>
    );
  };

  const jsxBp3MainDisplay = (props) => {
    return (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            onKeyDown={(e) => (isWorking ? handleKeys(e) : null)}
            onClick={(e) =>
              isWorking ? handleRecord(e) : handleRecordNotAvailable()
            }
            class="bp3-button bp3-minimal bp3-small speech-record-button"
            tabindex="0"
            // {...props}
          >
            {mainContent()}
          </span>
        </span>
      </span>
    );
  };

  const jsxLogMainDisplay = (props) => {
    return (
      <div
        onKeyDown={(e) => (isWorking ? handleKeys(e) : null)}
        onClick={(e) =>
          isWorking ? handleRecord(e) : handleRecordNotAvailable()
        }
        class="log-button"
        tabindex="0"
        // style={{ marginRight: isListening ? "0" : "4px" }}
      >
        <span
          class="bp3-icon bp3-icon-shop icon bp3-icon-small speech-record-button"
          // {...props}
        >
          {mainContent()}
        </span>
        {!isListening &&
          !areCommandsToDisplay /*!safariRecorder.current.activeStream?.active*/ && (
            <>
              <span>Live AI</span>
            </>
          )}
      </div>
    );
  };

  const jsxWarning = () => {
    return (
      <>
        {!isWorking && worksOnPlatform && (
          <Tooltip
            content={enableWhisperWarning}
            intent="warning"
            hoverOpenDelay="300"
          >
            <span style={{ color: "lightpink" }}>&nbsp;⚠️</span>
          </Tooltip>
        )}
      </>
    );
  };

  const timerProps = {
    onClick: handleBackward,
    tabindex: "0",
  };

  const timerContent = () => {
    return (
      <>
        <Tooltip
          content="Rewind and delete the current recording (Backspace or Escape)"
          hoverOpenDelay="500"
        >
          <FontAwesomeIcon icon={faBackwardStep} />
        </Tooltip>
        <Timer time={time} />
      </>
    );
  };

  const jsxBp3TimerWrapper = (props) => {
    return (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            class="bp3-button bp3-minimal bp3-small speech-backward-button"
            {...props}
          >
            {timerContent()}
          </span>
        </span>
      </span>
    );
  };
  const jsxLogTimerWrapper = (props) => {
    return (
      <span class="log-button left-timer-wrapper" {...props}>
        {timerContent()}
      </span>
    );
  };

  const jsxCommandIcon = (props, command, insertIconCallback) => {
    let commandClass =
      command === handleTranscribe
        ? "speech-transcribe"
        : command === handleTranslate
        ? "speech-translate"
        : command === handleCompletion
        ? "speech-completion"
        : "speech-post-processing";
    return (
      // {(isListening || recording !== null) && (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            onClick={command}
            // disabled={!safariRecorder.current.activeStream?.active}
            onMouseEnter={(e) => {
              if (
                command === handleCompletion ||
                command === handlePostProcessing
              ) {
                handleEltHighlight(e);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (
                command === handleCompletion ||
                command === handlePostProcessing
              )
                ContextMenu.show(
                  ModelsMenu({ command, instantModel }),
                  { left: e.clientX, top: e.clientY },
                  null
                );
            }}
            disabled={!areCommandsToDisplay}
            class={`bp3-button bp3-minimal bp3-small speech-command ${commandClass}`}
            tabindex="0"
            {...props}
          >
            {insertIconCallback()}
          </span>
        </span>
      </span>
      // )}
    );
  };

  return (
    <>
      <div class="speech-ui-row1">
        {position === "left" ? jsxLogMainDisplay() : jsxBp3MainDisplay()}

        {(isListening ||
          areCommandsToDisplay) /*safariRecorder.current.activeStream?.active*/ &&
          (position === "left"
            ? jsxLogTimerWrapper(timerProps)
            : jsxBp3TimerWrapper(timerProps))}
        {jsxWarning()}
      </div>
      <div class="speech-ui-row2">
        {(isListening ||
          areCommandsToDisplay) /*safariRecorder.current.activeStream?.active*/ &&
          isToDisplay.transcribeIcon &&
          jsxCommandIcon({}, handleTranscribe, () => (
            <Tooltip
              content="Transcribe voice to Text (T or Enter)"
              hoverOpenDelay="500"
            >
              <FontAwesomeIcon icon={faWandMagicSparkles} />
            </Tooltip>
          ))}
        {(isListening ||
          areCommandsToDisplay) /*safariRecorder.current.activeStream?.active*/ &&
          isToDisplay.translateIcon &&
          jsxCommandIcon({}, handleTranslate, () => (
            <Tooltip
              content="Translate voice to English text (E)"
              hoverOpenDelay="500"
            >
              <FontAwesomeIcon icon={faLanguage} flip="horizontal" />
            </Tooltip>
          ))}
        {
          /*isListening ||*/
          // areCommandsToDisplay  &&
          isToDisplay.completionIcon &&
            jsxCommandIcon({}, handleCompletion, () => (
              <Tooltip
                content={
                  <p>
                    AI assistant Completion (C)
                    <br />+<code>Alt</code>: <b>page</b> as context
                    <br />+<code>Cmd</code> or <code>Ctrl</code>:{" "}
                    <b>linked refs or DNPs</b>
                    <br />+<code>Shift</code>: <b>sidebar</b>
                  </p>
                }
                hoverOpenDelay="500"
                style={{ display: "flex", alignItems: "center" }}
              >
                <OpenAILogo />
              </Tooltip>
            ))
        }
        {
          /*isListening || areCommandsToDisplay && */
          isToDisplay.completionIcon &&
            jsxCommandIcon({}, handlePostProcessing, () => (
              <Tooltip
                content={
                  <p>
                    AI Post-Processing following template (P)
                    <br />+<code>Alt</code>: <b>page</b> as context
                    <br />+<code>Cmd</code> or <code>Ctrl</code>:{" "}
                    <b>linked refs or DNPs</b>
                    <br />+<code>Shift</code>: <b>sidebar</b>
                  </p>
                }
                hoverOpenDelay="500"
              >
                <FontAwesomeIcon icon={faListUl} />
              </Tooltip>
            ))
        }
      </div>
    </>
  );
}

export default VoiceRecorder;
