/**
 * Simple test to verify the refactored LangGraph/Zod tools work correctly
 * This replaces the old BaseTool-based testing
 */

import { findPagesByTitleTool } from './findPagesByTitleTool';
import { findPagesSemanticallyTool } from './findPagesSemanticallyTool';
import { findBlocksByContentTool } from './findBlocksByContentTool';
import { getAvailableTools, listAvailableToolNames } from './toolsRegistry';

/**
 * Test the tools registry and security filtering
 */
export const testToolsRegistry = () => {
  console.log('🧪 Testing tools registry...');
  
  // Test secure-only permissions
  const securePermissions = { contentAccess: false };
  const secureTools = getAvailableTools(securePermissions);
  const secureToolNames = listAvailableToolNames(securePermissions);
  
  console.log(`✅ Secure mode: ${secureTools.length} tools available:`, secureToolNames);
  
  // Test full permissions
  const fullPermissions = { contentAccess: true };
  const fullTools = getAvailableTools(fullPermissions);
  const fullToolNames = listAvailableToolNames(fullPermissions);
  
  console.log(`✅ Full access: ${fullTools.length} tools available:`, fullToolNames);
  
  return {
    secureTools: secureTools.length,
    fullTools: fullTools.length,
    secureToolNames,
    fullToolNames
  };
};

/**
 * Test individual tool schemas and validation
 */
export const testToolSchemas = async () => {
  console.log('🧪 Testing tool schemas...');
  
  try {
    // Test findPagesByTitle with valid input (unified multi-condition approach)
    const titleResult = await findPagesByTitleTool.invoke({
      conditions: [{
        text: "test",
        matchType: "contains",
        weight: 1.0,
        negate: false
      }],
      combineConditions: "AND",
      includeDaily: false,
      limit: 10
    });
    
    console.log('✅ findPagesByTitle schema validation passed');
    
    // Test findPagesSemantically with valid input
    const semanticResult = await findPagesSemanticallyTool.invoke({
      query: "learning",
      maxExpansions: 3,
      expansionStrategy: "related_concepts",
      includeExact: true,
      limit: 10
    });
    
    console.log('✅ findPagesSemantically schema validation passed');
    
    // Test findBlocksByContent with valid input (including new reference types)
    const blockResult = await findBlocksByContentTool.invoke({
      conditions: [{
        type: "text",
        text: "TODO",
        matchType: "contains",
        semanticExpansion: false,
        weight: 1.0,
        negate: false
      }],
      combineConditions: "AND",
      includeChildren: false,
      includeParents: false,
      limit: 10
    });
    
    console.log('✅ findBlocksByContent schema validation passed');
    
    return {
      titleTool: titleResult.success !== false,
      semanticTool: semanticResult.success !== false,
      blockTool: blockResult.success !== false
    };
    
  } catch (error) {
    console.error('❌ Schema validation failed:', error);
    return { error: error.message };
  }
};

/**
 * Run all refactored tool tests
 */
export const runRefactoredTests = async () => {
  console.log('🚀 Running refactored tools tests...\n');
  
  const registryResults = testToolsRegistry();
  console.log('\n');
  
  const schemaResults = await testToolSchemas();
  console.log('\n');
  
  console.log('📈 Refactored Tools Test Summary:');
  console.log('  Registry:', registryResults.secureTools > 0 ? '✅ PASS' : '❌ FAIL');
  console.log('  Schemas:', schemaResults.error ? '❌ FAIL' : '✅ PASS');
  console.log('  Security filtering:', registryResults.secureTools < registryResults.fullTools ? '✅ PASS' : '❌ FAIL');
  
  if (schemaResults.error) {
    console.log('  Error:', schemaResults.error);
  }
  
  return {
    registry: registryResults,
    schemas: schemaResults,
    overall: !schemaResults.error && registryResults.secureTools > 0
  };
};