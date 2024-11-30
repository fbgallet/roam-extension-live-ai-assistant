import { Dialog, Classes } from "@blueprintjs/core";
import { extensionStorage } from "..";
import { modelsPricing } from "../ai/modelsInfo";

const TokensDialog = ({ isOpen, onClose }) => {
  // Fonction utilitaire pour calculer le coût
  const tokensCounter = extensionStorage.get("tokensCounter");
  console.log("tokensCounter from tokensDisplay :>> ", tokensCounter);

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
    const tableData = Object.entries(data)
      .filter(([model]) => model !== "month")
      .map(([model, counts]) => {
        const inputCost = calculateCost(
          counts.input,
          modelsPricing[model]?.input
        );
        const outputCost = calculateCost(
          counts.output,
          modelsPricing[model]?.output
        );
        const totalCost =
          isNaN(inputCost) || isNaN(outputCost) ? NaN : inputCost + outputCost;
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
      useOverflowScrollContainer={true}
      title="Live AI Assistant - Tokens usage and cost"
      className="tokens-dialog"
    >
      <div className={Classes.DIALOG_BODY}>
        {tokensCounter.lastRequest && (
          <div className="last-request">
            <h3>Last request</h3>
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
                          modelsPricing[tokensCounter.lastRequest.model]?.input
                        )
                      )}
                    </td>
                    <td>
                      {formatCost(
                        calculateCost(
                          tokensCounter.lastRequest.output,
                          modelsPricing[tokensCounter.lastRequest.model]?.output
                        )
                      )}
                    </td>
                    <td>
                      {formatCost(
                        calculateCost(
                          tokensCounter.lastRequest.input,
                          modelsPricing[tokensCounter.lastRequest.model]?.input
                        ) +
                          calculateCost(
                            tokensCounter.lastRequest.output,
                            modelsPricing[tokensCounter.lastRequest.model]
                              ?.output
                          )
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
        <h3>Current month</h3>
        {generateTable(tokensCounter.monthly)}
        {Object.keys(tokensCounter.lastMonth || {}).length > 0 && (
          <>
            <h3>Last month</h3>
            {generateTable(tokensCounter.lastMonth)}
          </>
        )}
        <h3>Total</h3>
        {generateTable(tokensCounter.total)}
      </div>
    </Dialog>
  );
};
export default TokensDialog;
