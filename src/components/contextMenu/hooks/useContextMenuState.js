import { useState, useEffect, useRef } from "react";
import {
  extensionStorage,
  defaultStyle,
  includeChildrenByDefault,
  logPagesNbDefault,
  defaultModel,
} from "../../..";
import { BUILTIN_COMMANDS } from "../../../ai/prebuildCommands";
import { mcpManager } from "../../../ai/agents/mcp-agent/mcpManager";

const voidRoamContext = {
  linkedRefs: false,
  linkedPages: false,
  sidebar: false,
  page: false,
  pageViewUid: null,
  pageArgument: [],
  logPages: false,
  logPagesArgument: 0,
  block: false,
  blockArgument: [],
  linkedRefsArgument: [],
};

export const useContextMenuState = () => {
  // UI State
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuToDisplay, setIsMenuToDisplay] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [displayModelsMenu, setDisplayModelsMenu] = useState(false);
  const [displayAddPrompt, setDisplayAddPrompt] = useState(false);
  const [isMCPConfigOpen, setIsMCPConfigOpen] = useState(false);

  // Command and Context State
  const [commands, setCommands] = useState(BUILTIN_COMMANDS);
  const [userCommands, setUserCommands] = useState([]);
  const [liveOutlines, setLiveOutlines] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [stableMcpCommands, setStableMcpCommands] = useState([]);
  const [activeCommand, setActiveCommand] = useState();

  // User Preferences
  const [isChildrenTreeToInclude, setIsChildrenTreeToInclude] = useState(
    includeChildrenByDefault
  );
  const [targetBlock, setTargetBlock] = useState("auto");
  const [style, setStyle] = useState(defaultStyle);
  const [isPinnedStyle, setIsPinnedStyle] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [model, setModel] = useState(null);
  const [includePdfInContext, setIncludePdfInContext] = useState(false);

  // Mode State
  const [isOutlinerAgent, setIsOutlinerAgent] = useState(false);
  const [isCompletionOnly, setIsCompletionOnly] = useState(false);
  const [isInConversation, setIsInConversation] = useState(false);

  // Context State
  const [roamContext, setRoamContext] = useState({ ...voidRoamContext });
  const [rootUid, setRootUid] = useState(null);
  const [dnpPeriod, setDnpPeriod] = useState("0");
  const [customDays, setCustomDays] = useState(parseInt(logPagesNbDefault));
  const [estimatedTokens, setEstimatedTokens] = useState(null);

  // Language State
  const [defaultLgg, setDefaultLgg] = useState(
    extensionStorage.get("translationDefaultLgg")
  );
  const [customLgg, setCustomLgg] = useState(
    extensionStorage.get("translationCustomLgg")
  );

  // Refs for current values
  const inputRef = useRef(null);
  const popoverRef = useRef(null);
  const focusedBlockUid = useRef(null);
  const focusedBlockContent = useRef(null);
  const selectedTextInBlock = useRef(null);
  const positionInRoamWindow = useRef(null);
  const selectedBlocks = useRef(null);
  const mainViewUid = useRef(null);
  const pageUid = useRef(null);
  const isZoom = useRef(false);
  const lastBuiltinCommand = useRef(null);
  const isFirstBlock = useRef(null);
  const roamContextRef = useRef(roamContext);
  const styleRef = useRef(style);
  const targetBlockRef = useRef(targetBlock);

  // Update roamContextRef when roamContext changes
  useEffect(() => {
    roamContextRef.current = roamContext;
  }, [roamContext]);

  // Update targetBlockRef when targetBlock changes
  useEffect(() => {
    targetBlockRef.current = targetBlock;
  }, [targetBlock]);

  // Update styleRef when style changes
  useEffect(() => {
    styleRef.current = style;
  }, [style]);

  // Handle close functionality
  const handleClose = (shouldResetContext = true) => {
    setIsOpen(false);
    focusedBlockUid.current = null;
    setIsMenuToDisplay(false);
    setDisplayModelsMenu(false);
    setTargetBlock("auto");
    setIsInConversation(false);
    setIsCompletionOnly(false);
    setIsOutlinerAgent(false);
    setIsHelpOpen(false);
    setIsMCPConfigOpen(false);
    setDnpPeriod("0");
    if (!isPinnedStyle) setStyle(defaultStyle);

    if (shouldResetContext) {
      setRoamContext({ ...voidRoamContext });
    }

    setIsChildrenTreeToInclude(includeChildrenByDefault);
    setIncludePdfInContext(true);
    selectedBlocks.current = null;
    selectedTextInBlock.current = null;
    isFirstBlock.current = null;
    mainViewUid.current = null;
    pageUid.current = null;
    isZoom.current = null;
  };

  return {
    // UI State
    isOpen,
    setIsOpen,
    isMenuToDisplay,
    setIsMenuToDisplay,
    isHelpOpen,
    setIsHelpOpen,
    position,
    setPosition,
    displayModelsMenu,
    setDisplayModelsMenu,
    displayAddPrompt,
    setDisplayAddPrompt,
    isMCPConfigOpen,
    setIsMCPConfigOpen,

    // Command and Context State
    commands,
    setCommands,
    userCommands,
    setUserCommands,
    liveOutlines,
    setLiveOutlines,
    templates,
    setTemplates,
    stableMcpCommands,
    setStableMcpCommands,
    activeCommand,
    setActiveCommand,

    // User Preferences
    isChildrenTreeToInclude,
    setIsChildrenTreeToInclude,
    targetBlock,
    setTargetBlock,
    style,
    setStyle,
    isPinnedStyle,
    setIsPinnedStyle,
    additionalPrompt,
    setAdditionalPrompt,
    model,
    setModel,
    includePdfInContext,
    setIncludePdfInContext,

    // Mode State
    isOutlinerAgent,
    setIsOutlinerAgent,
    isCompletionOnly,
    setIsCompletionOnly,
    isInConversation,
    setIsInConversation,

    // Context State
    roamContext,
    setRoamContext,
    rootUid,
    setRootUid,
    dnpPeriod,
    setDnpPeriod,
    customDays,
    setCustomDays,
    estimatedTokens,
    setEstimatedTokens,

    // Language State
    defaultLgg,
    setDefaultLgg,
    customLgg,
    setCustomLgg,

    // Refs
    inputRef,
    popoverRef,
    focusedBlockUid,
    focusedBlockContent,
    selectedTextInBlock,
    positionInRoamWindow,
    selectedBlocks,
    mainViewUid,
    pageUid,
    isZoom,
    lastBuiltinCommand,
    isFirstBlock,
    roamContextRef,
    styleRef,
    targetBlockRef,

    // Functions
    handleClose,
    voidRoamContext,
  };
};
