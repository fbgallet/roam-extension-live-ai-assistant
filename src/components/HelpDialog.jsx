import { Dialog, DialogBody, Classes, Divider } from "@blueprintjs/core";

const HelpDialog = ({ isOpen, onClose }) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Live AI - Quick Reminder"
      className="laia-help-dialog"
    >
      <div className={Classes.DIALOG_BODY} useOverflowScrollContainer={true}>
        <p>
          <strong>Live AI</strong> v.27, February 2026 by{" "}
          <a href="https://github.com/sponsors/fbgallet" target="_blank">
            Fabrice Gallet
          </a>
        </p>
        <p>
          💡 Remember that you can directly ask for help in the Chat panel if
          the Get Help tool is enabled: the agent will go through the document
          to respond to you as precisely as possible to guide you !
        </p>
        <Divider />
        <strong>Set Hotkeys for most useful commands</strong>:
        <br />
        Remember to define or customize hotkeys for commands (via native Roam
        Command Palette) to access them quickly:
        <ul>
          <li>
            <em>Context Menu</em> (default hotkeys:{" "}
            <code>Cmd/Win + Ctrl + a</code> or{" "}
            <code>Cmd/Win + rigth-click</code>)
          </li>
          <li>
            <em>Ask AI (prompt in focused/selected blocks)</em> (also to
            continue a conversation)
          </li>
          <li>
            <em>Open Chat panel</em>
          </li>
          <li>
            <em>Start/Pause recording your vocal note</em>
            <br />
            (you can dictate a command directly and route it to AI generative or
            Live Outliner if an outline is active)
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
            stored chats: <code>#liveai/chat</code>
          </li>
          <li>
            stored skills: <code>#liveai/skills</code>
          </li>
          <li>
            skills resources (loaded when useful):{" "}
            <code>#liveai/skills-resources</code>
          </li>
          <li>
            favorite Live Outlines: <code>#liveai/outline</code>
          </li>
          <li>
            favorite templates for Live Outliner: <code>#liveai/template</code>
          </li>
        </ul>
        <strong>Useful syntax in Query agents or Ask Your Graph</strong>:
        <ul>
          <li>
            <code>&</code> or <code>+</code> mean 'and'
          </li>
          <li>
            <code>|</code> means 'or'
          </li>
          <li>
            <code>-</code> means 'not'
          </li>
          <li>
            <code>*</code> for fuzzy search, <code>~</code> for semantic search
          </li>
          <li>
            <code>parent {">"} direct children</code>
            {", "}
            <code>direct children {"<"} parent</code>
            {", "}
            <code>parent {">>"} children (up to depth=3)</code>
            {", "}
            <code>children {"<<"} parent</code>
            {", "}
            for hierarchical conditions,
            <code>A {"<=>"} B</code> or <code>A {"<<=>>"} B</code>
            {", "} for bi-directional conditions (in Ask Your Graph)
          </li>
        </ul>
        <strong>
          Voice recorder hotkeys (⚠️ available only when started by a mouse
          click)
        </strong>
        <ul>
          <li>
            Pause/Resume: <code>Spacebar</code>. Stop, Rewind:{" "}
            <code>Escape</code> or <code>Backspace</code>
          </li>
          <li>
            Transcribe: <code>T or Enter</code>
          </li>
          <li>
            Translate (in English): <code>E</code>
          </li>
          <li>
            Ask AI, eventually using vocal note as prompt: <code>A</code>
          </li>
          <li>
            Ask Your Graph, eventually using vocal note as prompt:{" "}
            <code>G</code>
          </li>
          <li>
            Live Outliner: <code>O</code>
          </li>
        </ul>
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
          or on Bluesky:
          <a
            href="https://bsky.app/profile/fbgallet.bsky.social"
            target="_blank"
          >
            @fbgallet.bsky.social
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
        <Divider />
        <strong>Documentation</strong>
        <ul>
          <li>
            Basic instructions:{" "}
            <ul>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blame/main/README.md#1-getting-started"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Getting started (simple prompt, basics, chat, built-in
                  prompts, context...)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#2-model-specific-features-voice-web-search-image"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Model-Specific Features (Voice, Web search, Image)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/README.md#3-going-further-to-get-better-answers"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Going further to get better answers
                </a>
              </li>
            </ul>
          </li>
          <li>
            Detailed instructions on:{" "}
            <ul>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/generative-ai.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Generative AI (custom prompts & styles, context definition,
                  SmartBlocks...)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/query-agents.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Query Agents (NL queries, :q queries, Ask Your Grap)
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/live-outliner.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Live Outliner
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/chat-agent.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Chat Agent
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/liveai-skills.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Skills for Chat Agent
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  AI Providers, API keys, pricing...
                </a>
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </Dialog>
  );
};
export default HelpDialog;
