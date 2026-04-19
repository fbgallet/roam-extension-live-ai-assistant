/**
 * Debate Configuration Panel
 *
 * Nested inside CouncilConfigPanel when config.mode === "debate".
 * Configures: sub-mode, participants (model + role), max rounds, word limit, conclude flag.
 * Supports built-in presets, user-saved presets (#liveai/debate-preset), custom
 * graph roles (#liveai/role), and custom inline role text.
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  Button,
  ButtonGroup,
  Icon,
  Menu,
  MenuItem,
  MenuDivider,
  Popover,
  Tag,
  TextArea,
  NumericInput,
  Slider,
  Switch,
  InputGroup,
  Dialog,
  Intent,
  Tooltip,
  Position,
  Collapse,
} from "@blueprintjs/core";
import ModelsMenu from "../../../ModelsMenu";
import { getDisplayName } from "../../../../ai/modelRegistry";
import {
  CouncilConfig,
  DebateOrdering,
  DebateParticipant,
  DebateRoleRef,
  BuiltInDebateRoleId,
} from "../../../../ai/agents/council-agent/council-types";
import { BUILTIN_ROLE_DEFINITIONS } from "../../../../ai/agents/council-agent/council-debate-prompts";
import {
  getCustomRoles,
  getDebatePresets,
  getDebatePresetByUid,
  saveDebatePreset,
  BUILTIN_DEBATE_PRESETS,
} from "../../../../ai/agents/council-agent/debate-roles";
// @ts-ignore - JS module, untyped
import { getCustomStyles } from "../../../../ai/dataExtraction";
// @ts-ignore - JS module, untyped
import { getRoamUserDisplayName } from "../../../../utils/roamAPI";

interface DebateConfigPanelProps {
  config: CouncilConfig;
  onConfigChange: (config: CouncilConfig) => void;
  defaultModel: string;
}

const BUILTIN_ROLE_ORDER: BuiltInDebateRoleId[] = [
  "none",
  "white-hat",
  "red-hat",
  "black-hat",
  "yellow-hat",
  "green-hat",
  "blue-hat",
  "socrates",
  "devils-advocate",
  "synthesizer-role",
  "pragmatist",
  "visionary",
];

const DE_BONO_HATS: BuiltInDebateRoleId[] = [
  "white-hat",
  "red-hat",
  "black-hat",
  "yellow-hat",
  "green-hat",
  "blue-hat",
];

// Short, one-line descriptions shown as Tooltips. Hat colors are NOT obvious.
const HAT_DESCRIPTIONS: Partial<Record<BuiltInDebateRoleId, string>> = {
  "white-hat": "Facts, data, information gaps. Neutral and objective.",
  "red-hat": "Feelings, intuitions, gut reactions — no justification needed.",
  "black-hat": "Risks, flaws, failure modes. Critical judgement.",
  "yellow-hat": "Benefits, opportunities, feasibility. Grounded optimism.",
  "green-hat": "Creativity, new ideas, lateral alternatives.",
  "blue-hat": "Process meta-view. Summarise, redirect, name what's decided.",
  socrates: "Probing questions that expose hidden assumptions.",
  "devils-advocate": "Steelman the strongest opposing view.",
  "synthesizer-role": "Find convergence. Integrate prior turns.",
  pragmatist: "What's actionable now, given real constraints.",
  visionary: "10-year horizon. What becomes possible.",
};

const CHARACTERS: BuiltInDebateRoleId[] = [
  "socrates",
  "devils-advocate",
  "synthesizer-role",
  "pragmatist",
  "visionary",
];

// Small colored swatch shown next to the hat labels in the menu + tag.
const HAT_COLORS: Partial<Record<BuiltInDebateRoleId, string>> = {
  "white-hat": "#f5f8fa",
  "red-hat": "#db3737",
  "black-hat": "#1c2127",
  "yellow-hat": "#f2b824",
  "green-hat": "#0f9960",
  "blue-hat": "#137cbd",
};

function HatSwatch({ id }: { id: BuiltInDebateRoleId }) {
  const color = HAT_COLORS[id];
  if (!color) return null;
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        border: "1px solid #888",
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function roleSummary(role: DebateRoleRef): string {
  const customName = role.customName?.trim();
  const base = (() => {
    if (role.kind === "builtin") {
      return (
        BUILTIN_ROLE_DEFINITIONS[role.builtinId || "none"]?.label || "No role"
      );
    }
    if (role.kind === "custom-graph") {
      return role.graphLabel || "Custom role";
    }
    if (role.kind === "custom-inline") {
      return role.inlineText?.trim()
        ? `Custom: ${role.inlineText.slice(0, 24)}${role.inlineText.length > 24 ? "…" : ""}`
        : "Custom (empty!)";
    }
    return "No role";
  })();
  if (customName) {
    // When the participant has a display name, show "Name · role".
    const isNoRole =
      role.kind === "builtin" && (role.builtinId || "none") === "none";
    return isNoRole ? customName : `${customName} · ${base}`;
  }
  return base;
}

// ==================== Participant row ====================

const ParticipantRow: React.FC<{
  participant: DebateParticipant;
  index: number;
  onUpdate: (p: DebateParticipant) => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  customGraphRoles: Array<{ uid: string; title: string }>;
  customGraphStyles: Array<{ uid: string; title: string }>;
}> = ({
  participant,
  index,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  customGraphRoles,
  customGraphStyles,
}) => {
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  // Auto-open the edit panel when the custom-inline role is selected (its text
  // area is the whole point). Otherwise user toggles via the edit button.
  const [editPanelOpen, setEditPanelOpen] = useState(
    participant.role.kind === "custom-inline",
  );

  // Preserve name + extra instructions across role changes.
  const preservedName = participant.role.customName;
  const preservedExtra = participant.role.extraInstructions;

  const pickBuiltin = (id: BuiltInDebateRoleId) => {
    onUpdate({
      ...participant,
      role: {
        kind: "builtin",
        builtinId: id,
        customName: preservedName,
        extraInstructions: preservedExtra,
      },
    });
    setRoleMenuOpen(false);
  };
  const pickGraphRole = (uid: string, title: string) => {
    onUpdate({
      ...participant,
      role: {
        kind: "custom-graph",
        graphUid: uid,
        graphLabel: title,
        customName: preservedName,
        extraInstructions: preservedExtra,
      },
    });
    setRoleMenuOpen(false);
  };
  const pickInline = () => {
    onUpdate({
      ...participant,
      role: {
        kind: "custom-inline",
        inlineText: participant.role.inlineText || "",
        customName: preservedName,
        extraInstructions: preservedExtra,
      },
    });
    setEditPanelOpen(true);
    setRoleMenuOpen(false);
  };

  const handleModelPick = ({ model }: { model: string }) => {
    onUpdate({ ...participant, modelId: model });
    setModelMenuOpen(false);
  };

  const roleItemWithTooltip = (
    id: BuiltInDebateRoleId,
    opts: { swatch?: boolean } = {},
  ) => {
    const desc = HAT_DESCRIPTIONS[id] || "";
    // Show the description as a dim second line inside the label — no Tooltip
    // (BP Tooltips inside Menus fight with the menu's own hover/focus and
    // either flicker or fail to open). Inline description is always readable.
    const label = BUILTIN_ROLE_DEFINITIONS[id].label;
    return (
      <MenuItem
        key={id}
        text={
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.2,
              gap: 2,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              {opts.swatch && <HatSwatch id={id} />}
              {label}
            </span>
            {desc && (
              <span
                style={{
                  fontSize: 10,
                  opacity: 0.65,
                  whiteSpace: "normal",
                  maxWidth: 250,
                }}
              >
                {desc}
              </span>
            )}
          </span>
        }
        onClick={() => pickBuiltin(id)}
      />
    );
  };

  const roleMenu = (
    <Menu
      style={{
        maxHeight: 440,
        // maxWidth: 250,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <MenuItem
        icon="blank"
        text="No preset role — name-driven persona"
        onClick={() => pickBuiltin("none")}
      />
      <MenuDivider title="Characters" />
      {CHARACTERS.map((id) => roleItemWithTooltip(id))}
      <MenuDivider title="De Bono Thinking Hats" />
      {DE_BONO_HATS.map((id) => roleItemWithTooltip(id, { swatch: true }))}
      {customGraphRoles.length > 0 && (
        <>
          <MenuDivider title="Custom roles (#liveai/role)" />
          {customGraphRoles.map((r) => (
            <MenuItem
              key={r.uid}
              text={r.title}
              icon="link"
              onClick={() => pickGraphRole(r.uid, r.title)}
            />
          ))}
        </>
      )}
      {customGraphStyles.length > 0 && (
        <>
          <MenuDivider title="Custom styles (#liveai/style)" />
          {customGraphStyles.map((s) => (
            <MenuItem
              key={s.uid}
              text={s.title}
              icon="style"
              onClick={() => pickGraphRole(s.uid, s.title)}
            />
          ))}
        </>
      )}
      <MenuDivider />
      <MenuItem icon="edit" text="Custom inline role…" onClick={pickInline} />
    </Menu>
  );

  return (
    <div
      className="debate-participant-row"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginBottom: 6,
        padding: "4px 6px",
        border: "1px solid var(--bp5-divider-black-muted, #d3d8de)",
        borderRadius: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, minWidth: 16 }}>
          {index + 1}.
        </span>
        <Popover
          isOpen={modelMenuOpen}
          onInteraction={(next) => setModelMenuOpen(next)}
          content={
            <ModelsMenu
              callback={handleModelPick}
              setModel={(m: string) => onUpdate({ ...participant, modelId: m })}
              command={null}
              prompt=""
              isConversationToContinue={false}
            />
          }
          placement="bottom-start"
        >
          <Tag interactive minimal icon="cog">
            {getDisplayName(participant.modelId) ||
              participant.modelId ||
              "Select model…"}
          </Tag>
        </Popover>
        <Popover
          isOpen={roleMenuOpen}
          onInteraction={(next) => setRoleMenuOpen(next)}
          content={roleMenu}
          placement="bottom-start"
        >
          <Tag interactive minimal icon="person">
            {participant.role.kind === "builtin" &&
              participant.role.builtinId &&
              HAT_COLORS[participant.role.builtinId] && (
                <HatSwatch id={participant.role.builtinId} />
              )}
            {roleSummary(participant.role)}
          </Tag>
        </Popover>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <Tooltip
            content={
              editPanelOpen
                ? "Hide name & instructions"
                : "Edit participant name / add role instructions"
            }
            position={Position.TOP}
            hoverOpenDelay={200}
            openOnTargetFocus={false}
          >
            <Button
              icon="edit"
              minimal
              small
              active={editPanelOpen}
              intent={
                participant.role.customName?.trim() ||
                participant.role.extraInstructions?.trim()
                  ? "primary"
                  : undefined
              }
              onClick={() => setEditPanelOpen((v) => !v)}
            />
          </Tooltip>
          <Button
            icon="chevron-up"
            minimal
            small
            disabled={!onMoveUp}
            onClick={onMoveUp}
          />
          <Button
            icon="chevron-down"
            minimal
            small
            disabled={!onMoveDown}
            onClick={onMoveDown}
          />
          {onRemove && (
            <Button
              icon="cross"
              minimal
              small
              intent="danger"
              onClick={onRemove}
            />
          )}
        </div>
      </div>
      <Collapse isOpen={editPanelOpen} keepChildrenMounted>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "6px 0 2px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <InputGroup
                small
                fill
                leftIcon="person"
                placeholder="Name (optional) — e.g. Alice, Nietzsche, Spock"
                value={participant.role.customName || ""}
                onChange={(e) =>
                  onUpdate({
                    ...participant,
                    role: { ...participant.role, customName: e.target.value },
                  })
                }
              />
            </div>
            {participant.role.kind === "builtin" &&
              (participant.role.builtinId || "none") === "none" && (
                <Tooltip
                  content={
                    <>
                      If the name refers to a known thinker or fictional
                      character
                      <br></br>
                      (e.g. Nietzsche, Spock), the model will embody them.
                      <br></br>
                      Neutral names (Alice, Bob) are treated as plain labels.
                    </>
                  }
                  position={Position.TOP}
                  hoverOpenDelay={200}
                  openOnTargetFocus={false}
                >
                  <Switch
                    checked={participant.role.embodyNamedFigure !== false}
                    label="In-character"
                    onChange={(e) =>
                      onUpdate({
                        ...participant,
                        role: {
                          ...participant.role,
                          embodyNamedFigure: (e.target as HTMLInputElement)
                            .checked,
                        },
                      })
                    }
                    style={{ margin: 0, fontSize: 11, whiteSpace: "nowrap" }}
                  />
                </Tooltip>
              )}
          </div>
          {participant.role.kind === "custom-inline" ? (
            <TextArea
              small
              fill
              value={participant.role.inlineText || ""}
              onChange={(e) =>
                onUpdate({
                  ...participant,
                  role: {
                    ...participant.role,
                    kind: "custom-inline",
                    inlineText: e.target.value,
                  },
                })
              }
              placeholder="Describe this participant's role / persona / perspective…"
              style={{ minHeight: 40 }}
            />
          ) : (
            <TextArea
              small
              fill
              value={participant.role.extraInstructions || ""}
              onChange={(e) =>
                onUpdate({
                  ...participant,
                  role: {
                    ...participant.role,
                    extraInstructions: e.target.value,
                  },
                })
              }
              placeholder="Extra instructions (optional) — appended to the role. E.g. 'Focus on ethical risks' for Black Hat."
              style={{ minHeight: 40 }}
            />
          )}
          {/* Temperature override */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 2,
            }}
          >
            <Tooltip
              content={
                <>
                  0 = deterministic, 1 = maximally creative.
                  <br></br>
                  Matches the project's global temperature range.
                  <br></br>
                  Some providers (OpenAI, Grok) technically accept values up to
                  2.0,
                  <br></br>
                  but Anthropic and Google cap at 1.0 —<br></br>
                  we keep 0-1 for safe cross-provider behaviour.
                </>
              }
              position={Position.TOP}
              hoverOpenDelay={200}
              openOnTargetFocus={false}
            >
              <label style={{ fontSize: 11, minWidth: 78 }}>Temperature:</label>
            </Tooltip>
            <Slider
              min={0}
              max={1}
              stepSize={0.1}
              labelStepSize={0.25}
              value={
                participant.role.temperature !== undefined
                  ? Math.min(1, participant.role.temperature)
                  : 0
              }
              onChange={(val) =>
                onUpdate({
                  ...participant,
                  role: { ...participant.role, temperature: val },
                })
              }
            />
            <Tag minimal round>
              {participant.role.temperature !== undefined
                ? participant.role.temperature.toFixed(1)
                : "default"}
            </Tag>
            {participant.role.temperature !== undefined && (
              <Tooltip
                content="Reset to model default"
                position={Position.TOP}
                hoverOpenDelay={200}
                openOnTargetFocus={false}
              >
                <Button
                  icon="reset"
                  minimal
                  small
                  onClick={() =>
                    onUpdate({
                      ...participant,
                      role: {
                        ...participant.role,
                        temperature: undefined,
                      },
                    })
                  }
                />
              </Tooltip>
            )}
          </div>
        </div>
      </Collapse>
    </div>
  );
};

// ==================== Main panel ====================

export const DebateConfigPanel: React.FC<DebateConfigPanelProps> = ({
  config,
  onConfigChange,
  defaultModel,
}) => {
  const [graphRoles, setGraphRoles] = useState<
    Array<{ uid: string; title: string }>
  >([]);
  const [graphStyles, setGraphStyles] = useState<
    Array<{ uid: string; title: string }>
  >([]);
  const [graphPresets, setGraphPresets] = useState<
    Array<{ uid: string; name: string }>
  >([]);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");

  useEffect(() => {
    try {
      setGraphRoles(getCustomRoles());
    } catch {
      setGraphRoles([]);
    }
    try {
      // getCustomStyles returns {title, uid}; normalise to {uid, title}.
      const styles = (getCustomStyles() || []) as Array<{
        uid: string;
        title: string;
      }>;
      setGraphStyles(styles.map((s) => ({ uid: s.uid, title: s.title })));
    } catch {
      setGraphStyles([]);
    }
    try {
      setGraphPresets(getDebatePresets());
    } catch {
      setGraphPresets([]);
    }
  }, []);

  const update = (patch: Partial<CouncilConfig>) => {
    onConfigChange({ ...config, ...patch });
  };

  const participants = config.debateParticipants;

  // Initialise with 2 default participants if empty.
  useEffect(() => {
    if (participants.length === 0) {
      update({
        debateParticipants: [
          {
            modelId: defaultModel,
            role: { kind: "builtin", builtinId: "none" },
          },
          {
            modelId: defaultModel,
            role: { kind: "builtin", builtinId: "none" },
          },
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addParticipant = () => {
    if (participants.length >= 6) return;
    update({
      debateParticipants: [
        ...participants,
        { modelId: defaultModel, role: { kind: "builtin", builtinId: "none" } },
      ],
    });
  };
  const removeAt = (idx: number) => {
    if (participants.length <= 2) return;
    update({
      debateParticipants: participants.filter((_, i) => i !== idx),
    });
  };
  const updateAt = (idx: number, p: DebateParticipant) => {
    const next = [...participants];
    next[idx] = p;
    update({ debateParticipants: next });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= participants.length) return;
    const next = [...participants];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    update({ debateParticipants: next });
  };

  const applyBuiltInPreset = (id: string) => {
    const preset = BUILTIN_DEBATE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    update({
      debateParticipants: preset.build(defaultModel),
      debateSubMode: preset.subMode || config.debateSubMode,
      debateMaxRounds: preset.maxRounds || config.debateMaxRounds,
    });
    setPresetMenuOpen(false);
  };

  const applyGraphPreset = async (uid: string) => {
    const preset = await getDebatePresetByUid(uid);
    if (!preset) return;
    update({
      debateParticipants:
        preset.participants.length > 0
          ? preset.participants
          : config.debateParticipants,
      debateSubMode: preset.subMode || config.debateSubMode,
      debateMaxRounds: preset.maxRounds || config.debateMaxRounds,
      debateWordLimitPerTurn:
        preset.wordLimitPerTurn || config.debateWordLimitPerTurn,
      debateAllowConclude:
        preset.allowConclude !== undefined
          ? preset.allowConclude
          : config.debateAllowConclude,
    });
    setPresetMenuOpen(false);
  };

  const handleSavePreset = async () => {
    const name = presetNameDraft.trim();
    if (!name) return;
    await saveDebatePreset(
      name,
      config.debateParticipants,
      config.debateSubMode,
      config.debateMaxRounds,
      config.debateWordLimitPerTurn,
      config.debateAllowConclude,
    );
    setSaveDialogOpen(false);
    setPresetNameDraft("");
    try {
      setGraphPresets(getDebatePresets());
    } catch {
      // no-op
    }
  };

  const presetMenu = (
    <Menu style={{ maxHeight: 400, overflowY: "auto" }}>
      <MenuDivider title="Built-in" />
      {BUILTIN_DEBATE_PRESETS.map((p) => (
        <MenuItem
          key={p.id}
          text={p.name}
          label={`${p.build(defaultModel).length} participants`}
          onClick={() => applyBuiltInPreset(p.id)}
        />
      ))}
      {graphPresets.length > 0 && (
        <>
          <MenuDivider title="My presets" />
          {graphPresets.map((p) => (
            <MenuItem
              key={p.uid}
              text={p.name}
              icon="bookmark"
              onClick={() => applyGraphPreset(p.uid)}
            />
          ))}
        </>
      )}
      <MenuDivider />
      <MenuItem
        icon="floppy-disk"
        text="Save current as preset…"
        onClick={() => {
          setPresetMenuOpen(false);
          setSaveDialogOpen(true);
        }}
      />
    </Menu>
  );

  const hasEmptyInlineRole = participants.some(
    (p) => p.role.kind === "custom-inline" && !(p.role.inlineText || "").trim(),
  );

  return (
    <div className="debate-config-panel">
      {/* Sub-mode toggle + preset row (compact, subordinate to parent mode radios) */}
      <div
        className="council-config-section"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, opacity: 0.75 }}>Style:</span>
        <ButtonGroup>
          <Button
            small
            active={config.debateSubMode === "autonomous"}
            intent={
              config.debateSubMode === "autonomous" ? "primary" : undefined
            }
            onClick={() => update({ debateSubMode: "autonomous" })}
          >
            Autonomous
          </Button>
          <Button
            small
            active={config.debateSubMode === "human-in-loop"}
            intent={
              config.debateSubMode === "human-in-loop" ? "primary" : undefined
            }
            onClick={() => update({ debateSubMode: "human-in-loop" })}
          >
            Human-in-the-loop
          </Button>
        </ButtonGroup>
        {config.debateSubMode === "human-in-loop" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flex: "0 1 auto",
              minWidth: 140,
            }}
          >
            <Tooltip
              content="The name participants will use to address you. Defaults to your Roam display name."
              position={Position.TOP}
              hoverOpenDelay={200}
              openOnTargetFocus={false}
            >
              <span style={{ fontSize: 11, opacity: 0.75 }}>Your name:</span>
            </Tooltip>
            <InputGroup
              small
              leftIcon="user"
              placeholder={getRoamUserDisplayName() || "Human"}
              value={config.debateHumanName || ""}
              onChange={(e) => update({ debateHumanName: e.target.value })}
              style={{ maxWidth: 160 }}
            />
          </div>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Popover
            isOpen={presetMenuOpen}
            onInteraction={(next) => setPresetMenuOpen(next)}
            content={presetMenu}
            placement="bottom-start"
          >
            <Button icon="style" small rightIcon="chevron-down" minimal>
              Preset
            </Button>
          </Popover>
        </div>
      </div>

      {/* Participants */}
      <div className="council-config-section">
        <div className="council-config-section-label">
          Participants ({participants.length}/6)
          {participants.length < 6 && (
            <Button
              icon="plus"
              minimal
              small
              onClick={addParticipant}
              style={{ marginLeft: 6 }}
            />
          )}
        </div>
        {participants.map((p, i) => (
          <ParticipantRow
            key={i}
            index={i}
            participant={p}
            customGraphRoles={graphRoles}
            customGraphStyles={graphStyles}
            onUpdate={(next) => updateAt(i, next)}
            onRemove={participants.length > 2 ? () => removeAt(i) : undefined}
            onMoveUp={i > 0 ? () => move(i, i - 1) : undefined}
            onMoveDown={
              i < participants.length - 1 ? () => move(i, i + 1) : undefined
            }
          />
        ))}
        {hasEmptyInlineRole && (
          <div style={{ color: "#c23030", fontSize: 11, marginTop: 4 }}>
            One or more custom inline roles are empty. Fill them in before
            starting.
          </div>
        )}
      </div>

      {/* Dynamics — conversational options that shape the flow */}
      <div className="council-config-section">
        <div
          className="council-config-section-label"
          style={{ marginBottom: 6 }}
        >
          Dynamics
        </div>
        {participants.length >= 3 && (
          <div
            className="council-config-row"
            style={{ gap: 8, alignItems: "center" }}
          >
            <label style={{ minWidth: 70 }}>Order:</label>
            <ButtonGroup>
              <Button
                small
                active={config.debateOrdering === "fixed"}
                intent={
                  config.debateOrdering === "fixed" ? "primary" : undefined
                }
                onClick={() =>
                  update({ debateOrdering: "fixed" as DebateOrdering })
                }
              >
                Fixed
              </Button>
              <Button
                small
                active={config.debateOrdering === "random"}
                intent={
                  config.debateOrdering === "random" ? "primary" : undefined
                }
                onClick={() =>
                  update({ debateOrdering: "random" as DebateOrdering })
                }
              >
                Random
              </Button>
            </ButtonGroup>
            <Tooltip
              content={
                <>
                  Fixed: participants speak in the order listed above.
                  <br></br>
                  Random: a fair rotation — every participant speaks once per
                  round,
                  <br></br>but in a shuffled order with no immediate repeats.
                  <br></br>
                  Either mode can be overridden by an explicit
                  <br></br>
                  &gt;&gt;&gt; next: Name from the speaker.
                </>
              }
              position={Position.TOP}
              hoverOpenDelay={200}
              openOnTargetFocus={false}
            >
              <Icon icon="info-sign" size={12} style={{ opacity: 0.55 }} />
            </Tooltip>
          </div>
        )}
        <Switch
          checked={config.debateAllowReactions}
          label="Allow short reactions"
          onChange={(e) =>
            update({
              debateAllowReactions: (e.target as HTMLInputElement).checked,
            })
          }
          style={{ marginTop: 6 }}
        />
        {config.debateAllowReactions && (
          <div
            style={{
              fontSize: 10,
              opacity: 0.65,
              marginLeft: 28,
              marginTop: -4,
              marginBottom: 4,
            }}
          >
            Speakers may invite 1-2 named participants for a one-line reaction
            (≤30 words) before the next full turn. Uses extra tokens.
          </div>
        )}
        <Switch
          checked={config.debateAllowConclude}
          label="Allow end-of-debate [CONCLUDE] proposal"
          onChange={(e) =>
            update({
              debateAllowConclude: (e.target as HTMLInputElement).checked,
            })
          }
        />
      </div>

      {/* Settings — numerical limits */}
      <div className="council-config-section">
        <div
          className="council-config-section-label"
          style={{ marginBottom: 6 }}
        >
          Limits
        </div>
        <div className="council-config-row">
          <label>Max rounds:</label>
          <NumericInput
            value={config.debateMaxRounds}
            onValueChange={(val) =>
              update({
                debateMaxRounds: Math.max(1, Math.min(10, val || 1)),
              })
            }
            min={1}
            max={10}
            minorStepSize={1}
            stepSize={1}
            fill={false}
          />
        </div>
        <div className="council-config-row">
          <label>Word limit / turn:</label>
          <Slider
            min={50}
            max={500}
            stepSize={25}
            value={config.debateWordLimitPerTurn}
            onChange={(val) => update({ debateWordLimitPerTurn: val })}
            labelStepSize={150}
          />
          <Tag minimal round>
            {config.debateWordLimitPerTurn}
          </Tag>
        </div>
      </div>

      {/* Save preset dialog */}
      <Dialog
        isOpen={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        title="Save debate preset"
        style={{ width: 380 }}
      >
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12 }}>
            Saves the current participants and settings as a{" "}
            <code>#liveai/debate-preset</code> block under today's daily note.
          </div>
          <InputGroup
            placeholder="Preset name (e.g., My team)"
            value={presetNameDraft}
            onChange={(e) => setPresetNameDraft(e.target.value)}
            autoFocus
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button
              intent={Intent.PRIMARY}
              disabled={!presetNameDraft.trim()}
              onClick={handleSavePreset}
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
