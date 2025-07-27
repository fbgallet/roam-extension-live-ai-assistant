import React from "react";
import { Tooltip } from "@blueprintjs/core";
import { estimateTokensPricing } from "../../../ai/aiAPIsHub";
import { tokensLimit } from "../../../ai/modelsInfo";

const TokenEstimateDisplay = ({ estimatedTokens, defaultModel }) => {
  const insertEstimatedCost = () => {
    let cost = estimateTokensPricing(defaultModel, parseInt(estimatedTokens));
    return cost ? ` (±${cost}$)` : "";
  };

  if (!estimatedTokens || estimatedTokens === "0") {
    return null;
  }

  return (
    <div className="estimate-tokens">
      <Tooltip
        content={
          <div>
            Rough estimate: 1 character = 0.3 token
            <br />
            Multiply by 2 or 3 for CJK characters
          </div>
        }
        hoverOpenDelay={800}
        openOnTargetFocus={false}
        style={{ zIndex: "9999" }}
      >
        <div>
          Estimated context tokens: {estimatedTokens.toLocaleString()}
          {insertEstimatedCost()}
          {tokensLimit[defaultModel] &&
            parseInt(estimatedTokens) > tokensLimit[defaultModel] && (
              <div style={{ color: "red", fontSize: "smaller" }}>
                Context window for this model is{" "}
                {tokensLimit[defaultModel].toLocaleString()}.
              </div>
            )}
        </div>
      </Tooltip>
    </div>
  );
};

export default TokenEstimateDisplay;