import React, { useState, useEffect, useRef } from "react";
import {
  faMicrophone,
  faRecordVinyl,
  faBackwardStep,
  faWandMagicSparkles,
  faLanguage,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
//import "./App.css";
import { closeStream, getStream, newMediaRecorder } from "../audio.js";
import {
  gptCompletion,
  insertCompletion,
  transcribeAudio,
  translateAudio,
} from "../openai.js";
import {
  addContentToBlock,
  createChildBlock,
  displaySpinner,
  getBlockContentByUid,
  getBlocksSelectionUids,
  insertBlockInCurrentView,
  removeSpinner,
} from "../utils.js";
import Timer from "./Timer.js";
import {
  chatRoles,
  isSafari,
  isTranslateIconDisplayed,
  isUsingWhisper,
  toggleComponentVisibility,
} from "../index.js";
import MicRecorder from "../mic-recorder.js";
import OpenAILogo from "./OpenAILogo.jsx";

function VoiceRecorder({
  blockUid,
  startRecording,
  transcribeOnly,
  translateOnly,
  completionOnly,
  mic,
  position,
  openai,
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
      alert(
        "Speech-to-Roam currently doesn't work on your current platform (Mac Desktop App or Mobile app). See documentation."
      );
      return;
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
    if (e.key.toLowerCase() === "c") {
      handleCompletion(e);
      return;
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
  const handleCompletion = async () => {
    lastCommand.current = gptCompletion;
    initializeProcessing();
  };
  const initializeProcessing = () => {
    targetBlock.current =
      window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];
    const currentSelection = getBlocksSelectionUids();
    if (!blocksSelectionUids.current || currentSelection.length > 0)
      blocksSelectionUids.current = currentSelection;
    if (isListening) {
      isToTranscribe.current = true;
      setIsListening(false);
    } else if (record?.current || safariRecorder?.current?.activeStream)
      voiceProcessing();
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
    if (lastCommand.current === gptCompletion) {
      voiceProcessingCommand = transcribeAudio;
      toChain = true;
      if (
        targetUid === (targetBlock.current || startBlock.current) &&
        getBlockContentByUid(targetUid).trim()
      ) {
        targetUid = createChildBlock(targetUid, "");
      }
    }
    const intervalId = await displaySpinner(targetUid);
    const hasKey = openai && openai.key !== "";
    let transcribe =
      instantVoiceReco.current || audioFile
        ? isUsingWhisper && hasKey
          ? await voiceProcessingCommand(audioFile, openai)
          : instantVoiceReco.current
        : "Nothing has been recorded!";
    console.log("SpeechAPI: " + instantVoiceReco.current);
    if (isUsingWhisper && hasKey) console.log("Whisper: " + transcribe);
    if (transcribe === null) {
      transcribe =
        instantVoiceReco.current +
        (toChain ? "" : " (⚠️ native recognition, verify your OpenAI API key)");
    }
    const toInsert = toChain ? chatRoles.user + transcribe : transcribe;
    removeSpinner(intervalId);
    addContentToBlock(targetUid, toInsert);
    if (toChain && transcribe) {
      await insertCompletion(
        transcribe,
        openai,
        targetUid,
        startBlock.current,
        blocksSelectionUids.current
      );
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

  // JSX
  const mainProps = {
    title: isListening
      ? "Stop/Pause voice recording (Spacebar)"
      : "Start/Resume voice recording (Spacebar)",
  };

  const mainContent = () => {
    return (
      <>
        {isListening ? (
          <FontAwesomeIcon
            icon={faRecordVinyl}
            beatFade
            style={{ color: "#e00000" }}
          />
        ) : (
          <FontAwesomeIcon icon={faMicrophone} />
        )}
      </>
    );
  };

  const jsxBp3MainDisplay = (props) => {
    return (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            onKeyDown={handleKeys}
            onClick={handleRecord}
            class="bp3-button bp3-minimal bp3-small speech-record-button"
            tabindex="0"
            {...props}
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
        onKeyDown={handleKeys}
        onClick={handleRecord}
        class="log-button"
        tabindex="0"
        // style={{ marginRight: isListening ? "0" : "4px" }}
      >
        <span
          class="bp3-icon bp3-icon-shop icon bp3-icon-small speech-record-button"
          {...props}
        >
          {mainContent()}
        </span>
        {!isListening &&
          !areCommandsToDisplay /*!safariRecorder.current.activeStream?.active*/ && (
            <>
              <span
                //class="log-button"
                // class="bp3-button bp3-minimal bp3-small"
                // onClick={() => setIsListening((prevState) => !prevState)}
                style={{
                  display: "inline",
                  padding: "0",
                  margin: "0 0 0 -3px",
                }}
              >
                Speech-to-Roam
              </span>
            </>
          )}
      </div>
    );
  };

  const jsxWarning = () => {
    return (
      <>
        {!isWorking && (
          <span
            style={{ color: "lightpink" }}
            title={
              !worksOnPlatform
                ? "Speech-to-Roam currently doesn't work on your current platform (Mac Desktop App or Mobile app). See documentation."
                : "Native voice recognition doesn't work on Firefox, Arc browser or Electron app. Enable Whisper recognition"
            }
          >
            &nbsp;⚠️
          </span>
        )}
      </>
    );
  };

  const timerProps = {
    onClick: handleBackward,
    tabindex: "0",
    title: "Rewind and delete the current recording (Backspace or Escape)",
  };

  const timerContent = () => {
    return (
      <>
        <FontAwesomeIcon icon={faBackwardStep} />
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
        : "speech-completion";
    return (
      // {(isListening || recording !== null) && (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            onClick={command}
            // disabled={!safariRecorder.current.activeStream?.active}
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
        {position === "left"
          ? jsxLogMainDisplay(mainProps)
          : jsxBp3MainDisplay(mainProps)}

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
          jsxCommandIcon(
            { title: "Transcribe voice to Text (T or Enter)" },
            handleTranscribe,
            () => (
              <>
                <FontAwesomeIcon icon={faWandMagicSparkles} />
              </>
            )
          )}{" "}
        {(isListening ||
          areCommandsToDisplay) /*safariRecorder.current.activeStream?.active*/ &&
          isToDisplay.translateIcon &&
          jsxCommandIcon(
            { title: "Translate voice to English text (E)" },
            handleTranslate,
            () => (
              <>
                <FontAwesomeIcon icon={faLanguage} flip="horizontal" />
              </>
            )
          )}
        {(isListening ||
          areCommandsToDisplay) /*safariRecorder.current.activeStream?.active*/ &&
          isToDisplay.completionIcon &&
          jsxCommandIcon(
            {
              title: "Speak to ChatGPT (C)",
            },
            handleCompletion,
            () => (
              <>
                <OpenAILogo />
              </>
            )
          )}
      </div>
    </>
  );
}

export default VoiceRecorder;
