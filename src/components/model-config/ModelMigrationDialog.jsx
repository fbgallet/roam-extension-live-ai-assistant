import React, { useState } from "react";
import {
  Dialog,
  Classes,
  Button,
  Card,
  RadioGroup,
  Radio,
  Callout,
  Icon,
} from "@blueprintjs/core";
import { AppToaster } from "../Toaster";
import "./ModelMigrationDialog.css";

/**
 * ModelMigrationDialog - Prompts user about deprecated models and migration options
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether dialog is open
 * @param {Function} props.onClose - Callback when dialog is closed
 * @param {Array} props.deprecatedModels - Array of deprecated model update objects
 * @param {Function} props.onMigrate - Callback when migration choices are confirmed
 */
export const ModelMigrationDialog = ({
  isOpen,
  onClose,
  deprecatedModels = [],
  onMigrate,
}) => {
  // Track user choices for each deprecated model
  const [choices, setChoices] = useState(() => {
    const initial = {};
    deprecatedModels.forEach((update) => {
      // Default to "migrate" if autoMigrate is true, otherwise "keep"
      initial[update.oldModelId] = update.autoMigrate ? "migrate" : "keep";
    });
    return initial;
  });

  const handleChoiceChange = (modelId, value) => {
    setChoices((prev) => ({
      ...prev,
      [modelId]: value,
    }));
  };

  const handleConfirm = () => {
    // Build migration actions
    const migrations = deprecatedModels
      .filter((update) => choices[update.oldModelId] === "migrate")
      .map((update) => ({
        oldModelId: update.oldModelId,
        newModelId: update.newModelId,
        provider: update.provider,
      }));

    if (onMigrate) {
      onMigrate(migrations);
    }

    const migratedCount = migrations.length;
    if (migratedCount > 0) {
      AppToaster.show({
        message: `Migrated ${migratedCount} model${migratedCount > 1 ? "s" : ""} to newer versions`,
        intent: "success",
        timeout: 3000,
      });
    }

    onClose();
  };

  const handleSkip = () => {
    onClose();
  };

  if (deprecatedModels.length === 0) {
    return null;
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleSkip}
      title="Model Updates Available"
      className="model-migration-dialog"
      canOutsideClickClose={false}
    >
      <div className={Classes.DIALOG_BODY}>
        <Callout icon="info-sign" intent="warning" className="migration-info">
          Some models you're using have been deprecated or updated. Review the
          changes below and choose how you'd like to proceed.
        </Callout>

        <div className="migration-cards">
          {deprecatedModels.map((update) => (
            <Card key={update.oldModelId} className="migration-card">
              <div className="migration-header">
                <div className="model-transition">
                  <span className="old-model">
                    <Icon icon="cross" intent="danger" />
                    {update.oldModelId}
                  </span>
                  <Icon icon="arrow-right" className="arrow" />
                  <span className="new-model">
                    <Icon icon="tick" intent="success" />
                    {update.newModelId}
                  </span>
                </div>
                <span className="provider-tag">{update.provider}</span>
              </div>

              {update.reason && (
                <p className="migration-reason">{update.reason}</p>
              )}

              {update.deprecationDate && (
                <p className="deprecation-date">
                  <Icon icon="calendar" />
                  Deprecation date: {update.deprecationDate}
                </p>
              )}

              <RadioGroup
                onChange={(e) =>
                  handleChoiceChange(update.oldModelId, e.target.value)
                }
                selectedValue={choices[update.oldModelId]}
                className="migration-choices"
              >
                <Radio
                  label={`Migrate to ${update.newModelId}`}
                  value="migrate"
                />
                <Radio
                  label={`Keep using ${update.oldModelId} (may stop working)`}
                  value="keep"
                />
              </RadioGroup>
            </Card>
          ))}
        </div>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleSkip}>Skip for Now</Button>
          <Button onClick={handleConfirm} intent="primary" icon="tick">
            Confirm Choices
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ModelMigrationDialog;
