export function ticketAvailability(tier, stock) {
  if (!stock) return { soldOut: Boolean(tier.soldOut), maxQuantity: 0, message: 'Checking availability...' }
  if (stock.sold_out) return { soldOut: true, maxQuantity: 0, message: 'Sold out' }
  const maxQuantity = stock.available === null ? 20 : Math.min(20, Math.floor(Number(stock.available) / tier.bundleSize))
  if (maxQuantity < 1) return { soldOut: false, maxQuantity: 0, message: 'Currently unavailable - tickets are held at checkout' }
  const message = stock.remaining !== null && Number(stock.remaining) < stock.low_stock_threshold
    ? `Only ${stock.remaining} left` : ''
  return { soldOut: false, maxQuantity, message }
}
