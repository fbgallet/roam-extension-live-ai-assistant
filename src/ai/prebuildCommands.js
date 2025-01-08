export const languages = [
  ["Arabic", "🇸🇦"],
  ["Bengali", "🇧🇩"],
  ["Dutch", "🇳🇱"],
  ["English", "🇺🇸"],
  ["French", "🇫🇷"],
  ["German", "🇩🇪"],
  ["Hindi", "🇮🇳"],
  ["Indonesian", "🇮🇩"],
  ["Italian", "🇮🇹"],
  ["Japanese", "🇯🇵"],
  ["Korean", "🇰🇷"],
  ["Mandarin Chinese", "🇨🇳"],
  ["Portuguese", "🇵🇹"],
  ["Russian", "🇷🇺"],
  ["Spanish", "🇪🇸"],
  ["Turkish", "🇹🇷"],
  ["Urdu", "🇵🇰"],
];

export const PREBUILD_COMMANDS = [
  { id: 10, name: "Selected blocks as prompt", category: "", onlyGen: true },
  {
    id: 11,
    name: "Translate to... (<default>)",
    prompt: "translate",
    category: "TRANSLATE",
    submenu: [
      1100, 1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110, 1111,
      1112, 1113, 1114, 1115, 1116, 1199,
    ],
  },
  {
    id: 1199,
    name: "User defined",
    prompt: "translate",
    category: "TRANSLATE",
    isSub: true,
  },
  {
    id: 12,
    name: "Rephrase",
    prompt: "rephrase",
    category: "REPHRASE",
    submenu: [121, 122, 123],
  },
  {
    id: 121,
    name: "Shorter",
    prompt: "shorten",
    category: "REPHRASE",
    isSub: true,
  },
  {
    id: 122,
    name: "Clearer",
    prompt: "longer",
    category: "REPHRASE",
    isSub: true,
  },
  {
    id: 123,
    name: "More accessible",
    prompt: "accessible",
    category: "REPHRASE",
    isSub: true,
  },
  {
    id: 13,
    name: "Extract highlighted texts",
    prompt: "extractHighlights",
    category: "EXTRACT",
    includeUids: true,
  },
  {
    id: 20,
    icon: "properties",
    name: "Outliner Agent: Set as active outline",
    prompt: "",
    category: "",
    onlyOutliner: true,
  },
  // OUTLINER AGENT COMMANDS
  {
    id: 21,
    icon: "properties",
    name: "Outliner Agent: Apply selected blocks as prompt",
    prompt: "",
    category: "",
    onlyOutliner: true,
  },
  { id: 8, name: "Convert", prompt: "", category: "user" },
  { id: 9, name: "My command", prompt: "", category: "user" },
  // ... autres commandes
].concat(
  languages.map((lgg, index) => {
    return {
      id: 1100 + index,
      name: lgg[0],
      label: lgg[1],
      prompt: "translate",
      category: "TRANSLATE",
      isSub: true,
    };
  })
);

console.log("PREBUILD_COMMANDS :>> ", PREBUILD_COMMANDS);
