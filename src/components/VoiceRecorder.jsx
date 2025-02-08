import { useState, useEffect, useRef } from "react";
import { Tooltip } from "@blueprintjs/core";

import {
  faBolt,
  faMicrophone,
  faMicrophoneSlash,
  faRecordVinyl,
  faBackwardStep,
  faWandMagicSparkles,
  faLanguage,
  faRectangleList,
  faListUl,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { closeStream, getStream, newMediaRecorder } from "../audio/audio.js";
import {
  aiCompletionRunner,
  insertCompletion,
} from "../ai/responseInsertion.js";
import {
  addContentToBlock,
  createChildBlock,
  createSiblingBlock,
  getBlockContentByUid,
  getBlocksSelectionUids,
  getLastTopLevelOfSeletion,
  getParentBlock,
  insertBlockInCurrentView,
  isCurrentPageDNP,
  isLogView,
} from "../utils/roamAPI.js";
import Timer from "./Timer.jsx";
import {
  chatRoles,
  getInstantAssistantRole,
  defaultModel,
  isSafari,
  isTranslateIconDisplayed,
  isUsingWhisper,
  openaiLibrary,
  extensionStorage,
} from "../index.js";
import MicRecorder from "../audio/mic-recorder.js";
import OpenAILogo from "./OpenAILogo.jsx";
import {
  displaySpinner,
  highlightHtmlElt,
  removeSpinner,
  setAsOutline,
  toggleComponentVisibility,
} from "../utils/domElts.js";
import { invokeOutlinerAgent } from "../ai/agents/outliner-agent";
import { transcribeAudio, translateAudio } from "../ai/aiAPIsHub.js";
import {
  getAndNormalizeContext,
  getResolvedContentFromBlocks,
  handleModifierKeys,
  isPromptInConversation,
} from "../ai/dataExtraction.js";
import { AppToaster } from "./Toaster.js";

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
  outlineState,
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
  const [isOutlineActive, setIsOutlineActive] = useState(outlineState);

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
    if (e.keyCode === 79) {
      // "o", to make it compatible with modifiers
      handleOutlinerAgent(e);
    }
  };

  const handleEltHighlight = async (e) => {
    if (e.shiftKey) {
      highlightHtmlElt({ selector: "#roam-right-sidebar-content" });
    }
    if (e.metaKey || e.ctrlKey) {
      if (isLogView()) highlightHtmlElt({ selector: ".roam-log-container" });
      else if (await isCurrentPageDNP())
        highlightHtmlElt({ selector: ".rm-title-display" });
      else highlightHtmlElt({ selector: ".rm-reference-main" });
    }
    if (e.altKey) {
      highlightHtmlElt({ selector: ".roam-article > div:first-child" });
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

  const handleTranscribe = (e) => {
    lastCommand.current = transcribeAudio;
    initializeProcessing(e);
  };
  const handleTranslate = (e) => {
    lastCommand.current = translateAudio;
    initializeProcessing(e);
  };
  const handleCompletion = async (e, model) => {
    if (model) instantModel.current = model;
    lastCommand.current = "gptCompletion";
    roamContext.current = await handleModifierKeys(e);
    initializeProcessing(e);
  };
  const handleOutlinerAgent = async (e, model) => {
    if (!(await extensionStorage.get("outlinerRootUid"))) {
      const rootUid = await setAsOutline();
      if (rootUid) setIsOutlineActive(true);
      return;
    }
    if (model) instantModel.current = model;
    lastCommand.current = "outlinerAgent";
    roamContext.current = await handleModifierKeys(e);
    handleEltHighlight(e);
    initializeProcessing(e);
  };

  const initializeProcessing = async (e) => {
    if (isListening) {
      isToTranscribe.current = true;
      setIsListening(false);
    } else if (record?.current || safariRecorder?.current?.activeStream)
      voiceProcessing();
    else {
      await completionProcessing(e);
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
    let nextSiblingOfSelection;
    let toChain = false;
    let voiceProcessingCommand = lastCommand.current;
    if (blocksSelectionUids.current) {
      const lastTopUid = await getLastTopLevelOfSeletion(
        blocksSelectionUids.current
      );
      nextSiblingOfSelection = await createSiblingBlock(lastTopUid);
    }
    let targetUid =
      nextSiblingOfSelection ||
      targetBlock.current ||
      startBlock.current ||
      (await insertBlockInCurrentView(""));
    console.log("targetUid in audioFileProcessing :>> ", targetUid);
    if (
      lastCommand.current === "gptCompletion" ||
      lastCommand.current === "outlinerAgent"
    ) {
      voiceProcessingCommand = transcribeAudio;
      toChain = true;
      if (
        targetUid === targetBlock.current ||
        targetUid === startBlock.current
      ) {
        const targetBlockContent = getBlockContentByUid(targetUid).trim();
        if (targetBlockContent /*&& lastCommand.current === "gptCompletion"*/)
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
    await addContentToBlock(targetUid, toInsert);
    if (toChain && transcribe)
      await completionProcessing(null, transcribe, targetUid);
    initialize(true);
  };

  const completionProcessing = async (e, prompt, targetUid) => {
    if (lastCommand.current === "outlinerAgent") {
      invokeOutlinerAgent({ e, prompt, model: instantModel.current });
      // let inlineTemplate = getTemplateFromPrompt(
      //   getBlockContentByUid(promptUid)
      // );
      // let uidsToExclude = [];
      // if (inlineTemplate) {
      //   uidsToExclude = await copyTemplate(
      //     promptUid,
      //     inlineTemplate.templateUid
      //   );
      //   prompt = resolveReferences(inlineTemplate.updatedPrompt);
      //   waitForBlockCopy = true;
      // } else if (!getFirstChildUid(promptUid)) {
      //   await copyTemplate(promptUid);
      //   waitForBlockCopy = true;
      // }
      // setTimeout(
      //   async () => {
      //     let template = await getTemplateForPostProcessing(
      //       promptUid,
      //       99,
      //       uidsToExclude
      //     );
      //     // console.log("template :>> ", template);
      //     let commandType;
      //     if (!template) {
      //       // default post-processing
      //       AppToaster.show({
      //         message:
      //           "You are requesting a post-processing completion following a template, but there is neither provided template nor default template defined in settings.",
      //       });
      //       commandType = "gptCompletion";
      //       prompt = prompt;
      //       uid = await createChildBlock(promptUid, assistantRole);
      //     } else {
      //       commandType = "outlinerAgent";
      //       prompt =
      //         specificContentPromptBeforeTemplate +
      //         prompt +
      //         "\n\n" +
      //         template.stringified;
      //       uid = getFirstChildUid(promptUid);
      //     }

      //     // remove {text} mentions from template
      //     if (template.excluded && template.excluded.length) {
      //       cleanFlagFromBlocks("{text}", template.excluded);
      //     }

      //     await insertCompletion({
      //       prompt,
      //       targetUid: uid,
      //       context,
      //       typeOfCompletion: commandType,
      //       instantModel: instantModel.current,
      //     });
      //     initialize(true);
      //   },
      //   waitForBlockCopy ? 100 : 0
      // );
    } else {
      aiCompletionRunner({
        e,
        prompt,
        selectedUids: blocksSelectionUids.current,
        model: instantModel.current,
        sourceUid:
          targetUid || window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"],
        target: "new",
      });
    }
    initialize(true);
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

  const handleClosePopover = () => {
    setIsPopoverOpen(false);
  };
  const jsxCommandIcon = (props, command, insertIconCallback) => {
    let commandClass =
      command === handleTranscribe
        ? "speech-transcribe"
        : command === handleTranslate
        ? "speech-translate"
        : command === handleCompletion
        ? "speech-completion"
        : "outliner-agent";
    return (
      // {(isListening || recording !== null) && (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            onClick={(e) => {
              if (window.roamAlphaAPI.platform.isMobile) {
                if (command === handleCompletion) {
                  window.LiveAI.toggleContextMenu({ e });
                } else if (command === handleOutlinerAgent) {
                  window.LiveAI.toggleContextMenu({ e, onlyOutliner: true });
                } else command(e);
              } else command(e);
            }}
            // disabled={!safariRecorder.current.activeStream?.active}
            onMouseEnter={(e) => {
              if (
                command === handleCompletion ||
                command === handleOutlinerAgent
              ) {
                handleEltHighlight(e);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (command === handleCompletion) {
                window.LiveAI.toggleContextMenu({ e });
              } else if (command === handleOutlinerAgent) {
                window.LiveAI.toggleContextMenu({ e, onlyOutliner: true });
              }
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
                openOnTargetFocus={false}
                disabled={window.roamAlphaAPI.platform.isMobile}
                content={
                  <p>
                    AI Completion following prompt (C)
                    <br />+<code>Alt</code>: <b>page</b> as context
                    <br />+<code>Cmd</code> or <code>Ctrl</code>:{" "}
                    <b>linked refs or DNPs</b>
                    <br />+<code>Shift</code>: <b>sidebar</b>
                  </p>
                }
                hoverOpenDelay="500"
                style={{
                  display: "flex",
                  alignItems: "center",
                  zIndex: "99",
                }}
              >
                <FontAwesomeIcon icon={faBolt} />
                {/* <OpenAILogo /> */}
              </Tooltip>
            ))
        }
        {
          /*isListening || areCommandsToDisplay && */
          isToDisplay.completionIcon &&
            jsxCommandIcon({}, handleOutlinerAgent, () => (
              <Tooltip
                openOnTargetFocus={false}
                disabled={window.roamAlphaAPI.platform.isMobile}
                content={
                  isOutlineActive ? (
                    <p>
                      Outliner Agent (O)
                      <br />+<code>Alt</code>: <b>page</b> as context
                      <br />+<code>Cmd</code> or <code>Ctrl</code>:{" "}
                      <b>linked refs or DNPs</b>
                      <br />+<code>Shift</code>: <b>sidebar</b>
                    </p>
                  ) : (
                    <p>
                      Outliner Agent (O)
                      <br />
                      Select focused block as target
                    </p>
                  )
                }
                hoverOpenDelay="500"
              >
                {isOutlineActive ? (
                  <FontAwesomeIcon icon={faRectangleList} size="lg" />
                ) : !isListening ? (
                  <FontAwesomeIcon icon={faListUl} />
                ) : null}
              </Tooltip>
            ))
        }
      </div>
    </>
  );
}

export default VoiceRecorder;
