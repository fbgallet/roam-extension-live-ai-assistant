/**
 * Manual test for the new semantic expansion modes
 * Run this in the browser console to test the different modes
 */

const testExpansionModes = () => {
  console.log("🧪 Testing Semantic Expansion Modes");
  console.log("=====================================");

  // Test the mode mapping in index.js
  const modeMap = {
    "Always ask user": "ask_user",
    "Automatic until result": "auto_until_result", 
    "Always with fuzzy": "always_fuzzy",
    "Always with fuzzy + synonyms": "always_fuzzy_synonyms"
  };

  console.log("Mode mappings:", modeMap);

  // Test current settings
  if (typeof window !== 'undefined' && window.LiveAI) {
    console.log("Current automaticSemanticExpansionMode:", window.automaticSemanticExpansionMode || "undefined");
  }

  // Test each mode with mock scenarios
  const mockScenarios = [
    {
      mode: "ask_user",
      hasResults: false,
      userQuery: "find blocks about AI",
      expected: "Should NOT expand automatically, wait for user"
    },
    {
      mode: "ask_user", 
      hasResults: false,
      userQuery: "find blocks with semantic expansion",
      expected: "Should expand because user requested it"
    },
    {
      mode: "auto_until_result",
      hasResults: false,
      userQuery: "find blocks about AI",
      expected: "Should expand automatically until results found"
    },
    {
      mode: "always_fuzzy",
      hasResults: true,
      userQuery: "find blocks about AI", 
      expected: "Should always apply fuzzy (level 1)"
    },
    {
      mode: "always_fuzzy_synonyms",
      hasResults: true,
      userQuery: "find blocks about AI",
      expected: "Should always apply fuzzy + synonyms (level 2)"
    },
    {
      mode: "always_fuzzy",
      hasResults: false,
      userQuery: "find exact blocks about AI",
      expected: "Should NOT expand due to 'exact' override"
    }
  ];

  console.log("\nTesting scenarios:");
  mockScenarios.forEach((scenario, i) => {
    console.log(`\n${i+1}. Mode: ${scenario.mode}`);
    console.log(`   Query: "${scenario.userQuery}"`);
    console.log(`   Has Results: ${scenario.hasResults}`);
    console.log(`   Expected: ${scenario.expected}`);
  });

  console.log("\n✅ Test setup complete. Use the settings panel to change modes and test with real queries.");
};

// Export for use
if (typeof window !== 'undefined') {
  window.testExpansionModes = testExpansionModes;
  console.log("💡 Run testExpansionModes() in console to test expansion modes");
}