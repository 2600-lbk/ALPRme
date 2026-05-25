import { describe, it, expect } from 'vitest'
import { levenshtein, plateSimilar } from '@/pipeline/fuzzy'

describe('levenshtein', () => {
  it('returns 0 for identical', () => {
    expect(levenshtein('ABC123', 'ABC123')).toBe(0)
  })
  it('handles empty', () => {
    expect(levenshtein('', 'ABC')).toBe(3)
    expect(levenshtein('ABC', '')).toBe(3)
  })
  it('counts one substitution', () => {
    expect(levenshtein('ABC123', 'ABC124')).toBe(1)
  })
  it('counts one insertion', () => {
    expect(levenshtein('ABC123', 'ABC1234')).toBe(1)
  })
  it('counts multiple edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
})

describe('plateSimilar', () => {
  it('requires exact match at distance 0', () => {
    expect(plateSimilar('ABC123', 'ABC123', 0)).toBe(true)
    expect(plateSimilar('ABC123', 'ABC124', 0)).toBe(false)
  })
  it('allows one substitution at distance 1', () => {
    expect(plateSimilar('ABC123', 'ABD123', 1)).toBe(true)
    expect(plateSimilar('ABC123', 'XYC123', 1)).toBe(false)
  })
  it('short-circuits on length mismatch', () => {
    expect(plateSimilar('ABC', 'ABCDE', 1)).toBe(false)
  })
})
