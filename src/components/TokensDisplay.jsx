import {
  Dialog,
  DialogBody,
  Classes,
  Collapse,
  Divider,
  Icon,
} from "@blueprintjs/core";
import { extensionStorage, openRouterModelsInfo } from "..";
import { modelsPricing, openRouterModelPricing } from "../ai/modelsInfo";
import { useState } from "react";

const TokensDialog = ({ isOpen, onClose }) => {
  const [isCurrentOpen, setIsCurrentOpen] = useState(true);
  const [isLastOpen, setIsLastOpen] = useState(false);
  const [isTotalOpen, setIsTotalOpen] = useState(false);

  const tokensCounter = extensionStorage.get("tokensCounter");

  const calculateCost = (tokens, pricePerK) => {
    if (!tokens || !pricePerK) return NaN;
    return (tokens * pricePerK) / 1000;
  };
  // Fonction pour formater un coût
  const formatCost = (cost) => {
    return isNaN(cost) ? "---" : "$" + cost.toFixed(4);
  };
  // Fonction pour générer un tableau de tokens/coûts
  const generateTable = (data) => {
    if (!data || Object.keys(data).length === 0) return null;
    // Préparation des données avec calcul des coûts totaux
    let periodTotal = 0;
    const tableData = Object.entries(data)
      .filter(([model]) => model !== "month")
      .map(([model, counts]) => {
        const inputCost = calculateCost(
          counts.input,
          modelsPricing[model]?.input || openRouterModelPricing(model, "input")
        );
        const outputCost = calculateCost(
          counts.output,
          modelsPricing[model]?.output ||
            openRouterModelPricing(model, "output")
        );
        const totalCost =
          isNaN(inputCost) || isNaN(outputCost) ? NaN : inputCost + outputCost;
        !isNaN(totalCost) && (periodTotal += totalCost);
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
    sortedData.push({ model: "TOTAL", totalCost: periodTotal });
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
            >
              <td>{row.model}</td>
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
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Live AI Assistant - Tokens usage and cost"
      className="tokens-dialog"
    >
      <div className={Classes.DIALOG_BODY} useOverflowScrollContainer={true}>
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
                  <tr className="even-row">
                    <td>{tokensCounter.lastRequest.model}</td>
                    <td>{tokensCounter.lastRequest.input}</td>
                    <td>{tokensCounter.lastRequest.output}</td>
                    <td>
                      {formatCost(
                        calculateCost(
                          tokensCounter.lastRequest.input,
                          modelsPricing[tokensCounter.lastRequest.model]
                            ?.input ||
                            openRouterModelPricing(
                              tokensCounter.lastRequest.model,
                              "input"
                            )
                        )
                      )}
                    </td>
                    <td>
                      {formatCost(
                        calculateCost(
                          tokensCounter.lastRequest.output,
                          modelsPricing[tokensCounter.lastRequest.model]
                            ?.output ||
                            openRouterModelPricing(
                              tokensCounter.lastRequest.model,
                              "output"
                            )
                        )
                      )}
                    </td>
                    <td>
                      {formatCost(
                        calculateCost(
                          tokensCounter.lastRequest.input,
                          modelsPricing[tokensCounter.lastRequest.model]
                            ?.input ||
                            openRouterModelPricing(
                              tokensCounter.lastRequest.model,
                              "input"
                            )
                        ) +
                          calculateCost(
                            tokensCounter.lastRequest.output,
                            modelsPricing[tokensCounter.lastRequest.model]
                              ?.output ||
                              openRouterModelPricing(
                                tokensCounter.lastRequest.model,
                                "output"
                              )
                          )
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Divider />
        <h3 onClick={() => setIsCurrentOpen((prev) => !prev)}>
          <Icon icon={isCurrentOpen ? "chevron-down" : "chevron-right"} />
          Current month
        </h3>
        <Collapse isOpen={isCurrentOpen}>
          {generateTable(tokensCounter.monthly)}
        </Collapse>
        {Object.keys(tokensCounter.lastMonth || {}).length > 0 && (
          <>
            <Divider />
            <h3 onClick={() => setIsLastOpen((prev) => !prev)}>
              <Icon icon={isLastOpen ? "chevron-down" : "chevron-right"} />
              Last month
            </h3>
            <Collapse isOpen={isLastOpen}>
              {generateTable(tokensCounter.lastMonth)}
            </Collapse>
          </>
        )}
        <Divider />

        <h3 onClick={() => setIsTotalOpen((prev) => !prev)}>
          <Icon icon={isTotalOpen ? "chevron-down" : "chevron-right"} />
          Total
        </h3>
        <Collapse isOpen={isTotalOpen}>
          {generateTable(tokensCounter.total)}
        </Collapse>
      </div>
    </Dialog>
  );
};
export default TokensDialog;
