import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { resetDb } from '../lib/db'

let n = 0
beforeEach(() => {
  resetDb(`test-${Date.now()}-${n++}`)
  localStorage.clear()
})

afterEach(() => cleanup())
