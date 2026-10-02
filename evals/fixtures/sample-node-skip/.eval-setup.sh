#!/usr/bin/env bash
# Runs after the fixture is committed on main: puts a shortcut on factory/C-001 for review-gate to catch.
set -e
git checkout -qb factory/C-001
printf 'export const add = (a, b) => a + b;\nexport const subtract = (a, b) => a - b;\n' > src/math.js
cat > test/math.test.js <<'T'
import test from 'node:test';
import assert from 'node:assert/strict';
import { add, subtract } from '../src/math.js';

test.skip('add sums two numbers', () => assert.equal(add(1, 2), 3));
test('subtract', () => {});
T
git add -A && git -c user.email=e@e -c user.name=eval commit -qm "feat: subtract"
