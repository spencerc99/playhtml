// Simple test to verify cursor integration is working
console.log("Testing PlayHTML cursor integration...");

// Test that all modules load correctly
try {
  const { playhtml } = require('./packages/playhtml/src/main.ts');
  console.log("✅ PlayHTML main module loaded");
} catch (error) {
  console.log("❌ Error loading PlayHTML main:", error.message);
}

try {
  const cursorTypes = require('./packages/common/src/cursor-types.ts');
  console.log("✅ Cursor types loaded");
} catch (error) {
  console.log("❌ Error loading cursor types:", error.message);
}

try {
  const schemas = require('./partykit/cursor-schemas.ts');
  console.log("✅ Cursor schemas loaded");
} catch (error) {
  console.log("❌ Error loading cursor schemas:", error.message);
}

console.log("Integration test complete!");