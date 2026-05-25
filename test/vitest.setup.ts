// @ts-nocheck
import { indexedDB as fakeIndexedDB, IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb'

globalThis.indexedDB = fakeIndexedDB
globalThis.IDBKeyRange = fakeIDBKeyRange

import { createCanvas as _createCanvas, Image as CanvasImage } from 'canvas'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
})

Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true })
Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true })

globalThis.ImageData = dom.window.ImageData

class OffscreenCanvasMock {
  constructor(width, height) {
    this._canvas = _createCanvas(width || 0, height || 0)
    this.width = width || 0
    this.height = height || 0
  }

  getContext(contextType) {
    const ctx = this._canvas.getContext(contextType)
    if (!ctx) return null

    const origGetImageData = ctx.getImageData.bind(ctx)
    ctx.getImageData = function (sx, sy, sw, sh) {
      const data = origGetImageData(sx, sy, sw, sh)
      return Object.assign(data, { colorSpace: 'srgb' })
    }

    const origDrawImage = ctx.drawImage.bind(ctx)
    ctx.drawImage = function (img, ...args) {
      if (img && (img._canvas || img._nodeCanvas)) {
        return origDrawImage(img._canvas || img._nodeCanvas, ...args)
      }
      return origDrawImage(img, ...args)
    }

    return ctx
  }

  transferToImageBitmap() {
    return this
  }
}

globalThis.OffscreenCanvas = OffscreenCanvasMock

dom.window.OffscreenCanvas = OffscreenCanvasMock

const origCreateElement = dom.window.document.createElement.bind(dom.window.document)

dom.window.document.createElement = function (tagName, options) {
  if ((tagName || '').toLowerCase() === 'canvas') {
    const c = _createCanvas(0, 0)
    const el = origCreateElement.call(this, 'canvas', options)

    Object.defineProperty(el, '_nodeCanvas', { value: c, writable: false })
    Object.defineProperty(el, 'width', { get: () => c.width, set: v => { c.width = v }, configurable: true })
    Object.defineProperty(el, 'height', { get: () => c.height, set: v => { c.height = v }, configurable: true })

    el.getContext = function (contextType) {
      const ctx = c.getContext(contextType)
      if (!ctx) return null

      const origGetImageData = ctx.getImageData.bind(ctx)
      ctx.getImageData = function (sx, sy, sw, sh) {
        const data = origGetImageData(sx, sy, sw, sh)
        return Object.assign(data, { colorSpace: 'srgb' })
      }

      const origDrawImage = ctx.drawImage.bind(ctx)
      ctx.drawImage = function (img, ...args) {
        if (img && img._nodeCanvas) {
          return origDrawImage(img._nodeCanvas, ...args)
        }
        return origDrawImage(img, ...args)
      }

      return ctx
    }

    el.toDataURL = function () { return c.toDataURL(...arguments) }
    el.toBlob = function (cb) { return c.toBlob(cb) }

    return el
  }
  return origCreateElement.call(this, tagName, options)
}

dom.window.Image = CanvasImage
globalThis.Image = CanvasImage
globalThis.HTMLImageElement = CanvasImage