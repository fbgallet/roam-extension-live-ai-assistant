/********************/
/*  Status Toaster  */
/********************/

import { Intent, ProgressBar } from "@blueprintjs/core";
import { AgentToaster } from "../../../components/Toaster";
import { SearchAgentState, toasterInstance } from "./search-agent";

export const displayAgentStatus = (
  state: typeof SearchAgentState.State,
  status: string
) => {
  let completion = 0.1;
  // console.log("status in displayAgentStatus :>> ", status);
  switch (status) {
    case "nl-question-interpreter":
      completion = 0.2;
      break;
    case "searchlist-converter":
      completion = 0.3;
      break;
    case "queryRunner":
      completion = 0.5;
      break;
    case "limitAndOrder":
      completion = 0.6;
      break;
    case "preselection-filter":
      completion = 0.7;
      break;
    case "post-processing":
      completion = 0.9;
      break;
    case "output":
      completion = 1;
      break;
  }
  AgentToaster.show(
    {
      icon: "form",
      message: (
        <>
          {progressBarDisplay(
            state.isPostProcessingNeeded || completion <= 0.1
              ? completion
              : completion + 0.3
          )}
          <ul>
            {completion === 0.1 && (
              <li>
                <strong>Interpreting natural language user request...</strong>
              </li>
            )}
            {completion >= 0.2 && (state.isRandom || state.nbOfResults) && (
              <li>
                ✔️ {state.nbOfResults || ""}
                {state.isRandom ? " random results " : "results requested "}
                {state.pagesLimitation
                  ? "in '" +
                    state.pagesLimitation.replace("dnp", "Daily Notes") +
                    "' pages."
                  : ""}
              </li>
            )}
            {completion >= 0.3 && (
              <>
                {state.period &&
                  `✔️ In period range from ${
                    state.period.begin ? state.period.begin : "∞"
                  } to ${state.period.end ? state.period.end : "today"}.`}
                <li>
                  ✔️ Search list(s) interpreted:
                  <ol>
                    {state.searchLists?.length &&
                      state.searchLists.map((list: string, index: number) => (
                        <li>
                          <code>{list}</code>
                          {completion >= 0.5 && (
                            <ul>
                              <li>
                                ✔️ Regex filters:
                                <ol>
                                  {state.filters?.length > index &&
                                    state.filters[index].map((elt: any) => (
                                      <li>
                                        <code>{elt.regexString}</code>
                                      </li>
                                    ))}
                                </ol>
                              </li>
                            </ul>
                          )}
                        </li>
                      ))}
                  </ol>
                </li>
              </>
            )}
            {completion === 0.3 && (
              <li>
                <strong>Converting search list to Regex filters...</strong>
              </li>
            )}
            {completion === 0.5 && (
              <li>
                <strong>Running Roam database queries...</strong>
              </li>
            )}
            {completion >= 0.6 && (
              <li>
                ✔️ Roam database queries: {state.matchingBlocks?.length}{" "}
                matching blocks
              </li>
            )}
            {completion === 0.7 && (
              <li>Preselection of most relevant blocks...</li>
            )}
            {completion === 0.9 && (
              <li>Post-processing {state.filteredBlocks?.length} blocks...</li>
            )}
            {completion === 1 && (
              <li>
                ✔️ Insert{" "}
                {state.isPostProcessingNeeded
                  ? "processed"
                  : state.nbOfResults || state.nbOfResultsDisplayed}{" "}
                results in your graph.
              </li>
            )}
          </ul>
        </>
      ),
      timeout: status === "output" ? 15000 : 0,
    },
    toasterInstance
  );
};

const progressBarDisplay = (value: number) => {
  if (value > 1) value = 1;
  return (
    <ProgressBar
      value={value}
      className="laia-progressbar"
      intent={value < 1 ? Intent.PRIMARY : Intent.SUCCESS}
      animate={value < 1 ? true : false}
      stripes={value < 1 ? true : false}
    />
  );
};
