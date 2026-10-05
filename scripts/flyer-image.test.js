import test from 'node:test'
import assert from 'node:assert/strict'
import { flyerTargetSize, flyerFileName } from '../src/lib/flyerImage.js'

test('wide images are capped at 1600px wide, keeping the aspect ratio', () => {
  assert.deepEqual(flyerTargetSize(4320, 2160), { width: 1600, height: 800 })
})
test('tall images are capped at 2400px high', () => {
  assert.deepEqual(flyerTargetSize(3000, 6000), { width: 1200, height: 2400 })
})
test('small images are never enlarged', () => {
  assert.deepEqual(flyerTargetSize(800, 600), { width: 800, height: 600 })
})
test('empty images are rejected', () => {
  assert.throws(() => flyerTargetSize(0, 0))
})
test('stored names always end in .jpg and are storage-safe', () => {
  assert.equal(flyerFileName('IMG_0597.PNG'), 'IMG_0597.jpg')
  assert.equal(flyerFileName('My Flyer (final).webp'), 'My-Flyer--final-.jpg')
  assert.equal(flyerFileName(''), 'flyer.jpg')
})
