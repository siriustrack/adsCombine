#!/bin/bash

# Test runner for Edital Processing Integration Tests
# This script runs comprehensive tests on PDF edital extraction and processing

echo "🧪 Edital Processing Integration Test Suite"
echo "=========================================="
echo ""

# Check if test PDFs exist
EDITAIS_DIR="docs/editais-test"
if [ ! -d "$EDITAIS_DIR" ]; then
  echo "❌ Error: Test editais directory not found: $EDITAIS_DIR"
  exit 1
fi

PDF_COUNT=$(find "$EDITAIS_DIR" -name "*.pdf" | wc -l)
echo "📄 Found $PDF_COUNT PDF files to test"
echo ""

# Create temp directory for results
TEMP_DIR="temp/test-results"
mkdir -p "$TEMP_DIR"

echo "🗑️  Cleaning previous test results..."
rm -f "$TEMP_DIR"/*.json

echo "▶️  Starting tests..."
echo ""

# Run Jest with specific configuration
npx jest test/integration/edital-processing.test.ts \
  --verbose \
  --runInBand \
  --testTimeout=300000 \
  --detectOpenHandles \
  --forceExit

TEST_EXIT_CODE=$?

echo ""
echo "=========================================="

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo "✅ All tests passed!"
  
  # Show summary if available
  if [ -f "$TEMP_DIR/_SUMMARY.json" ]; then
    echo ""
    echo "📊 Test Summary:"
    cat "$TEMP_DIR/_SUMMARY.json" | jq -r '.overall | to_entries[] | "   \(.key): \(.value)"'
  fi
else
  echo "❌ Some tests failed (exit code: $TEST_EXIT_CODE)"
fi

echo ""
echo "💾 Detailed results saved in: $TEMP_DIR/"
echo "=========================================="

exit $TEST_EXIT_CODE
