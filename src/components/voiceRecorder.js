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
import { closeStream, getMediaRecorderStream } from "../audio";
import { gptCompletion, transcribeAudio, translateAudio } from "../openai";
import {
  addContentToBlock,
  displaySpinner,
  insertBlockInCurrentView,
  removeSpinner,
} from "../utils";
import { Timer } from "./timer";
import {
  chatRoles,
  isSafari,
  isTranslateIconDisplayed,
  isUsingWhisper,
} from "..";
import MicRecorder from "../mic-recorder.js";

function VoiceRecorder({
  blockUid,
  startRecording,
  transcribeOnly,
  translateOnly,
  completionOnly,
  mic,
  position,
  openai,
}) {
  const [isListening, setIsListening] = useState(false);
  const [isToDisplay, setIsToDisplay] = useState({
    transcribeIcon: !translateOnly && !completionOnly,
    translateIcon:
      !transcribeOnly && !completionOnly && isTranslateIconDisplayed,
    completionIcon: !translateOnly && !transcribeOnly,
  });
  const [instantVoiceReco, setinstantVoiceReco] = useState(null);
  const [time, setTime] = useState(0);
  const [areCommandsToDisplay, setAreCommandsToDisplay] = useState(false);
  const [defaultRecord, setDefaultRecord] = useState(null);

  const audioChunk = useRef([]);
  const mediaRecorderRef = useRef(null);
  const safariRecorder = useRef(
    new MicRecorder({
      bitRate: 128,
    })
  );
  let lastCommand = useRef(null);
  let block = useRef(blockUid);

  useEffect(() => {
    if (startRecording) setIsListening(true);
    //console.log("Voice recorder component mounted", props);
    // document.addEventListener("keypress", (e) => {
    //   handleKeys(e);
    // });
  }, []);

  React.useEffect(() => {
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

  React.useEffect(async () => {
    if (lastCommand.current) {
      if (lastCommand.current === gptCompletion) handleCompletion();
      else voiceProcessing();
    }
  }, [defaultRecord]);

  // useEffect(() => {
  //   handleListen();
  // }, [isListening]);

  const handleListen = () => {
    // recognition if not in Electron App or Firefox browser
    if (isListening) {
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
        setinstantVoiceReco(transcript);
        mic.onerror = (event) => {
          console.log(event.error);
        };
      };
    }
  };

  const startRec = async () => {
    console.log("Start to record");

    block.current = window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"];

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
      mediaRecorderRef.current = await getMediaRecorderStream(
        audioChunk.current
      );
      mediaRecorderRef.current.start();

      mediaRecorderRef.current.onstop = (e) => {
        console.log("End to record");
        const audioBlob = new Blob(audioChunk.current);
        const audioFile = new File([audioBlob], "audio.webm", {
          type: "audio/webm",
        });
        if (audioFile.size) setDefaultRecord(audioFile);
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
    // lastCommand.current = handleBackward;
    console.log("click on backward");
    initialize(time ? false : true);
    if (isListening) {
      setIsListening(false);
    }
  };

  const initialize = (complete = true) => {
    if (isSafari) safariRecorder.current.clear();
    else {
      lastCommand.current = null;
      audioChunk.current = [];
      setDefaultRecord(complete ? null : undefined);
    }
    if (complete) {
      closeStream();
      setIsToDisplay({
        transcribeIcon: true,
        translateIcon: isTranslateIconDisplayed || translateOnly,
        completionIcon: true,
      });
      setAreCommandsToDisplay(false);
    }
    setTime(0);
    setinstantVoiceReco("");
  };

  const handleTranscribe = () => {
    lastCommand.current = transcribeAudio;
    voiceProcessing();
  };

  const handleTranslate = () => {
    lastCommand.current = translateAudio;
    voiceProcessing();
  };

  const handleCompletion = async () => {
    lastCommand.current = gptCompletion;
    const result = await voiceProcessing();
    if (!result) return;
    insertCompletion(result);
  };

  const insertCompletion = async ({ prompt, location }) => {
    const uid = window.roamAlphaAPI.util.generateUID();
    window.roamAlphaAPI.createBlock({
      location: { "parent-uid": location, order: "last" },
      block: { string: chatRoles.assistant, uid: uid },
    });
    const intervalId = await displaySpinner(uid);
    const gptResponse = await gptCompletion(prompt, openai);
    removeSpinner(intervalId);
    addContentToBlock(uid, gptResponse);
  };

  const voiceProcessing = async () => {
    if (isListening) {
      console.log("still listening");
      setIsListening(false);
      return;
    }
    if (!time || (!defaultRecord && !safariRecorder.current.activeStream)) {
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
      return await audioFileProcessing(defaultRecord);
    }
  };

  const audioFileProcessing = async (audioFile) => {
    console.log("audioFile :>> ", audioFile);
    let toChain = false;
    let voiceProcessingCommand = lastCommand.current;
    if (lastCommand.current === gptCompletion) {
      voiceProcessingCommand = transcribeAudio;
      toChain = true;
    }
    let targetUid = block.current || (await insertBlockInCurrentView(""));
    const intervalId = await displaySpinner(targetUid);
    const hasKey = openai && openai.key !== "";
    let transcribe =
      instantVoiceReco || audioFile
        ? isUsingWhisper && hasKey
          ? await voiceProcessingCommand(audioFile, openai)
          : instantVoiceReco
        : "Nothing has been recorded!";
    console.log("SpeechAPI: " + instantVoiceReco);
    if (isUsingWhisper && hasKey) console.log("Whisper: " + transcribe);
    if (transcribe === null) {
      transcribe =
        instantVoiceReco +
        (toChain ? "" : " (⚠️ native recognition, verify your OpenAI API key)");
    }
    const toInsert = toChain ? chatRoles.user + transcribe : transcribe;
    removeSpinner(intervalId);
    addContentToBlock(targetUid, toInsert);
    initialize(true);
    if (toChain) {
      return { prompt: transcribe, location: targetUid };
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
            onClick={() => setIsListening((prevState) => !prevState)}
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
        onClick={() => setIsListening((prevState) => !prevState)}
        class="speech-record-button"
        tabindex="0"
        style={{ marginRight: isListening ? "0" : "inherit" }}
      >
        <span class="bp3-icon bp3-icon-shop icon bp3-icon-small" {...props}>
          {mainContent()}
        </span>
        {!isListening &&
          !areCommandsToDisplay /*!safariRecorder.current.activeStream?.active*/ && (
            <span>Speech-to-Roam</span>
          )}
      </div>
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
    return (
      // {(isListening || recording !== null) && (
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          <span
            onClick={command}
            // disabled={!safariRecorder.current.activeStream?.active}
            disabled={!areCommandsToDisplay}
            class="bp3-button bp3-minimal bp3-small speech-command"
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
              style: { minWidth: "30px" },
            },
            handleCompletion,
            () => (
              <>
                <svg
                  role="img"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
                </svg>
              </>
            )
          )}
      </div>
    </>
  );
}

export default VoiceRecorder;
