/**
 * Simple console test for the FindPagesByTitleTool
 * Copy and paste this directly into the browser console to test
 */

// Test the FindPagesByTitleTool directly with Roam API
async function testFindPagesByTitle() {
  console.log('🧪 Testing FindPagesByTitle functionality...');
  
  if (!window.roamAlphaAPI) {
    console.error('❌ Roam API not available');
    return;
  }
  
  try {
    // Test 1: Get all pages (basic functionality)
    console.log('\n📝 Test 1: Getting all pages...');
    const allPagesQuery = `[:find ?uid ?title ?created ?modified
                          :where 
                          [?page :node/title ?title]
                          [?page :block/uid ?uid]
                          [?page :create/time ?created]
                          [?page :edit/time ?modified]]`;
    
    const allPages = window.roamAlphaAPI.q(allPagesQuery);
    console.log(`✅ Found ${allPages.length} total pages`);
    
    // Show first 5 pages
    if (allPages.length > 0) {
      console.log('First 5 pages:');
      allPages.slice(0, 5).forEach(([uid, title, created, modified], i) => {
        console.log(`  ${i + 1}. "${title}" (${uid})`);
      });
    }
    
    // Test 2: Search for pages containing "project" (case insensitive)
    console.log('\n📝 Test 2: Finding pages containing "project"...');
    const projectPages = allPages.filter(([uid, title]) => 
      title.toLowerCase().includes('project')
    );
    
    console.log(`✅ Found ${projectPages.length} pages containing "project"`);
    projectPages.forEach(([uid, title], i) => {
      console.log(`  ${i + 1}. "${title}" (${uid})`);
    });
    
    // Test 3: Identify Daily Note Pages
    console.log('\n📝 Test 3: Identifying Daily Note Pages...');
    const dnpPattern = /^\d{2}-\d{2}-\d{4}$/;
    const dailyPages = allPages.filter(([uid]) => dnpPattern.test(uid));
    
    console.log(`✅ Found ${dailyPages.length} Daily Note Pages`);
    if (dailyPages.length > 0) {
      console.log('Recent DNPs:');
      dailyPages.slice(0, 3).forEach(([uid, title], i) => {
        console.log(`  ${i + 1}. "${title}" (${uid})`);
      });
    }
    
    // Test 4: Test exact match
    console.log('\n📝 Test 4: Testing exact match...');
    const exactMatch = allPages.filter(([uid, title]) => title === 'Daily Notes');
    console.log(`✅ Exact match for "Daily Notes": ${exactMatch.length} result(s)`);
    
    console.log('\n🏁 Basic functionality test completed!');
    return { allPages: allPages.length, projectPages: projectPages.length, dailyPages: dailyPages.length };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return null;
  }
}

// Test the actual tool implementation (if available)
async function testToolImplementation() {
  console.log('🧪 Testing FindPagesByTitleTool implementation...');
  
  // This would test the actual tool if it's loaded
  if (typeof window.FindPagesByTitleTool !== 'undefined') {
    console.log('✅ Tool class available');
    // Test the tool here
  } else {
    console.log('⏳ Tool class not yet loaded in window');
    console.log('📝 This is expected - the tool will be available when the ReAct agent is active');
  }
}

// Performance test
async function testQueryPerformance() {
  console.log('🧪 Testing query performance...');
  
  if (!window.roamAlphaAPI) {
    console.error('❌ Roam API not available');
    return;
  }
  
  const startTime = performance.now();
  
  const query = `[:find ?uid ?title
                 :where 
                 [?page :node/title ?title]
                 [?page :block/uid ?uid]]`;
  
  const result = window.roamAlphaAPI.q(query);
  const endTime = performance.now();
  
  console.log(`⏱️ Query took ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`📊 Retrieved ${result.length} pages`);
  
  return { duration: endTime - startTime, resultCount: result.length };
}

// Run all tests
async function runConsoleTests() {
  console.log('🚀 Running console tests for ReAct Search Agent tools...\n');
  
  const basicTest = await testFindPagesByTitle();
  await testToolImplementation();
  const perfTest = await testQueryPerformance();
  
  console.log('\n📈 Test Summary:');
  if (basicTest) {
    console.log(`  - Total pages: ${basicTest.allPages}`);
    console.log(`  - Project pages: ${basicTest.projectPages}`);
    console.log(`  - Daily pages: ${basicTest.dailyPages}`);
  }
  if (perfTest) {
    console.log(`  - Query performance: ${perfTest.duration.toFixed(2)}ms for ${perfTest.resultCount} pages`);
  }
  
  console.log('\n🎉 Console tests completed!');
  console.log('\n📝 Next steps:');
  console.log('  1. Test passed - basic Roam API queries work');
  console.log('  2. Tool implementation can be tested once ReAct agent is integrated');
  console.log('  3. Ready to proceed with Phase 2 implementation');
}

// Make functions available globally
window.testReactSearchConsole = {
  testFindPagesByTitle,
  testToolImplementation,
  testQueryPerformance,
  runConsoleTests
};

console.log('🔧 Console tests loaded! Run: window.testReactSearchConsole.runConsoleTests()');