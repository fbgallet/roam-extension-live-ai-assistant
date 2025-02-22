import { Dialog, DialogBody, Classes, Divider } from "@blueprintjs/core";
import { DIVIDER } from "@blueprintjs/core/lib/esm/common/classes";

const HelpDialog = ({ isOpen, onClose }) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Live AI Assistant - Quick Reminded"
      className="laia-help-dialog"
    >
      <div className={Classes.DIALOG_BODY} useOverflowScrollContainer={true}>
        <p>
          <strong>Live AI Assistant</strong> v.15 2025/02 by{" "}
          <a href="https://github.com/sponsors/fbgallet" target="_blank">
            Fabrice Gallet
          </a>
        </p>
        <Divider />
        <strong>Documentation</strong>
        <ul>
          <li>
            Check "Getting started" help{" "}
            <a
              href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#live-ai-assistant"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
          </li>
          <li>
            Check more detailed documentation{" "}
            <a
              href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#detailed-documentation"
              target="_blank"
              rel="noopener noreferrer"
            >
              here
            </a>
          </li>
        </ul>
        <strong>Set Hotkeys for most used commands</strong>:
        <p>
          Remember to define or customize hotkeys for the following commands
          (via native Roam Command Palette) to access them quickly:
        </p>
        <ul>
          <li>
            <em>Live AI Assistant: Open commands context Menu</em>
            <br />
            (default hotkeys: <code>Cmd/Win + Ctrl + a</code>, another efficient
            shortcut is `Cmd/Ctrl + rigth-click`)
          </li>
          <li>
            <em>
              Live AI Assistant: AI generation, focused/selected block(s) as
              prompt
            </em>
            <br />
            (also allows continuing a conversation)
          </li>
          <li>
            <em>Live AI Assistant: Start/Pause recording your vocal note</em>
            <br />
            (you can dictate a command directly and route it to AI generative or
            Live Outliner if an outline is active)
          </li>
        </ul>
        <strong>Voice recorder hotkeys</strong>
        <br />
        (⚠️ available only when the voice recording has been started by a mouse
        click):
        <ul>
          <li>
            Pause/Resume: <code>Spacebar</code>
          </li>
          <li>
            Stop and rewind: <code>Escape</code> or <code>Backspace</code>
          </li>
          <li>
            Transcribe: <code>T or Enter</code>
          </li>
          <li>
            Translate (in English): <code>E</code>
          </li>
          <li>
            AI Generation using vocal note as prompt: <code>G</code>
          </li>
          <li>
            Live Outliner: <code>O</code>
          </li>
        </ul>
        <strong>Tags to define custom contents</strong>:
        <ul>
          <li>
            custom prompts: <code>#liveai/prompt</code>
          </li>
          <li>
            custom styles: <code>#liveai/style</code>
          </li>
          <li>
            favorite Live Outlines: <code>#liveai/outline</code>
          </li>
          <li>
            favorite templates for Live Outliner: <code>#liveai/template</code>
          </li>
        </ul>
        <br />
        <Divider />
        <strong>Support my work</strong>
        <p>
          If you want to encourage me to develop further and enhance this
          extension, you can{" "}
          <a href="https://buymeacoffee.com/fbgallet" target="_blank">
            buy me a coffee ☕ here
          </a>{" "}
          or{" "}
          <a href="https://github.com/sponsors/fbgallet" target="_blank">
            sponsor me on Github
          </a>
          . Thanks in advance for your support! 🙏
        </p>
        <p>
          For any question or suggestion, DM me on <strong>X/Twitter</strong>{" "}
          and follow me to be informed of updates and new extensions:{" "}
          <a href="https://x.com/fbgallet" target="_blank">
            @fbgallet
          </a>
          .
        </p>
        <p>
          Please report any <strong>issue</strong>{" "}
          <a
            href="https://github.com/fbgallet/roam-extension-live-ai-assistant/issues"
            target="_blank"
          >
            here
          </a>
          .
        </p>
      </div>
    </Dialog>
  );
};
export default HelpDialog;
