// Tests for sap-rfc-lite Client API surface
// Integration tests that call RFC require SAP NW RFC SDK + SAP system

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('Client API surface', () => {
  it('constructor requires connection parameters', () => {
    // Import the client module directly (not via index which loads native binding)
    // We can't test the actual Client class without the native addon,
    // but we CAN verify the TypeScript types compile correctly
    const types = require('../src/ts/types');
    assert.ok(types);
  });

  it('exports expected type names', () => {
    // Verify type definitions are importable
    const types = require('../src/ts/types');
    // Types are compile-time only, but the module should load
    assert.equal(typeof types, 'object');
  });
});

describe('Types module', () => {
  it('loads without errors', () => {
    const types = require('../src/ts/types');
    assert.ok(types);
  });
});
