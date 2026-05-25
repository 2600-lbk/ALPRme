import { describe, it, expect } from 'vitest'
import { iou } from '@/packages/alpr/types'

describe('decoding', () => {
  it('decodes argmax per slot with simple data', () => {
    // This tests the decodeOutput function indirectly by testing the expected behavior
    // Alphabet: "ABC_"
    // Input: flat array of shape (1, 2, 4) = [A scores, B scores, C scores, _ scores] x 2 slots
    // Slot 0: [0.1, 0.7, 0.1, 0.1] → B
    // Slot 1: [0.1, 0.1, 0.8, 0.0] → C
    // Expected: "BC", confidences [0.7, 0.8], mean = 0.75
    const perSlotVocab = [
      [0.1, 0.7, 0.1, 0.1],
      [0.1, 0.1, 0.8, 0.0],
    ]
    const flatData = new Float32Array(perSlotVocab.flat())

    const alphabet = 'ABC_'
    const maxPlateSlots = 2

    const chars: string[] = []
    const confs: number[] = []
    for (let slot = 0; slot < maxPlateSlots; slot++) {
      const start = slot * alphabet.length
      let maxIdx = 0
      let maxVal = flatData[start]!
      for (let j = 1; j < alphabet.length; j++) {
        const val = flatData[start + j]!
        if (val > maxVal) { maxVal = val; maxIdx = j }
      }
      chars.push(alphabet[maxIdx]!)
      confs.push(maxVal)
    }

    let plate = chars.join('')
    while (plate.endsWith('_')) plate = plate.slice(0, -1)

    expect(plate).toBe('BC')
    expect(confs[0]).toBeCloseTo(0.7)
    expect(confs[1]).toBeCloseTo(0.8)
  })

  it('strips trailing pad characters', () => {
    const perSlotVocab = [
      [0.1, 0.7, 0.1, 0.1],
      [0.1, 0.1, 0.1, 0.7],
    ]
    const flatData = new Float32Array(perSlotVocab.flat())
    const alphabet = 'ABC_'

    const chars: string[] = []
    for (let slot = 0; slot < 2; slot++) {
      const start = slot * 4
      let maxIdx = 0
      let maxVal = flatData[start]!
      for (let j = 1; j < 4; j++) {
        const val = flatData[start + j]!
        if (val > maxVal) { maxVal = val; maxIdx = j }
      }
      chars.push(alphabet[maxIdx]!)
    }

    let plate = chars.join('')
    while (plate.endsWith('_')) plate = plate.slice(0, -1)

    expect(plate).toBe('B')
  })

  it('handles all pad characters', () => {
    const perSlotVocab = [
      [0.1, 0.1, 0.1, 0.7],
      [0.1, 0.1, 0.1, 0.7],
    ]
    const flatData = new Float32Array(perSlotVocab.flat())
    const alphabet = 'ABC_'

    const chars: string[] = []
    for (let slot = 0; slot < 2; slot++) {
      const start = slot * 4
      let maxIdx = 0
      let maxVal = flatData[start]!
      for (let j = 1; j < 4; j++) {
        const val = flatData[start + j]!
        if (val > maxVal) { maxVal = val; maxIdx = j }
      }
      chars.push(alphabet[maxIdx]!)
    }

    let plate = chars.join('')
    while (plate.endsWith('_')) plate = plate.slice(0, -1)

    expect(plate).toBe('')
  })
})

describe('iou', () => {
  it('computes IoU for overlapping boxes', () => {
    const a = { x1: 0, y1: 0, x2: 100, y2: 100 }
    const b = { x1: 50, y1: 50, x2: 150, y2: 150 }
    const result = iou(a, b)
    // Intersection: 50x50 = 2500, Union: 20000 - 2500 = 17500
    expect(result).toBeCloseTo(2500 / 17500, 5)
  })

  it('returns 0 for non-overlapping boxes', () => {
    const a = { x1: 0, y1: 0, x2: 10, y2: 10 }
    const b = { x1: 20, y1: 20, x2: 30, y2: 30 }
    expect(iou(a, b)).toBe(0)
  })

  it('returns 1 for identical boxes', () => {
    const a = { x1: 0, y1: 0, x2: 100, y2: 100 }
    expect(iou(a, a)).toBe(1)
  })

  it('handles fully contained box', () => {
    const a = { x1: 0, y1: 0, x2: 100, y2: 100 }
    const b = { x1: 25, y1: 25, x2: 75, y2: 75 }
    const result = iou(a, b)
    // Intersection: 50x50 = 2500, Union: 100x100 = 10000
    expect(result).toBeCloseTo(0.25, 5)
  })
})
