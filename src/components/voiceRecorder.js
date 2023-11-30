import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import {
  faMicrophone,
  faRecordVinyl,
  faDownload,
  faBackwardStep,
  faWandMagicSparkles,
  faLanguage,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
//import "./App.css";
import {
  closeStream,
  getMediaRecorderStream,
  getSpeechRecognitionAPI,
} from "../audio";
import { gptCompletion, transcribeAudio, translateAudio } from "../openai";
import { addContentToBlock, insertBlockInCurrentView } from "../utils";
import { Timer } from "./timer";
import {
  OPENAI_API_KEY,
  chatRoles,
  gptCustomModel,
  gptModel,
  isTranslateIconDisplayed,
  isUsingWhisper,
} from "..";

function VoiceRecorder(props) {
  let {
    blockUid,
    startRecording,
    transcribeOnly,
    translateOnly,
    completionOnly,
    mic,
    position,
  } = props;
  const [isListening, setIsListening] = useState(startRecording ? true : false);
  const [currentBlock, setCurrentBlock] = useState(blockUid);
  const [isToDisplay, setIsToDisplay] = useState({
    transcribeIcon: !translateOnly && !completionOnly,
    translateIcon:
      !transcribeOnly && !completionOnly && isTranslateIconDisplayed,
    completionIcon: !translateOnly && !transcribeOnly,
  });
  const [instantVoiceReco, setinstantVoiceReco] = useState(null);
  const [time, setTime] = useState(0);

  const audioChunk = useRef([]);
  const [recording, setRecording] = useState(null);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    console.log("Voice recorder component mounted", props);
    // removeHotkeysListeners();
    // document.addEventListener("keypress", onHotkeysPressed);
  }, []);

  React.useEffect(() => {
    let interval = null;

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

  const startRec = async () => {
    console.log("Start to record");

    setCurrentBlock(window.roamAlphaAPI.ui.getFocusedBlock()?.["block-uid"]);

    mediaRecorderRef.current = await getMediaRecorderStream(audioChunk);
    mediaRecorderRef.current.start();

    mediaRecorderRef.current.onstop = async (e) => {
      console.log("End to record");
      const audioBlob = new Blob(audioChunk.current);
      const audioFile = new File([audioBlob], "audio.ogg", {
        type: "audio/ogg; codecs=opus",
      });
      setRecording(audioFile);
    };
  };

  const stopRec = async () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      await mediaRecorderRef.current.stop();
    }
  };

  useEffect(() => {
    handleListen();
  }, [isListening]);

  const handleListen = async () => {
    // recognition if not in Electron App or Firefox browser
    if (isListening) {
      if (mic) {
        mic.start();
        mic.onend = () => {
          console.log("continue...");
          mic.start();
        };
      }

      // record
      startRec();
    } else {
      // recognition
      if (mic) {
        mic.stop();
        mic.onend = () => {
          console.log("Stopped Mic on Click");
        };
      }

      // record
      await stopRec();
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
        console.log(transcript);
        setinstantVoiceReco(transcript);
        mic.onerror = (event) => {
          console.log(event.error);
        };
      };
    }
  };

  const handleTranscribe = () => {
    voiceProcessing(transcribeAudio);
  };

  const handleTranslate = async () => {
    await voiceProcessing(translateAudio);
  };

  const handleCompletion = async () => {
    const { prompt, location } = await voiceProcessing(transcribeAudio, true);
    const gptResponse = await gptCompletion(prompt);
    const uid = window.roamAlphaAPI.util.generateUID();
    window.roamAlphaAPI.createBlock({
      location: { "parent-uid": location, order: "last" },
      block: { string: chatRoles.assistant + gptResponse, uid: uid },
    });
  };

  const voiceProcessing = async (openAIvoiceProcessing, toChain) => {
    if (isListening) {
      setIsListening((prevState) => !prevState);
    }
    if (!recording) {
      setIsListening(false);
      setRecording(null);
      return;
    }
    // Transcribe audio
    let transcribe =
      instantVoiceReco || recording
        ? isUsingWhisper && OPENAI_API_KEY
          ? await openAIvoiceProcessing(recording)
          : instantVoiceReco
        : "Nothing has been recorded!";
    console.log("SpeechAPI: " + instantVoiceReco);
    if (isUsingWhisper && OPENAI_API_KEY) console.log("Whisper: " + transcribe);
    if (transcribe === null) {
      transcribe =
        instantVoiceReco +
        (toChain
          ? ""
          : " (⚠️ native recognition, verify your Whisper API key)");
    }
    setinstantVoiceReco("");
    const toInsert = toChain ? chatRoles.user + transcribe : transcribe;
    let newBlock;
    currentBlock
      ? addContentToBlock(currentBlock, toInsert)
      : (newBlock = await insertBlockInCurrentView(toInsert));
    initialize();
    if (toChain) {
      //setCurrentBlock(newBlock);
      return { prompt: transcribe, location: newBlock };
    }
    // const node = document.getElementsByClassName("speech-to-roam-container")[0];
    // ReactDOM.unmountComponentAtNode(node);
  };

  const handleBackward = () => {
    if (isListening) {
      setIsListening(false);
    }
    initialize(time ? false : true);
  };

  const initialize = (complete = true) => {
    setTime(0);
    setinstantVoiceReco("");
    setRecording(complete ? null : undefined);
    if (complete)
      setIsToDisplay({
        transcribeIcon: true,
        translateIcon: isTranslateIconDisplayed || translateOnly,
        completionIcon: true,
      });
    audioChunk.current = [];
    closeStream();
  };

  const handleKeys = async (e) => {
    console.log(e);
    if (e.code === "Escape" || e.code === "Backspace") {
      handleBackward();
    }
    if (e.code === "Space") {
      setIsListening((prevState) => !prevState);
    }
    if (e.code === "Enter") {
      if (!translateOnly) {
        handleTranscribe();
      }
    }
  };

  // JSX
  const mainProps = {
    title: isListening
      ? "Stop/Pause voice recording"
      : "Start/Resume voice recording",
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
        {!isListening && recording === null && (
          <span
            //class="log-button"
            // class="bp3-button bp3-minimal bp3-small"
            // onClick={() => setIsListening((prevState) => !prevState)}
            style={{ display: "inline", padding: "0", margin: "0 0 0 -2px" }}
          >
            Speech-to-Roam
          </span>
        )}
      </div>
    );
  };

  const timerProps = {
    onClick: handleBackward,
    tabindex: "0",
    style: { minWidth: "60px" },
    title: "Rewind and delete the current recording.",
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
      <span class="bp3-popover-wrapper">
        <span aria-haspopup="true" class="bp3-popover-target">
          {(isListening || recording !== null) && (
            <span
              onClick={command}
              disabled={!recording}
              class="bp3-button bp3-minimal bp3-small"
              tabindex="0"
              {...props}
            >
              {insertIconCallback()}
            </span>
          )}
        </span>
      </span>
    );
  };

  return (
    <>
      {position === "left"
        ? jsxLogMainDisplay(mainProps)
        : jsxBp3MainDisplay(mainProps)}
      {(isListening || recording !== null) &&
        (position === "left"
          ? jsxLogTimerWrapper(timerProps)
          : jsxBp3TimerWrapper(timerProps))}
      {isToDisplay.transcribeIcon &&
        jsxCommandIcon(
          { title: "Transcribe Voice to Text" },
          handleTranscribe,
          () => (
            <>
              <FontAwesomeIcon icon={faWandMagicSparkles} />
            </>
          )
        )}{" "}
      {isToDisplay.translateIcon &&
        jsxCommandIcon(
          { title: "Translate Voice to English text" },
          handleTranslate,
          () => (
            <>
              <FontAwesomeIcon icon={faLanguage} flip="horizontal" />
            </>
          )
        )}
      {isToDisplay.completionIcon &&
        jsxCommandIcon(
          {
            title: "Transcribe and use as prompt for a ChatGPT",
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
    </>
  );
}

export default VoiceRecorder;
