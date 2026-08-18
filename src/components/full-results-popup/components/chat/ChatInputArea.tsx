/**
 * Chat Input Area Component
 *
 * Renders the chat input controls including access mode selector, model selector, and text input
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Button,
  Icon,
  Popover,
  Tag,
  Tooltip,
  Menu,
  MenuDivider,
  MenuItem,
  Switch,
  Checkbox,
} from "@blueprintjs/core";
import {
  faMicrophone,
  faSpinner,
  faTowerBroadcast,
  faWandMagicSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import ModelsMenu from "../../../ModelsMenu";
import { ChatMode } from "../../types/types";
import ChatCommandSuggest from "./ChatCommandSuggest";
import ChatPageAutocomplete from "./ChatPageAutocomplete";
import { ChatToolsMenu } from "./ChatToolsMenu";
import {
  CHAT_TARGETS,
  getSidebarRootUids,
  targetsButtonLabel,
  type ChatTarget,
  type TargetConfig,
} from "../../../../ai/agents/chat-agent/targetScope";
import { CouncilConfigPanel } from "./CouncilConfigPanel";
import { CHAT_TOOLS } from "../../../../ai/agents/chat-agent/tools/chatToolsRegistry";
import { extractAllSkills } from "../../../../ai/agents/chat-agent/tools/skillsUtils";
import { ThinkingToggle } from "../../../ThinkingToggle";
import { BUILTIN_COMMANDS } from "../../../../ai/prebuildCommands";
import { BUILTIN_STYLES } from "../../../../ai/styleConstants";
import { getDisplayName } from "../../../../ai/modelRegistry";
import { CouncilConfig } from "../../../../ai/agents/council-agent/council-types";
import {
  AdvancedOptionsMenu,
  AdvancedOptionsState,
} from "./AdvancedOptionsMenu";
import { isThinkingModel, isThinkingOnly } from "../../../../ai/modelRegistry";
import {
  getProviderModels,
  isModelVisible,
  isModelFavorited,
  getOrderedProviders,
  getModelMetadata,
  getModelCapabilities,
} from "../../../../utils/modelConfigHelpers";
import {
  isLiveTranscriptionAvailable,
  liveTranscription,
} from "../../../../ai/liveTranscription";
// Holds the .chat-target-* rules used by the Context & target selector below
import "../../style/chatToolsMenu.css";

interface ChatInputAreaProps {
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isTyping: boolean;
  chatAccessMode: "Balanced" | "Full Access";
  onAccessModeChange: (mode: "Balanced" | "Full Access") => void;
  noTruncation?: boolean;
  onNoTruncationChange?: (value: boolean) => void;
  chatMode: ChatMode;
  onChatModeChange: (mode: ChatMode) => void;
  selectedModel: string;
  onModelSelect: (model: string) => void;
  chatInputRef: React.RefObject<HTMLTextAreaElement>;
  onCommandSelect: (
    command: any,
    isFromSlashCommand?: boolean,
    instantModel?: string,
  ) => void;
  availablePages: string[];
  isLoadingPages: boolean;
  onQueryPages: (query: string) => void;
  enabledTools: Set<string>;
  onToggleTool: (toolName: string) => void;
  chatTargetConfig?: TargetConfig;
  onToggleTarget?: (target: ChatTarget, column: "read" | "act") => void;
  chatTargetsPinned?: boolean;
  onToggleTargetsPin?: () => void;
  onToggleFollowRefs?: () => void;
  /** Number of blocks currently loaded in the chat context (icon state). */
  contextCount?: number;
  isAgentMode: boolean;
  onToggleAgentMode: (enabled: boolean) => void;
  selectedStyle?: string;
  onStyleChange?: (style: string) => void;
  customStyleTitles?: string[];
  isPinnedStyle?: boolean;
  onPinnedStyleChange?: (isPinned: boolean) => void;
  thinkingEnabled?: boolean;
  onThinkingChange?: (enabled: boolean) => void;
  // Image edition mode
  imageEditionMode?: boolean;
  hasGeneratedImage?: boolean; // Whether an image has been generated (to show /image-edit command)
  onExitImageEdition?: () => void;
  onEnterImageEdition?: () => void; // Enter image edition mode manually via slash command
  // Chat-specific slash command callbacks
  onClearChat?: () => void;
  onCloseChat?: () => void;
  onChatModeSetSimple?: () => void;
  onChatModeSetAgent?: () => void;
  onSaveChat?: () => void;
  onSaveChatDNP?: () => void;
  // Council mode
  councilConfig?: CouncilConfig;
  onCouncilConfigChange?: (config: CouncilConfig) => void;
  onChatModeSetCouncil?: () => void;
  // Advanced options
  advancedOptions?: AdvancedOptionsState;
  onAdvancedOptionsChange?: (options: AdvancedOptionsState) => void;
}

export const ChatInputArea: React.FC<ChatInputAreaProps> = ({
  chatInput,
  onChatInputChange,
  onSubmit,
  onStop,
  isTyping,
  chatAccessMode,
  onAccessModeChange,
  noTruncation = false,
  onNoTruncationChange,
  chatMode,
  onChatModeChange,
  selectedModel,
  onModelSelect,
  chatInputRef,
  onCommandSelect,
  availablePages,
  isLoadingPages,
  onQueryPages,
  enabledTools,
  onToggleTool,
  chatTargetConfig = { read: [], act: [] },
  onToggleTarget,
  chatTargetsPinned = false,
  onToggleTargetsPin,
  onToggleFollowRefs,
  contextCount = 0,
  isAgentMode,
  onToggleAgentMode,
  selectedStyle = "Normal",
  onStyleChange,
  customStyleTitles = [],
  isPinnedStyle = false,
  onPinnedStyleChange,
  thinkingEnabled = false,
  onThinkingChange,
  imageEditionMode = false,
  hasGeneratedImage = false,
  onExitImageEdition,
  onEnterImageEdition,
  onClearChat,
  onCloseChat,
  onChatModeSetSimple,
  onChatModeSetAgent,
  onSaveChat,
  onSaveChatDNP,
  councilConfig,
  onCouncilConfigChange,
  onChatModeSetCouncil,
  advancedOptions,
  onAdvancedOptionsChange,
}) => {
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isCommandSuggestOpen, setIsCommandSuggestOpen] = useState(false);
  const [slashCommandMode, setSlashCommandMode] = useState(false);
  const [slashStartIndex, setSlashStartIndex] = useState(-1); // Track where slash command started
  const [slashQuery, setSlashQuery] = useState(""); // Track the current slash query
  const [textLengthAtSlashTrigger, setTextLengthAtSlashTrigger] = useState(0); // Track text length when / was typed
  const [isPageAutocompleteOpen, setIsPageAutocompleteOpen] = useState(false);
  const [pageAutocompleteQuery, setPageAutocompleteQuery] = useState("");
  const [pageAutocompleteTrigger, setPageAutocompleteTrigger] = useState<
    "double-bracket" | "hash" | null
  >(null);
  const [pageAutocompleteStartIndex, setPageAutocompleteStartIndex] =
    useState(-1);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceRecorderAvailable, setIsVoiceRecorderAvailable] =
    useState(false);
  const [liveState, setLiveState] = useState(liveTranscription.getState());
  const [isAccessModeMenuOpen, setIsAccessModeMenuOpen] = useState(false);
  const [isStyleMenuOpen, setIsStyleMenuOpen] = useState(false);
  const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
  // Whether the right sidebar currently holds anything (drives the icon state).
  // Probed when the menu opens, so it reflects the sidebar as it is right now.
  const [sidebarHasContent, setSidebarHasContent] = useState(false);
  useEffect(() => {
    if (isTargetMenuOpen) setSidebarHasContent(getSidebarRootUids().length > 0);
  }, [isTargetMenuOpen]);

  /**
   * Mini glyphs on the toolbar button, one per active source outside the loaded
   * context: a small page for the main view, a small panel for the sidebar.
   * Red when that source is a WRITE target, blue when it is only read.
   *
   * Outside agent mode no tool runs, so an "act" target is inert: such a source
   * counts as read-only rather than being flagged red.
   */
  const targetBadges = (["main_view", "sidebar"] as ChatTarget[])
    .filter(
      (t) =>
        (isAgentMode && chatTargetConfig.act.includes(t)) ||
        chatTargetConfig.read.includes(t),
    )
    .map((t) => ({
      value: t,
      icon: CHAT_TARGETS.find((o) => o.value === t)?.icon || "document",
      isAct: isAgentMode && chatTargetConfig.act.includes(t),
    }));

  const actsOutsideContext = targetBadges.some((b) => b.isAct);

  /**
   * A source is shown in blue when it actually has something to offer.
   * The main view always does; the other two depend on their current state.
   */
  const targetHasContent = (target: ChatTarget): boolean => {
    if (target === "main_view") return true;
    if (target === "sidebar") return sidebarHasContent;
    return contextCount > 0;
  };
  const commandSuggestInputRef = useRef<HTMLInputElement>(null);

  const allStyles = [...BUILTIN_STYLES, ...customStyleTitles];

  // Load available skills from Roam graph
  const availableSkills = useMemo(() => {
    try {
      return extractAllSkills();
    } catch {
      return [];
    }
  }, []);

  // Chat-specific slash commands (handled directly, not sent to LLM)
  // Commands are context-sensitive: image edit commands only shown when relevant
  const CHAT_SLASH_COMMANDS = [
    {
      id: "chat-clear",
      name: "Clear conversation",
      prompt: "/clear",
      isChatCommand: true,
      keyWords: "clear reset",
      category: "CHAT",
      icon: "trash",
    },
    {
      id: "chat-exit",
      name: "Close chat panel",
      prompt: "/exit",
      isChatCommand: true,
      keyWords: "exit close quit",
      category: "CHAT",
      icon: "cross",
    },
    // Show "Enter image edition mode" only when an image exists but we're NOT already editing
    ...(hasGeneratedImage && !imageEditionMode
      ? [
          {
            id: "chat-image-edit",
            name: "Image edition mode",
            prompt: "/image-edit",
            isChatCommand: true,
            keyWords: "image-edit edition mode picture",
            category: "CHAT",
            icon: "media",
          },
        ]
      : []),
    // Show exit commands only when in image edition mode
    ...(imageEditionMode
      ? [
          {
            id: "chat-exit-edit",
            name: "Exit image edition mode",
            prompt: "/exit-edit",
            isChatCommand: true,
            keyWords: "exit-edit edit stop image",
            category: "CHAT",
            icon: "disable",
          },
          {
            id: "chat-conversation",
            name: "Switch to conversation mode",
            prompt: "/conversation",
            isChatCommand: true,
            keyWords: "conversation chat talk mode",
            category: "CHAT",
            icon: "chat",
          },
        ]
      : []),
    {
      id: "chat-mode-simple",
      name: "Chat mode (no tools)",
      prompt: "/chat",
      isChatCommand: true,
      keyWords: "chat simple mode no tools",
      category: "CHAT",
      icon: "comment",
    },
    {
      id: "chat-mode-agent",
      name: "Agent mode (with tools)",
      prompt: "/agent",
      isChatCommand: true,
      keyWords: "agent tools mode",
      category: "CHAT",
      icon: "build",
    },
    {
      id: "chat-mode-council",
      name: "Council mode (multi-LLM deliberation)",
      prompt: "/council",
      isChatCommand: true,
      keyWords: "council deliberation multi llm evaluate parallel",
      category: "CHAT",
      icon: "people",
    },
    {
      id: "chat-save",
      name: "Save conversation",
      prompt: "/save",
      isChatCommand: true,
      keyWords: "save insert chat",
      category: "CHAT",
      icon: "floppy-disk",
    },
    {
      id: "chat-save-dnp",
      name: "Save on Today DNP",
      prompt: "/save-dnp",
      isChatCommand: true,
      keyWords: "save insert daily dnp today conversation",
      category: "CHAT",
      icon: "calendar",
    },
    // Tool slash commands: /toolname forces the use of the tool for this turn
    ...Object.entries(CHAT_TOOLS).map(([name, info]) => ({
      id: `chat-tool-${name}`,
      name: `Use ${name}${!enabledTools.has(name) ? " (disabled)" : ""}`,
      prompt: `/${name}`,
      isChatCommand: true,
      keyWords: `${name} tool ${info.category} use force`,
      category: "TOOLS",
      icon:
        info.category === "edit"
          ? "edit"
          : info.category === "context"
            ? "add-to-artifact"
            : "wrench",
    })),
    // Individual skill slash commands: /skillname forces use of that specific skill
    ...availableSkills.map((skill) => ({
      id: `chat-skill-${skill.uid}`,
      name: `Skill: ${skill.name}`,
      prompt: `/${skill.name.toLowerCase().replace(/\s+/g, "-")}`,
      isChatCommand: true,
      keyWords: `${skill.name} skill ${skill.description || ""}`,
      category: "SKILLS",
      icon: "lightbulb",
    })),
  ];

  // Track if component is mounted to prevent setState on unmounted component
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleModelSelection = async ({ model }: { model: string }) => {
    // Model was changed via ModelsMenu callback
    // Update the model in parent component
    onModelSelect(model);
    setIsModelMenuOpen(false);
  };

  const handleCommandSelect = (
    command: any,
    fromSlash: boolean = false,
    instantModel: string = "",
  ) => {
    // Handle chat-specific commands directly
    if (command.isChatCommand) {
      // Tool commands: insert "Use 'tool_name': " prefix instead of clearing
      // Skill commands: insert "Use 'live_ai_skills': skill_name: " prefix
      if (
        typeof command.id === "string" &&
        (command.id.startsWith("chat-tool-") ||
          command.id.startsWith("chat-skill-"))
      ) {
        let prefix: string;
        if (command.id.startsWith("chat-tool-")) {
          const toolName = command.id.replace("chat-tool-", "");
          prefix = `Use '${toolName}': `;
        } else {
          // Extract skill name from the command name (format: "Skill: <name>")
          const skillName = command.name.replace("Skill: ", "");
          prefix = `Use 'live_ai_skills': ${skillName}: `;
        }
        // Get remaining text (anything after the slash command)
        let remainingText = "";
        if (fromSlash && slashStartIndex !== -1) {
          const beforeSlash = chatInput.substring(0, slashStartIndex);
          const afterSlash = chatInput.substring(slashStartIndex + 1);
          const spaceIndex = afterSlash.indexOf(" ");
          const afterSlashCommand =
            spaceIndex === -1 ? "" : afterSlash.substring(spaceIndex + 1);
          remainingText = (
            beforeSlash.trimEnd() +
            " " +
            afterSlashCommand.trimStart()
          ).trim();
        }
        onChatInputChange(remainingText ? `${prefix}${remainingText}` : prefix);
        setIsCommandSuggestOpen(false);
        setSlashCommandMode(false);
        setSlashStartIndex(-1);
        setSlashQuery("");
        setTextLengthAtSlashTrigger(0);
        // Focus and place cursor at end
        setTimeout(() => {
          if (chatInputRef.current) {
            chatInputRef.current.focus();
            const len = chatInputRef.current.value.length;
            chatInputRef.current.selectionStart = len;
            chatInputRef.current.selectionEnd = len;
          }
        }, 0);
        return;
      }

      onChatInputChange("");
      setIsCommandSuggestOpen(false);
      setSlashCommandMode(false);
      setSlashStartIndex(-1);
      setSlashQuery("");
      setTextLengthAtSlashTrigger(0);

      if (command.id === "chat-clear" && onClearChat) {
        onClearChat();
      } else if (command.id === "chat-exit" && onCloseChat) {
        onCloseChat();
      } else if (command.id === "chat-image-edit" && onEnterImageEdition) {
        onEnterImageEdition();
      } else if (
        (command.id === "chat-exit-edit" ||
          command.id === "chat-conversation") &&
        onExitImageEdition
      ) {
        onExitImageEdition();
      } else if (command.id === "chat-mode-simple" && onChatModeSetSimple) {
        onChatModeSetSimple();
      } else if (command.id === "chat-mode-agent" && onChatModeSetAgent) {
        onChatModeSetAgent();
      } else if (command.id === "chat-mode-council" && onChatModeSetCouncil) {
        onChatModeSetCouncil();
      } else if (command.id === "chat-save" && onSaveChat) {
        onSaveChat();
      } else if (command.id === "chat-save-dnp" && onSaveChatDNP) {
        onSaveChatDNP();
      }
      return;
    }

    onCommandSelect(command, fromSlash, instantModel);
    setIsCommandSuggestOpen(false);
    setSlashCommandMode(false);
    setSlashStartIndex(-1);
    setSlashQuery("");
    setTextLengthAtSlashTrigger(0);
  };

  const handlePageSelect = (pageTitle: string) => {
    if (pageAutocompleteStartIndex === -1 || !pageAutocompleteTrigger) return;

    const triggerLength = pageAutocompleteTrigger === "double-bracket" ? 2 : 1;
    const replacement =
      pageAutocompleteTrigger === "double-bracket"
        ? `[[${pageTitle}]]`
        : `#[[${pageTitle}]]`;

    const replaceStart = pageAutocompleteStartIndex;
    const replaceEnd =
      pageAutocompleteStartIndex + triggerLength + pageAutocompleteQuery.length;
    const newValue =
      chatInput.substring(0, replaceStart) +
      replacement +
      chatInput.substring(replaceEnd);

    onChatInputChange(newValue);

    // Close autocomplete
    setIsPageAutocompleteOpen(false);
    setPageAutocompleteQuery("");
    setPageAutocompleteTrigger(null);
    setPageAutocompleteStartIndex(-1);

    // Maintain focus on textarea
    setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
        // Move cursor to end of inserted page reference
        const cursorPosition = replaceStart + replacement.length;
        chatInputRef.current.selectionStart = cursorPosition;
        chatInputRef.current.selectionEnd = cursorPosition;
      }
    }, 0);
  };

  // Detect slash command trigger
  const handleInputChange = (value: string, cursorPosition?: number) => {
    // Update parent state first
    onChatInputChange(value);
    const textBeforeCursor = value.substring(0, cursorPosition ?? value.length);

    // If already in slash mode, track changes relative to the slash start position
    if (slashCommandMode && slashStartIndex !== -1) {
      // Check if the slash is still there
      if (value.charAt(slashStartIndex) !== "/") {
        // Slash was deleted, close the menu and maintain focus
        setSlashCommandMode(false);
        setIsCommandSuggestOpen(false);
        setSlashStartIndex(-1);
        setSlashQuery("");
        setTextLengthAtSlashTrigger(0);
        // Maintain focus on the textarea
        setTimeout(() => {
          if (chatInputRef.current) {
            chatInputRef.current.focus();
          }
        }, 0);
        return;
      }

      // Calculate how many new characters were typed after the slash
      // by comparing current length to the length when slash was triggered
      const newCharsCount = value.length - textLengthAtSlashTrigger;

      // The query is only the NEW characters typed after the slash (not pre-existing text)
      const queryText = value.substring(
        slashStartIndex + 1,
        slashStartIndex + 1 + newCharsCount,
      );

      // Check if a space was typed in the query
      if (queryText.includes(" ")) {
        setSlashCommandMode(false);
        setIsCommandSuggestOpen(false);
        setSlashStartIndex(-1);
        setSlashQuery("");
        setTextLengthAtSlashTrigger(0);
        // Maintain focus on the textarea
        setTimeout(() => {
          if (chatInputRef.current) {
            chatInputRef.current.focus();
          }
        }, 0);
        return;
      }

      // Update the query for filtering
      setSlashQuery(queryText);
      return;
    }

    // Not in slash mode - detect new slash trigger
    // Only trigger when user just typed a "/"
    const lastSlashIndex = value.lastIndexOf("/");
    const hasSlash = lastSlashIndex !== -1;

    if (hasSlash) {
      // Extract the part before the last "/"
      const beforeSlash = value.substring(0, lastSlashIndex);
      // Extract the part after the last "/" up to the next space (this is the potential command query)
      const afterSlash = value.substring(lastSlashIndex + 1);
      const nextSpaceIndex = afterSlash.indexOf(" ");
      // The query is only the text between "/" and the next space (or end of string)
      const slashQueryText =
        nextSpaceIndex !== -1
          ? afterSlash.substring(0, nextSpaceIndex)
          : afterSlash;

      // Check if this is likely a URL (has :// before it)
      const isLikelyUrl = beforeSlash.includes("://");

      // Check if the character before slash is alphanumeric (part of a word)
      const charBeforeSlash =
        lastSlashIndex > 0 ? beforeSlash.charAt(beforeSlash.length - 1) : "";
      const isPartOfWord = /[a-zA-Z0-9]/.test(charBeforeSlash);

      // Check if there's a space immediately after the slash (user typed "/ ")
      const hasSpaceImmediatelyAfterSlash = afterSlash.startsWith(" ");

      // Only trigger slash mode if:
      // 1. Not a URL
      // 2. Not part of a word (slash at start or after whitespace/punctuation)
      // 3. No space immediately after the slash
      // 4. Query is short enough to be a fresh slash command (not pasted long text)
      const isLikelyFreshSlash = slashQueryText.length <= 20;

      if (
        !isLikelyUrl &&
        !isPartOfWord &&
        !hasSpaceImmediatelyAfterSlash &&
        isLikelyFreshSlash
      ) {
        setSlashCommandMode(true);
        setIsCommandSuggestOpen(true);
        setSlashStartIndex(lastSlashIndex);
        setSlashQuery(""); // Start with empty query - user just typed "/"
        setTextLengthAtSlashTrigger(value.length); // Remember length at trigger time
      }
    }

    // Detect page autocomplete triggers ([[ and #)
    const pageAutocompleteCandidates: Array<{
      trigger: "double-bracket" | "hash";
      startIndex: number;
      query: string;
    }> = [];

    // Trigger 1: [[page
    const lastDoubleBracketIndex = textBeforeCursor.lastIndexOf("[[");
    const hasDoubleBracket = lastDoubleBracketIndex !== -1;

    if (hasDoubleBracket) {
      // Extract the part after the last "[["
      const afterBrackets = textBeforeCursor.substring(
        lastDoubleBracketIndex + 2,
      );
      const hasClosingBracket = afterBrackets.includes("]]");
      const hasSpace = afterBrackets.startsWith(" ");

      // Only open if there's at least one character and no space immediately after [[
      if (!hasClosingBracket && !hasSpace && afterBrackets.length > 0) {
        pageAutocompleteCandidates.push({
          trigger: "double-bracket",
          startIndex: lastDoubleBracketIndex,
          query: afterBrackets,
        });
      }
    }

    // Trigger 2: #page
    const lastHashIndex = textBeforeCursor.lastIndexOf("#");
    const hasHash = lastHashIndex !== -1;

    if (hasHash) {
      const beforeHash = textBeforeCursor.substring(0, lastHashIndex);
      const afterHash = textBeforeCursor.substring(lastHashIndex + 1);
      const charBeforeHash =
        lastHashIndex > 0 ? beforeHash.charAt(beforeHash.length - 1) : "";
      const isPartOfWord = /[a-zA-Z0-9_]/.test(charBeforeHash);
      const hasSpaceImmediatelyAfterHash = afterHash.startsWith(" ");
      const hasBracketAfterHash = afterHash.startsWith("[[");
      const isSingleHashToken = /^[^\s\[\]]+$/.test(afterHash);

      if (
        !isPartOfWord &&
        !hasSpaceImmediatelyAfterHash &&
        !hasBracketAfterHash &&
        isSingleHashToken
      ) {
        pageAutocompleteCandidates.push({
          trigger: "hash",
          startIndex: lastHashIndex,
          query: afterHash,
        });
      }
    }

    const activePageAutocomplete = pageAutocompleteCandidates.reduce<{
      trigger: "double-bracket" | "hash";
      startIndex: number;
      query: string;
    } | null>((latest, candidate) => {
      if (!latest || candidate.startIndex > latest.startIndex) {
        return candidate;
      }
      return latest;
    }, null);

    if (activePageAutocomplete) {
      if (!isPageAutocompleteOpen) {
        setIsPageAutocompleteOpen(true);
      }
      setPageAutocompleteQuery(activePageAutocomplete.query);
      setPageAutocompleteTrigger(activePageAutocomplete.trigger);
      setPageAutocompleteStartIndex(activePageAutocomplete.startIndex);
      onQueryPages(activePageAutocomplete.query);
    } else if (isPageAutocompleteOpen) {
      setIsPageAutocompleteOpen(false);
      setPageAutocompleteQuery("");
      setPageAutocompleteTrigger(null);
      setPageAutocompleteStartIndex(-1);
    }
  };

  // Get slash query (now uses state for real-time tracking)
  const getSlashQuery = () => {
    return slashQuery;
  };

  // Generate model commands for slash mode matching
  const getModelCommands = () => {
    const commands: any[] = [];
    const orderedProviders = getOrderedProviders();
    const allProviders = [
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepSeek",
      "Grok",
      "OpenRouter",
      "Groq",
      "Ollama",
    ];

    const getPrefix = (provider: string) => {
      switch (provider) {
        case "OpenRouter":
          return "openRouter/";
        case "Groq":
          return "groq/";
        case "Ollama":
          return "ollama/";
        default:
          return "";
      }
    };

    const providersToProcess = [...orderedProviders];
    allProviders.forEach((p) => {
      if (!providersToProcess.includes(p)) {
        providersToProcess.push(p);
      }
    });

    let modelIndex = 0;
    providersToProcess.forEach((provider) => {
      const models = getProviderModels(provider);
      models.forEach((model) => {
        if (!isModelVisible(model.id)) return;
        const capabilities = getModelCapabilities(model.id);
        if (capabilities.includes("image")) return;

        const prefix = getPrefix(provider);
        const fullModelId = prefix + model.id;
        const metadata = getModelMetadata(model.id);

        commands.push({
          id: 9000 + modelIndex,
          name: model.name || model.id,
          prompt: fullModelId,
          category: "SWITCH MODEL",
          icon: "cog",
          keyWords: `${provider.toLowerCase()} ${model.id} model switch`,
          isModelCommand: true,
          modelProvider: provider,
          modelContextLength: metadata?.contextLength,
          isFavorite: isModelFavorited(model.id),
        });
        modelIndex++;
      });
    });

    return commands;
  };

  // Find first matching command for slash mode
  const findMatchingCommand = (query: string) => {
    if (!query) return null;

    const normalizedQuery = query.toLowerCase();

    // Check chat-specific slash commands first
    const chatMatch = CHAT_SLASH_COMMANDS.find((cmd) => {
      const promptMatch = cmd.prompt
        .slice(1) // Remove leading "/"
        .toLowerCase()
        .startsWith(normalizedQuery);
      const nameMatch = cmd.name.toLowerCase().includes(normalizedQuery);
      const keywordsMatch = cmd.keyWords
        ?.toLowerCase()
        .includes(normalizedQuery);
      return promptMatch || nameMatch || keywordsMatch;
    });

    if (chatMatch) return chatMatch;

    // Filter chat-compatible commands
    const compatibleCommands = BUILTIN_COMMANDS.filter((cmd) => {
      if (cmd.isIncompatibleWith?.chat === true) return false;
      if (
        cmd.id === 0 ||
        cmd.id === 1 ||
        cmd.id === 2 ||
        cmd.id === 100 ||
        cmd.id === 102
      )
        return false;
      if (!query && cmd.isSub) return false; // Hide sub-items when no query
      return true;
    });

    // Find first matching builtin command
    const builtinMatch = compatibleCommands.find((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(normalizedQuery);
      const keywordsMatch = cmd.keyWords
        ?.toLowerCase()
        .includes(normalizedQuery);
      return nameMatch || keywordsMatch;
    });

    if (builtinMatch) return builtinMatch;

    // Also search model commands
    const modelCommands = getModelCommands();
    return modelCommands.find((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(normalizedQuery);
      const keywordsMatch = cmd.keyWords
        ?.toLowerCase()
        .includes(normalizedQuery);
      return nameMatch || keywordsMatch;
    });
  };

  // Auto-resize textarea when content changes externally (e.g., cleared after submit)
  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = "auto";
      chatInputRef.current.style.height =
        chatInputRef.current.scrollHeight + "px";
    }
  }, [chatInput, chatInputRef]);

  // Monitor recording state and VoiceRecorder availability
  useEffect(() => {
    const checkRecordingState = () => {
      const recordButton = document.querySelector(".speech-record-button");

      // Check if VoiceRecorder is mounted and not disabled
      const isMicrophoneSlashPresent =
        document.querySelector('svg[data-icon="microphone-slash"]') !== null;
      const isAvailable = recordButton !== null && !isMicrophoneSlashPresent;

      setIsVoiceRecorderAvailable(isAvailable);

      if (recordButton && isAvailable) {
        const isListening =
          recordButton.querySelector('svg[data-icon="record-vinyl"]') !== null;
        setIsRecording(isListening);
      } else {
        setIsRecording(false);
      }
    };

    // Check immediately
    checkRecordingState();

    // Poll for changes (VoiceRecorder updates its DOM)
    const interval = setInterval(checkRecordingState, 100);

    return () => clearInterval(interval);
  }, []);

  // Expose the onChatInputChange callback to VoiceRecorder via a global reference
  useEffect(() => {
    (window as any).__chatInputChangeHandler = onChatInputChange;
    (window as any).__chatInputRef = chatInputRef;

    return () => {
      delete (window as any).__chatInputChangeHandler;
      delete (window as any).__chatInputRef;
    };
  }, [onChatInputChange, chatInputRef]);

  // ==================== Live transcription ====================
  // The session lives outside of this component (module singleton), so its
  // state is mirrored here, and the callbacks it holds are read through refs:
  // it keeps them for the whole session, across re-renders.
  const onChatInputChangeRef = useRef(onChatInputChange);
  onChatInputChangeRef.current = onChatInputChange;
  const chatInputValueRef = useRef(chatInput);
  chatInputValueRef.current = chatInput;
  const startedLiveHereRef = useRef(false);

  // Dictated text goes to the input, where the user still validates it: the
  // message is never sent by voice.
  const appendToChatInput = (text: string) => {
    const textarea = chatInputRef.current;
    const current = textarea ? textarea.value : chatInputValueRef.current || "";
    // Deltas come with their own leading space: keep a single separator.
    const chunk = /\s$/.test(current) ? text.replace(/^\s+/, "") : text;
    if (!chunk) return;
    const separator =
      current && !/^\s/.test(chunk) && !/\s$/.test(current) ? " " : "";
    const next = current + separator + chunk;
    onChatInputChangeRef.current(next);
    chatInputValueRef.current = next;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
    // Only move the caret if the user is actually in the input: they may be
    // reading the conversation while dictating.
    if (document.activeElement === textarea)
      textarea.setSelectionRange(next.length, next.length);
  };

  // Validation, by Enter or by the send button: mute right away rather than
  // waiting for the answer to start, so the tail of the dictation can't land in
  // the input that has just been emptied.
  const handleSubmit = () => {
    if (startedLiveHereRef.current) liveTranscription.pauseForResponse();
    onSubmit();
  };

  const handleLiveClick = () => {
    // Hand the focus back to the input: left on the button, Enter would toggle
    // live transcription again instead of sending the dictated message.
    chatInputRef.current?.focus();
    if (liveTranscription.isActive()) {
      startedLiveHereRef.current = false;
      liveTranscription.stop();
      return;
    }
    startedLiveHereRef.current = true;
    liveTranscription.start({ sink: { append: appendToChatInput } });
  };

  useEffect(() => {
    const unsubscribe = liveTranscription.subscribe(setLiveState);
    return () => {
      unsubscribe();
      // Closing the chat must not leave a billed session running with a sink
      // pointing at an unmounted input.
      if (startedLiveHereRef.current) liveTranscription.stop();
    };
  }, []);

  // Mute while the answer is being generated, resume as soon as it is over —
  // unless the user turned the mode off in the meantime (stop() clears it).
  useEffect(() => {
    if (!liveTranscription.isActive() || !startedLiveHereRef.current) return;
    if (isTyping) liveTranscription.pauseForResponse();
    else liveTranscription.resumeAfterResponse();
  }, [isTyping]);

  // Handle microphone button click - trigger VoiceRecorder
  const handleMicClick = () => {
    const recordButton = document.querySelector(
      ".speech-record-button",
    ) as HTMLElement;
    if (recordButton) {
      recordButton.click();
    }
  };

  // Handle transcribe click during recording
  const handleTranscribeClick = () => {
    const transcribeButton = document.querySelector(
      ".speech-transcribe",
    ) as HTMLElement;
    if (transcribeButton) {
      // Mark that we're in chat mode for VoiceRecorder to detect
      document.body.setAttribute("data-chat-transcribe-active", "true");
      transcribeButton.click();
    }
  };

  return (
    <div className="full-results-chat-input-area">
      {imageEditionMode && (
        <div className="full-results-chat-edition-mode-bar">
          <Tag
            intent="warning"
            icon="media"
            onRemove={onExitImageEdition}
            large={false}
          >
            Image Edit Mode
          </Tag>
        </div>
      )}
      <div className="full-results-chat-controls">
        <Tooltip
          content={`Access Mode: ${chatAccessMode}`}
          openOnTargetFocus={false}
          isOpen={isAccessModeMenuOpen ? false : undefined}
        >
          <div className="full-results-chat-access-mode">
            <Popover
              isOpen={isAccessModeMenuOpen}
              onInteraction={(nextOpenState) =>
                setIsAccessModeMenuOpen(nextOpenState)
              }
              content={
                <Menu>
                  <MenuItem
                    text={
                      <span className="full-results-chat-access-menu-item">
                        <Icon icon="shield" size={12} />
                        Balanced
                      </span>
                    }
                    active={chatAccessMode === "Balanced"}
                    onClick={() => {
                      onAccessModeChange("Balanced");
                      setIsAccessModeMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    text={
                      <span className="full-results-chat-access-menu-item">
                        <Icon icon="unlock" size={12} />
                        Full Access
                      </span>
                    }
                    active={chatAccessMode === "Full Access"}
                    onClick={() => {
                      onAccessModeChange("Full Access");
                      setIsAccessModeMenuOpen(false);
                    }}
                  />
                  {onNoTruncationChange && (
                    <>
                      <MenuDivider />
                      <Tooltip
                        content={
                          <span style={{ maxWidth: 220, display: "block" }}>
                            {chatAccessMode === "Balanced" ? (
                              "No truncation is only available in Full Access mode."
                            ) : (
                              <>
                                By default, context is adaptively truncated to
                                manage costs, depending on the model's context
                                window and context length.
                                <br />
                                <br />
                                Enable to send full context without any
                                truncation.
                              </>
                            )}
                          </span>
                        }
                        placement="left"
                        openOnTargetFocus={false}
                      >
                        <div>
                          <MenuItem
                            disabled={chatAccessMode === "Balanced"}
                            text={
                              <Switch
                                checked={
                                  chatAccessMode === "Full Access" &&
                                  noTruncation
                                }
                                disabled={chatAccessMode === "Balanced"}
                                label="No truncation"
                                onChange={() =>
                                  onNoTruncationChange(!noTruncation)
                                }
                                alignIndicator="right"
                                style={{ marginBottom: 0, fontSize: "12px" }}
                              />
                            }
                            shouldDismissPopover={false}
                          />
                        </div>
                      </Tooltip>
                    </>
                  )}
                </Menu>
              }
              placement="top"
            >
              <Button
                minimal
                small
                className="full-results-chat-toolbar-button"
                icon={chatAccessMode === "Balanced" ? "shield" : "unlock"}
                text={
                  chatAccessMode === "Full Access" && noTruncation
                    ? "∞"
                    : undefined
                }
              />
            </Popover>
          </div>
        </Tooltip>
        <div className="full-results-chat-tools-menu">
          <ChatToolsMenu
            enabledTools={enabledTools}
            onToggleTool={onToggleTool}
            isAgentMode={isAgentMode}
            onToggleAgentMode={onToggleAgentMode}
            permissions={{ contentAccess: chatAccessMode === "Full Access" }}
          />
        </div>
        {/* Always available: choosing what the assistant READS needs no tool,
            so this must not be gated on agent mode — only the "Act on" column
            is, since editing tools only exist there. */}
        <Tooltip
          content={`Context & target — ${targetsButtonLabel(
            chatTargetConfig,
            isAgentMode,
          )}`}
          openOnTargetFocus={false}
          isOpen={isTargetMenuOpen ? false : undefined}
        >
          <div className="full-results-chat-target-selector">
            <Popover
              isOpen={isTargetMenuOpen}
              onInteraction={(next) => setIsTargetMenuOpen(next)}
              content={
                <Menu>
                  <li className="bp3-menu-header">
                    <h6 className="bp3-heading">Context &amp; target</h6>
                  </li>
                  <div className="chat-target-intro">
                    <b>Read</b> adds the source to what the assistant sees.
                    <br />
                    <b>Act on</b> is where the editing tools (create / update /
                    delete block, Color Highlighter) apply their changes when
                    your request doesn't name a page or block — so you can read
                    one source and write to another.
                  </div>

                  <div className="chat-target-grid-header">
                    <span />
                    <span>Read</span>
                    <span className={!isAgentMode ? "chat-target-act-off" : ""}>
                      Act on
                    </span>
                  </div>

                  {CHAT_TARGETS.map((opt) => (
                    <div className="chat-target-grid-row" key={opt.value}>
                      {/* Tooltip wraps only the label: Blueprint renders an
                            inline-block target wrapper, which would break the
                            grid if it wrapped the whole row. */}
                      <Tooltip
                        content={
                          <div style={{ maxWidth: 280 }}>{opt.description}</div>
                        }
                        hoverOpenDelay={400}
                        position="left"
                        // Opening the popover moves focus inside it, which
                        // would pop the first row's tooltip unprompted.
                        openOnTargetFocus={false}
                      >
                        <span className="chat-target-grid-label">
                          <Icon
                            icon={opt.icon as any}
                            size={12}
                            intent={
                              targetHasContent(opt.value)
                                ? "primary"
                                : undefined
                            }
                            style={{
                              marginRight: 6,
                              opacity: targetHasContent(opt.value) ? 1 : 0.45,
                            }}
                          />
                          {opt.label}
                        </span>
                      </Tooltip>
                      <Checkbox
                        checked={chatTargetConfig.read.includes(opt.value)}
                        onChange={() => onToggleTarget?.(opt.value, "read")}
                        style={{ marginBottom: 0 }}
                      />
                      <Checkbox
                        checked={chatTargetConfig.act.includes(opt.value)}
                        onChange={() => onToggleTarget?.(opt.value, "act")}
                        disabled={!isAgentMode}
                        style={{ marginBottom: 0 }}
                      />
                    </div>
                  ))}

                  {!isAgentMode && (
                    <div className="chat-target-note">
                      <Icon icon="info-sign" size={11} /> Enable{" "}
                      <b>Agent mode</b> (wrench button) to let the assistant
                      edit your graph and choose what it acts on. Reading works
                      without it.
                    </div>
                  )}

                  {isAgentMode && chatTargetConfig.act.length === 0 && (
                    <div className="chat-target-note">
                      No target ticked: the tools act on the loaded context, or
                      on the main view when the context is empty (asking you
                      once per session before touching anything you haven't
                      loaded).
                    </div>
                  )}

                  {isAgentMode &&
                    chatTargetConfig.act.some(
                      (t) => !chatTargetConfig.read.includes(t),
                    ) && (
                      <div className="chat-target-note chat-target-note-warning">
                        <Icon icon="warning-sign" size={11} intent="warning" />{" "}
                        Acting on something the agent can't read. Fine for
                        targeted edits ("highlight the word X", "add a block
                        here") — the tools find it themselves. Not enough for
                        content-based requests ("highlight all the verbs"),
                        which need Read ticked too.
                      </div>
                    )}

                  <MenuDivider />
                  <div className="chat-target-pin">
                    <Tooltip
                      content={
                        <div style={{ maxWidth: 280 }}>
                          What you see in a block includes the content behind
                          its references and embeds, so the tools can edit it
                          there too. Untick to restrict them to the text
                          physically stored in the targeted blocks.
                        </div>
                      }
                      hoverOpenDelay={400}
                      position="left"
                      openOnTargetFocus={false}
                    >
                      <Switch
                        checked={chatTargetConfig.followRefs !== false}
                        onChange={() => onToggleFollowRefs?.()}
                        labelElement={
                          <span>
                            <Icon
                              icon="link"
                              size={12}
                              intent={
                                chatTargetConfig.followRefs !== false
                                  ? "primary"
                                  : undefined
                              }
                              style={{ marginRight: 6, opacity: 0.8 }}
                            />
                            Follow ((refs)) &amp; {"{{embeds}}"}
                          </span>
                        }
                        style={{ marginBottom: 2 }}
                      />
                    </Tooltip>
                  </div>

                  <MenuDivider />
                  <div className="chat-target-pin">
                    <Switch
                      checked={!!chatTargetsPinned}
                      onChange={() => onToggleTargetsPin?.()}
                      labelElement={
                        <span>
                          <Icon
                            icon="pin"
                            size={12}
                            intent={chatTargetsPinned ? "primary" : undefined}
                            style={{ marginRight: 6, opacity: 0.8 }}
                          />
                          Keep this setup
                        </span>
                      }
                      style={{ marginBottom: 2 }}
                    />
                    <div className="chat-target-note">
                      {chatTargetsPinned
                        ? "This setup is kept when you reopen the panel."
                        : "Resets to reading the loaded context when you reopen the panel."}
                    </div>
                  </div>
                </Menu>
              }
              placement="top"
            >
              <span className="chat-target-button-wrap">
                <Button
                  minimal
                  small
                  className="full-results-chat-toolbar-button"
                  icon="locate"
                  intent={
                    actsOutsideContext
                      ? "danger"
                      : chatTargetsPinned
                        ? "primary"
                        : undefined
                  }
                />
                {targetBadges.length > 0 && (
                  <span className="chat-target-badge">
                    {targetBadges.map((b) => (
                      <Icon
                        key={b.value}
                        icon={b.icon as any}
                        size={9}
                        intent={b.isAct ? "danger" : "primary"}
                      />
                    ))}
                  </span>
                )}
              </span>
            </Popover>
          </div>
        </Tooltip>
        <Tooltip
          content={`Style: ${selectedStyle}`}
          openOnTargetFocus={false}
          isOpen={isStyleMenuOpen ? false : undefined}
        >
          <div className="full-results-chat-style-selector">
            <Popover
              isOpen={isStyleMenuOpen}
              onInteraction={(nextOpenState, event) => {
                // Don't close when clicking on the pin switch or its label
                const target = event?.target as HTMLElement;
                const isClickOnSwitch = target?.closest(".bp3-switch") !== null;

                if (!isClickOnSwitch) {
                  setIsStyleMenuOpen(nextOpenState);
                }
              }}
              content={
                <Menu>
                  <div style={{ padding: "8px 8px 4px 8px" }}>
                    <Switch
                      label="Pin style for session"
                      checked={isPinnedStyle}
                      onChange={(e) => {
                        if (onPinnedStyleChange) {
                          onPinnedStyleChange(e.currentTarget.checked);
                        }
                      }}
                      style={{ marginBottom: 0 }}
                    />
                  </div>
                  {allStyles.map((style) => (
                    <MenuItem
                      key={style}
                      text={style}
                      active={selectedStyle === style}
                      onClick={() => {
                        if (onStyleChange) {
                          onStyleChange(style);
                        }
                        if (!isPinnedStyle) {
                          setIsStyleMenuOpen(false);
                        }
                      }}
                    />
                  ))}
                </Menu>
              }
              placement="top"
            >
              <Button
                minimal
                small
                className="full-results-chat-toolbar-button"
                icon="style"
                intent={isPinnedStyle ? "primary" : "none"}
              />
            </Popover>
          </div>
        </Tooltip>
        <Tooltip
          // autoFocus={false}
          openOnTargetFocus={false}
          isOpen={isCommandSuggestOpen ? false : undefined}
          content={
            <p>
              Use built-in or custom prompt
              <br />
              or apply it to user input below
            </p>
          }
          hoverOpenDelay={400}
          hoverCloseDelay={400}
        >
          <div className="full-results-chat-command-suggest">
            <Popover
              minimal={true}
              isOpen={isCommandSuggestOpen}
              onInteraction={(nextOpenState) => {
                // Don't close in slash mode via interaction
                if (!slashCommandMode) {
                  setIsCommandSuggestOpen(nextOpenState);
                }
              }}
              content={
                <ChatCommandSuggest
                  onCommandSelect={handleCommandSelect}
                  inputRef={commandSuggestInputRef}
                  onClose={() => {
                    setIsCommandSuggestOpen(false);
                    setSlashCommandMode(false);
                    setSlashStartIndex(-1);
                    setSlashQuery("");
                    setTextLengthAtSlashTrigger(0);
                    // Refocus the input
                    setTimeout(() => {
                      if (chatInputRef.current) {
                        chatInputRef.current.focus();
                      }
                    }, 0);
                  }}
                  initialQuery={getSlashQuery()}
                  isSlashMode={slashCommandMode}
                  currentPrompt={chatInput}
                  selectedModel={selectedModel}
                  chatSlashCommands={CHAT_SLASH_COMMANDS}
                  onModelSwitch={(model: string) => {
                    // Clear only the slash command from input, preserve the rest
                    if (slashCommandMode && slashStartIndex !== -1) {
                      const beforeSlash = chatInput.substring(
                        0,
                        slashStartIndex,
                      );
                      // Find the end of the slash command (first space after slash, or end of string)
                      const afterSlash = chatInput.substring(
                        slashStartIndex + 1,
                      );
                      const spaceIndex = afterSlash.indexOf(" ");
                      const slashCommandEnd =
                        slashStartIndex +
                        1 +
                        (spaceIndex === -1 ? afterSlash.length : spaceIndex);
                      const afterSlashCommand =
                        chatInput.substring(slashCommandEnd);
                      // Combine before and after, trimming any extra space at the junction
                      const newInput = (
                        beforeSlash.trimEnd() +
                        " " +
                        afterSlashCommand.trimStart()
                      ).trim();
                      onChatInputChange(newInput);
                    }
                    // Switch the model
                    onModelSelect(model);
                    // Close slash mode
                    setSlashCommandMode(false);
                    setIsCommandSuggestOpen(false);
                    setSlashStartIndex(-1);
                    setSlashQuery("");
                    setTextLengthAtSlashTrigger(0);
                    // Refocus the input
                    setTimeout(() => {
                      if (chatInputRef.current) {
                        chatInputRef.current.focus();
                      }
                    }, 0);
                  }}
                />
              }
              placement="top"
              enforceFocus={false}
              autoFocus={false}
              canEscapeKeyClose={slashCommandMode}
            >
              <Button
                minimal
                small
                className="full-results-chat-toolbar-button"
                icon="rocket"
                onClick={() => {
                  if (!slashCommandMode) {
                    setIsCommandSuggestOpen(true);
                  }
                }}
              >
                Prompts
              </Button>
            </Popover>
          </div>
        </Tooltip>
        <Tooltip
          openOnTargetFocus={false}
          content="Switch AI model"
          isOpen={isModelMenuOpen ? false : undefined}
        >
          <div className="full-results-chat-model-selector">
            <Popover
              isOpen={isModelMenuOpen}
              onInteraction={(nextOpenState) =>
                setIsModelMenuOpen(nextOpenState)
              }
              content={
                <ModelsMenu
                  callback={handleModelSelection}
                  setModel={onModelSelect}
                  command={null}
                  prompt=""
                  isConversationToContinue={false}
                />
              }
              placement="top"
            >
              <Button
                minimal
                small
                className="full-results-chat-toolbar-button"
                icon="cog"
                text={getDisplayName(selectedModel)}
              />
            </Popover>
          </div>
        </Tooltip>
        <ThinkingToggle
          modelId={selectedModel}
          supportsThinking={isThinkingModel(selectedModel)}
          thinkingOnly={isThinkingOnly(selectedModel)}
          thinkingEnabled={thinkingEnabled}
          onThinkingChange={onThinkingChange || (() => {})}
        />
        <Tooltip
          content={
            chatMode === "council"
              ? "Exit council mode"
              : "LLM Council (multi-model deliberation/debate)"
          }
          openOnTargetFocus={false}
        >
          <Button
            minimal
            small
            icon="people"
            active={chatMode === "council"}
            intent={chatMode === "council" ? "primary" : "none"}
            onClick={() => {
              if (chatMode === "council") {
                onChatModeSetSimple?.();
              } else {
                onChatModeSetCouncil?.();
              }
            }}
          />
        </Tooltip>
        {advancedOptions && onAdvancedOptionsChange && (
          <div style={{ marginLeft: "auto" }}>
            <Tooltip content="Advanced options" openOnTargetFocus={false}>
              <AdvancedOptionsMenu
                options={advancedOptions}
                onOptionsChange={onAdvancedOptionsChange}
                selectedModel={selectedModel}
              />
            </Tooltip>
          </div>
        )}
      </div>

      {/* Future evolution: Chat Mode vs Deep Analysis - currently hidden
      <div className="full-results-chat-mode-toggle" style={{display: 'none'}}>
        <label>
          <input
            type="radio"
            name="chatMode"
            value="simple"
            checked={true}
            readOnly
          />
          <Icon icon="chat" size={12} style={{marginRight: '4px'}} />Chat Mode (Focus on provided results)
        </label>
        <label>
          <input
            type="radio"
            name="chatMode"
            value="agent"
            checked={false}
            disabled
          />
          <Icon icon="search" size={12} style={{marginRight: '4px'}} />Deep Analysis (Can explore with search tools)
        </label>
      </div>
      */}

      {/* Council config panel - shown when council mode is active */}
      {chatMode === "council" && councilConfig && onCouncilConfigChange && (
        <CouncilConfigPanel
          config={councilConfig}
          onConfigChange={onCouncilConfigChange}
          defaultModel={selectedModel}
          isRunning={isTyping}
        />
      )}

      <div className="full-results-chat-input-container">
        {isVoiceRecorderAvailable && (
          <Tooltip
            /* No usePortal={false} here: rendered inside the panel, the tooltip
               of a button sitting on its left edge gets clipped. Every other
               tooltip of the panel goes through a portal. */
            content={
              isRecording
                ? "Click to transcribe voice to text"
                : "Click to start voice recording"
            }
            hoverOpenDelay={500}
          >
            <Button
              minimal
              small
              className="full-results-chat-mic-button full-results-chat-toolbar-button"
              onClick={isRecording ? handleTranscribeClick : handleMicClick}
              disabled={isTyping}
            >
              {isRecording ? (
                <FontAwesomeIcon icon={faWandMagicSparkles} />
              ) : (
                <FontAwesomeIcon icon={faMicrophone} />
              )}
            </Button>
          </Tooltip>
        )}
        {/* Off by default, shown from the "..." advanced options. Hidden while a
            classic recording is in progress (the two modes are exclusive),
            unless a live session is running: it must stay stoppable. */}
        {isLiveTranscriptionAvailable() &&
          advancedOptions?.showLiveTranscription &&
          (!isRecording || liveState.active) && (
            <Tooltip
              content={
                liveState.connecting ? (
                  <p>Opening the live session, wait before speaking…</p>
                ) : liveState.active ? (
                  <p>
                    Stop live transcription
                    <br />
                    {liveState.paused
                      ? "Paused: it resumes as soon as you speak again (or once the answer is done)."
                      : "Listening… your words go to the input, you still validate them."}
                  </p>
                ) : (
                  <p>
                    Live transcription
                    <br />
                    Speak: your words appear in the input, and you send them
                    with Enter as usual.
                    <br />
                    The microphone pauses while the answer is generated.
                    <br />
                    ⚠️ Billed per minute of streamed audio (~$1/hour)
                  </p>
                )
              }
              hoverOpenDelay={500}
            >
              <Button
                minimal
                small
                className={`full-results-chat-mic-button full-results-chat-toolbar-button full-results-chat-live-button${
                  liveState.active
                    ? liveState.paused
                      ? " live-paused"
                      : " live-listening"
                    : ""
                }`}
                onClick={handleLiveClick}
              >
                {liveState.connecting ? (
                  <FontAwesomeIcon icon={faSpinner} spin />
                ) : (
                  <FontAwesomeIcon
                    icon={faTowerBroadcast}
                    beatFade={liveState.active && !liveState.paused}
                  />
                )}
              </Button>
            </Tooltip>
          )}
        <Popover
          minimal={true}
          isOpen={isPageAutocompleteOpen}
          onInteraction={(nextOpenState) => {
            // Don't close via interaction - only close when conditions are met
            if (!nextOpenState) {
              setIsPageAutocompleteOpen(false);
              setPageAutocompleteQuery("");
              setPageAutocompleteTrigger(null);
              setPageAutocompleteStartIndex(-1);
            }
          }}
          content={
            <ChatPageAutocomplete
              pages={availablePages}
              onPageSelect={handlePageSelect}
              isLoading={isLoadingPages}
              query={pageAutocompleteQuery}
            />
          }
          placement="top-start"
          enforceFocus={false}
          autoFocus={false}
          canEscapeKeyClose={true}
          targetTagName="div"
          fill={true}
        >
          <textarea
            ref={chatInputRef}
            placeholder="Write your prompt... (type / for commands, [[ or # for pages)"
            value={chatInput}
            onChange={(e) => {
              handleInputChange(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
              );
              // Auto-resize textarea
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();

                // In slash mode, execute the first matching command
                if (slashCommandMode) {
                  const query = getSlashQuery();
                  const matchingCommand = findMatchingCommand(query);

                  if (matchingCommand) {
                    // Clear only the slash command from input, preserve the rest
                    const beforeSlash = chatInput.substring(0, slashStartIndex);
                    // Find the end of the slash command (first space after slash, or end of string)
                    const afterSlash = chatInput.substring(slashStartIndex + 1);
                    const spaceIndex = afterSlash.indexOf(" ");
                    const slashCommandEnd =
                      slashStartIndex +
                      1 +
                      (spaceIndex === -1 ? afterSlash.length : spaceIndex);
                    const afterSlashCommand =
                      chatInput.substring(slashCommandEnd);
                    const newInput = (
                      beforeSlash.trimEnd() +
                      " " +
                      afterSlashCommand.trimStart()
                    ).trim();
                    onChatInputChange(newInput);

                    // Handle chat-specific commands directly
                    if (matchingCommand.isChatCommand) {
                      // Tool/skill commands: insert prefix via handleCommandSelect
                      if (
                        typeof matchingCommand.id === "string" &&
                        (matchingCommand.id.startsWith("chat-tool-") ||
                          matchingCommand.id.startsWith("chat-skill-"))
                      ) {
                        handleCommandSelect(matchingCommand, true);
                        return;
                      }

                      onChatInputChange("");
                      setSlashCommandMode(false);
                      setIsCommandSuggestOpen(false);
                      setSlashStartIndex(-1);
                      setSlashQuery("");
                      setTextLengthAtSlashTrigger(0);

                      if (matchingCommand.id === "chat-clear" && onClearChat) {
                        onClearChat();
                      } else if (
                        matchingCommand.id === "chat-exit" &&
                        onCloseChat
                      ) {
                        onCloseChat();
                      } else if (
                        matchingCommand.id === "chat-image-edit" &&
                        onEnterImageEdition
                      ) {
                        onEnterImageEdition();
                      } else if (
                        (matchingCommand.id === "chat-exit-edit" ||
                          matchingCommand.id === "chat-conversation") &&
                        onExitImageEdition
                      ) {
                        onExitImageEdition();
                      } else if (
                        matchingCommand.id === "chat-mode-simple" &&
                        onChatModeSetSimple
                      ) {
                        onChatModeSetSimple();
                      } else if (
                        matchingCommand.id === "chat-mode-agent" &&
                        onChatModeSetAgent
                      ) {
                        onChatModeSetAgent();
                      } else if (
                        matchingCommand.id === "chat-mode-council" &&
                        onChatModeSetCouncil
                      ) {
                        onChatModeSetCouncil();
                      } else if (
                        matchingCommand.id === "chat-save" &&
                        onSaveChat
                      ) {
                        onSaveChat();
                      } else if (
                        matchingCommand.id === "chat-save-dnp" &&
                        onSaveChatDNP
                      ) {
                        onSaveChatDNP();
                      }
                    }
                    // Handle model commands specially - just switch model, don't run command
                    else if (
                      matchingCommand.isModelCommand &&
                      matchingCommand.prompt
                    ) {
                      onModelSelect(matchingCommand.prompt);
                      // Close slash mode
                      setSlashCommandMode(false);
                      setIsCommandSuggestOpen(false);
                      setSlashStartIndex(-1);
                      setSlashQuery("");
                      setTextLengthAtSlashTrigger(0);
                    } else {
                      handleCommandSelect(matchingCommand, true); // true = from slash command
                    }
                  } else {
                    // No matching command, close slash mode and treat as normal input
                    setSlashCommandMode(false);
                    setIsCommandSuggestOpen(false);
                    setSlashStartIndex(-1);
                    setSlashQuery("");
                    setTextLengthAtSlashTrigger(0);
                  }
                } else {
                  // Normal submit
                  handleSubmit();
                }
              } else if (e.key === "Escape" && slashCommandMode) {
                // Close slash mode on Escape
                e.preventDefault();
                setSlashCommandMode(false);
                setIsCommandSuggestOpen(false);
                setSlashStartIndex(-1);
                setSlashQuery("");
                setTextLengthAtSlashTrigger(0);
              }
            }}
            disabled={isTyping}
            className="full-results-chat-input bp3-input"
            rows={1}
          />
        </Popover>
        {isTyping && onStop ? (
          <Button
            icon="stop"
            onClick={onStop}
            intent="danger"
            className="full-results-chat-send full-results-chat-stop"
          />
        ) : (
          <Button
            icon="send-message"
            onClick={handleSubmit}
            disabled={!chatInput.trim() || isTyping}
            intent="primary"
            className="full-results-chat-send"
          />
        )}
      </div>
    </div>
  );
};
