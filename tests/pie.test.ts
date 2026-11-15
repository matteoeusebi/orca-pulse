import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { pie } from '../src/panel-icons'

test('pie uses the approved thin outer ring and smaller wedge at zero, partial and full progress', () => {
  for (const fraction of [0, 0.25, 0.75, 1]) {
    assert.match(pie(fraction), /r="5.9" fill="none" stroke="currentColor" stroke-width="0.6"/)
  }
  assert.doesNotMatch(pie(0), /<path/)
  assert.match(pie(0.25), /M8 8V4.4A3.6 3.6 0 0 1 11.600 8.000Z/)
  assert.match(pie(0.75), /M8 8V4.4A3.6 3.6 0 1 1 4.400 8.000Z/)
  assert.match(pie(1), /r="3.6" fill="currentColor"/)
  assert.equal(pie(-1), pie(0))
  assert.equal(pie(2), pie(1))
})
