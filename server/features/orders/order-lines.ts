import type { OrderLine } from '#shared/contracts/orders'
import type { orderLines } from './orders.schema'

/** An order line as the customer, the counter and the reports read it: as it was sold. */
export function toOrderLine(line: typeof orderLines.$inferSelect): OrderLine {
  return {
    itemId: line.itemId,
    variationId: line.variationId,
    itemName: line.itemName,
    detail: line.detail,
    modifiers: line.modifiers,
    unitPriceMinor: line.unitPriceMinor,
    quantity: line.quantity,
    totalMinor: line.totalMinor,
    note: line.note,
    regularUnitPriceMinor: line.regularUnitPriceMinor,
    promotion: line.promotionName && line.promotionLabel ? { name: line.promotionName, label: line.promotionLabel } : null,
  }
}
