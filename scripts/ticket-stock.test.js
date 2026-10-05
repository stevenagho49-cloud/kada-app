import test from 'node:test'
import assert from 'node:assert/strict'
import { ticketAvailability } from '../src/lib/ticketStock.js'

const tier = { bundleSize: 1, soldOut: false }
const counts = { sold: 2, remaining: 1, available: 1, sold_out: false, low_stock_threshold: 10 }

test('three-ticket limit: two sold warns, third sold disables purchasing', () => {
  assert.deepEqual(ticketAvailability(tier, counts), { soldOut: false, maxQuantity: 1, message: 'Only 1 left' })
  assert.deepEqual(ticketAvailability(tier, { ...counts, sold: 3, remaining: 0, available: 0, sold_out: true }),
    { soldOut: true, maxQuantity: 0, message: 'Sold out' })
})
test('unlimited tiers retain the existing twenty-purchase cap without scarcity', () => {
  assert.deepEqual(ticketAvailability(tier, { ...counts, remaining: null, available: null }),
    { soldOut: false, maxQuantity: 20, message: '' })
})
test('manual override works without sales and applies to unlimited tiers', () => {
  assert.equal(ticketAvailability(tier, { ...counts, sold: 0, remaining: null, available: null, sold_out: true }).message, 'Sold out')
  assert.equal(ticketAvailability(tier, { ...counts, sold_out: true }).maxQuantity, 0)
})
test('fresh stock reopens a tier even when the initial event snapshot had the manual override', () => {
  assert.equal(ticketAvailability({ ...tier, soldOut: true }, counts).maxQuantity, 1)
})
test('threshold is exclusive, configurable and can be disabled', () => {
  assert.equal(ticketAvailability(tier, { ...counts, remaining: 10, available: 10 }).message, '')
  assert.equal(ticketAvailability(tier, { ...counts, low_stock_threshold: 0 }).message, '')
  assert.equal(ticketAvailability(tier, { ...counts, low_stock_threshold: 2 }).message, 'Only 1 left')
})
test('bundle quantities use individual tickets and cannot oversell leftover seats', () => {
  assert.equal(ticketAvailability({ ...tier, bundleSize: 2 }, { ...counts, remaining: 7, available: 7 }).maxQuantity, 3)
  assert.match(ticketAvailability({ ...tier, bundleSize: 2 }, counts).message, /unavailable/)
})
test('held stock is not advertised as sold and missing stock fails closed', () => {
  assert.deepEqual(ticketAvailability(tier, { ...counts, available: 0 }),
    { soldOut: false, maxQuantity: 0, message: 'Currently unavailable - tickets are held at checkout' })
  assert.equal(ticketAvailability(tier, undefined).maxQuantity, 0)
})
