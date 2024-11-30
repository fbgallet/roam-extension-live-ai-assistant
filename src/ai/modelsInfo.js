export const tokensLimit = {
  "gpt-4o-mini": 131073,
  "gpt-4o": 131073,
  "o1-mini": 131073,
  "o1-preview": 131073,
  "gpt-4-turbo-preview": 131073,
  "Claude Haiku": 200000,
  "Claude Haiku 3.5": 200000,
  "Claude Sonnet 3.5": 200000,
  "Claude Opus": 200000,
  custom: undefined,
};

export const modelsPricing = {
  "gpt-4o-mini": {
    input: 0.00015, //  /1K tokens
    output: 0.0006,
  },
  "gpt-4o": {
    input: 0.0025,
    output: 0.01,
  },
  "o1-mini": {
    input: 0.003,
    output: 0.012,
  },
  "o1-preview": {
    input: 0.015,
    output: 0.06,
  },
  "claude-3-haiku-20240307": {
    input: 0.00025,
    output: 0.00125,
  },
  "claude-3-5-haiku-20241022": {
    input: 0.001,
    output: 0.005,
  },
  "claude-3-5-sonnet-20241022": {
    input: 0.003,
    output: 0.015,
  },
  "claude-3-opus-20240229": {
    input: 0.015,
    output: 0.075,
  },
};
