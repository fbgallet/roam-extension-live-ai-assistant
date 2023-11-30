import React from "react";

export function Timer(props) {
  return (
    <span className="timer speech-display-button">
      <span className="digits">
        {("0" + Math.floor((props.time / 60000) % 60)).slice(-2)}:
      </span>
      <span className="digits">
        {("0" + Math.floor((props.time / 1000) % 60)).slice(-2)}
      </span>
    </span>
  );
}
