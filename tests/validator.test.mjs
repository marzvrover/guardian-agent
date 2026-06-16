import test from 'node:test'
import assert from 'node:assert/strict'
import { processRegex, processRules } from '../bin/validator.mjs'

test('processRegex returns a match result', async () => {
  assert.deepEqual(
    await processRegex({ id: 'x', definition: 'h.*o' }, 'hello'),
    { id: 'x', matches: true }
  )
})

test('processRules lowercases ids and evaluates regex rules', async () => {
  const result = await processRules(
    [{ id: 'RULE1', type: 'REGEX', definition: 'h.*o' }],
    'hello'
  )
    assert.deepEqual(result, { regex: [{ id: 'rule1', matches: true }] })
})
