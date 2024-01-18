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
import { closeStream, getStream, newMediaRecorder } from "../audio";
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
  const block = useRef(blockUid);

  useEffect(() => {
    console.log("mic :>> ", mic);
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

  // React.useEffect(async () => {
  //   if (lastCommand.current) {
  //     if (lastCommand.current === gptCompletion) handleCompletion();
  //     else voiceProcessing();
  //   }
  // }, [defaultRecord]);

  // useEffect(() => {
  //   handleListen();
  // }, [isListening]);

  const handleRecord = async () => {
    if (!worksOnPlatform) {
      alert(
        "Speech-to-Roam currently doesn't work on your current platform (Mac Desktop App or Mobile app). See documentation."
      );
      return;
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
    // recognition if not in Electron App or Firefox browser
    if (isListening) {
      if (mic) {
        mic.start();
        mic.onend = () => {
          console.log("continue...");
          mic.start();
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
        console.log("Mics on");
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
    if (lastCommand.current === gptCompletion) {
      voiceProcessingCommand = transcribeAudio;
      toChain = true;
    }
    let targetUid = block.current || (await insertBlockInCurrentView(""));
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
    initialize(true);
    if (toChain && transcribe) {
      insertCompletion(transcribe, targetUid);
    }
  };

  const insertCompletion = async (prompt, location) => {
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
        style={{ marginRight: isListening ? "0" : "inherit" }}
      >
        <span
          class="bp3-icon bp3-icon-shop icon bp3-icon-small"
          style={{
            marginLeft: "2px",
            minWidth: "24px",
            padding: "0",
          }}
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
                  margin: "0 0 0 -2px",
                }}
              >
                Speech-to-Roam
              </span>
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
          )}
      </div>
    );
  };

  const timerProps = {
    onClick: handleBackward,
    tabindex: "0",
    style: { minWidth: "60px" },
    title: "Rewind and delete the current recording (Backspace",
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
    props.style.display = "flex";
    props.style.justifyContent = "space-between";
    props.style.margin = "0";
    props.style.paddingLeft = "0";
    return (
      <span class="log-button" {...props}>
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
