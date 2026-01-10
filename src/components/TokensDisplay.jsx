import {
  Dialog,
  Classes,
  Collapse,
  Divider,
  Icon,
  Button,
} from "@blueprintjs/core";
import { extensionStorage } from "..";
import {
  normalizeModelId,
} from "../ai/modelsInfo";
import { getModelMetadata } from "../utils/modelConfigHelpers";
import { useState } from "react";

// Reusable content component for tokens usage display
export const TokensUsageContent = ({ showResetButton = true }) => {
  const [isCurrentOpen, setIsCurrentOpen] = useState(true);
  const [isLastOpen, setIsLastOpen] = useState(false);
  const [isTotalOpen, setIsTotalOpen] = useState(false);
  const [isResetToConfirm, setIsResetToConfirm] = useState(false);
  const [tokensCounter, setTokensCounter] = useState(
    extensionStorage.get("tokensCounter") || { total: {} }
  );

  const calculateCost = (tokens, pricePerM) => {
    if (!tokens || !pricePerM) return NaN;
    return (tokens * pricePerM) / 1000000;
  };
  // Fonction pour formater un coût
  const formatCost = (cost) => {
    return isNaN(cost) ? "---" : "$" + cost.toFixed(4);
  };
  // Fonction pour générer un tableau de tokens/coûts
  const generateTable = (data) => {
    if (!data || Object.keys(data).length === 0) return null;
    // Préparation des données avec calcul des coûts totaux
    let [
      periodInputTotal,
      periodOutputTotal,
      periodInputTotalCost,
      periodOutputTotalCost,
      periodTotalCost,
    ] = [0, 0, 0, 0, 0];
    const tableData = Object.entries(data)
      .filter(([model]) => model !== "month")
      .map(([model, counts]) => {
        const modelId = normalizeModelId(model, false);
        const metadata = getModelMetadata(modelId);

        const inputCost = calculateCost(
          counts.input,
          metadata.pricing?.input
        );
        const outputCost = calculateCost(
          counts.output,
          metadata.pricing?.output
        );
        const totalCost =
          isNaN(inputCost) || isNaN(outputCost) ? NaN : inputCost + outputCost;

        periodInputTotal += counts.input;
        periodOutputTotal += counts.output;
        periodInputTotalCost += isNaN(inputCost) ? 0 : inputCost;
        periodOutputTotalCost += isNaN(outputCost) ? 0 : outputCost;
        periodTotalCost += isNaN(totalCost) ? 0 : totalCost;

        return {
          model,
          inputTokens: counts.input,
          outputTokens: counts.output,
          inputCost,
          outputCost,
          totalCost,
        };
      });
    // Tri par coût total décroissant
    const sortedData = tableData.sort((a, b) => {
      if (isNaN(a.totalCost) && isNaN(b.totalCost)) return 0;
      if (isNaN(a.totalCost)) return 1;
      if (isNaN(b.totalCost)) return -1;
      return b.totalCost - a.totalCost;
    });
    sortedData.push({
      model: "TOTAL",
      inputTokens: periodInputTotal,
      outputTokens: periodOutputTotal,
      inputCost: periodInputTotalCost,
      outputCost: periodOutputTotalCost,
      totalCost: periodTotalCost,
    });
    return (
      <table className={Classes.HTML_TABLE}>
        <thead>
          <tr>
            <th>Model</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
            <th>Input Cost</th>
            <th>Output Cost</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, index) => (
            <tr
              key={row.model}
              className={index % 2 === 0 ? "even-row" : "odd-row"}
              style={row.model === "TOTAL" ? { fontWeight: "bolder" } : null}
            >
              <td>{normalizeModelId(row.model, false)}</td>
              <td>{row.inputTokens}</td>
              <td>{row.outputTokens}</td>
              <td>{formatCost(row.inputCost)}</td>
              <td>{formatCost(row.outputCost)}</td>
              <td>{formatCost(row.totalCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="tokens-usage-content">
      <p>
        See current reference pricing used in these calculations{" "}
        <a
          href="https://github.com/fbgallet/roam-extension-live-ai-assistant/blob/main/docs/api-keys-and-pricing.md#main-models-pricing-per-million-tokens"
          target="_blank"
          rel="noopener noreferrer"
        >
          here in Live AI docs
        </a>
      </p>
      <p>
        For a complete and up-to-date comparison of pricing and performance,
        see{" "}
        <a
          href="https://artificialanalysis.ai/models#pricing"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://artificialanalysis.ai
        </a>
      </p>
      {tokensCounter.lastRequest && (
        <div className="last-request">
          <h4>Last request</h4>
          <div className="last-request-content">
            <table className={Classes.HTML_TABLE}>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Input Tokens</th>
                  <th>Output Tokens</th>
                  <th>Input Cost</th>
                  <th>Output Cost</th>
                  <th>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const lastModelId = normalizeModelId(tokensCounter.lastRequest.model, false);
                  const lastMetadata = getModelMetadata(lastModelId);
                  const lastInputCost = calculateCost(
                    tokensCounter.lastRequest.input,
                    lastMetadata.pricing?.input
                  );
                  const lastOutputCost = calculateCost(
                    tokensCounter.lastRequest.output,
                    lastMetadata.pricing?.output
                  );

                  return (
                    <tr className="even-row">
                      <td>{lastModelId}</td>
                      <td>{tokensCounter.lastRequest.input}</td>
                      <td>{tokensCounter.lastRequest.output}</td>
                      <td>{formatCost(lastInputCost)}</td>
                      <td>{formatCost(lastOutputCost)}</td>
                      <td>{formatCost(lastInputCost + lastOutputCost)}</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <Divider />
      <h3 onClick={() => setIsCurrentOpen((prev) => !prev)} style={{ cursor: 'pointer' }}>
        <Icon icon={isCurrentOpen ? "chevron-down" : "chevron-right"} />
        Current month
      </h3>
      <Collapse isOpen={isCurrentOpen}>
        {generateTable(tokensCounter.monthly)}
      </Collapse>
      {Object.keys(tokensCounter.lastMonth || {}).length > 0 && (
        <>
          <Divider />
          <h3 onClick={() => setIsLastOpen((prev) => !prev)} style={{ cursor: 'pointer' }}>
            <Icon icon={isLastOpen ? "chevron-down" : "chevron-right"} />
            Last month
          </h3>
          <Collapse isOpen={isLastOpen}>
            {generateTable(tokensCounter.lastMonth)}
          </Collapse>
        </>
      )}
      <Divider />
      <h3 onClick={() => setIsTotalOpen((prev) => !prev)} style={{ cursor: 'pointer' }}>
        <Icon icon={isTotalOpen ? "chevron-down" : "chevron-right"} />
        Total
      </h3>
      <Collapse isOpen={isTotalOpen}>
        {generateTable(tokensCounter.total)}
      </Collapse>
      {showResetButton && (
        <div className="tokens-reset-section" style={{ marginTop: '20px' }}>
          {!isResetToConfirm ? (
            <Button
              text="Reset all"
              intent="danger"
              onClick={() => setIsResetToConfirm(true)}
            />
          ) : (
            <Button
              text="Click to confirm RESET ALL"
              intent="danger"
              onClick={() => {
                extensionStorage.set("tokensCounter", { total: {} });
                setTokensCounter({ total: {} });
                setIsResetToConfirm(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

// Legacy dialog wrapper - kept for backwards compatibility
// New code should use ModelConfigDialog with initialTab="usage-tokens"
const TokensDialog = ({ isOpen, onClose }) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Live AI - Tokens usage and cost"
      className="tokens-dialog"
    >
      <div className={Classes.DIALOG_BODY} useOverflowScrollContainer={true}>
        <TokensUsageContent showResetButton={true} />
      </div>
    </Dialog>
  );
};

export default TokensDialog;
