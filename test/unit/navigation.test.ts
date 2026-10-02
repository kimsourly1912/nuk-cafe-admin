import { describe, expect, it } from 'vitest'
import { withActiveItem } from '../../app/utils/navigation-active'

const groups = [
  [{ label: 'Dashboard', to: '/admin' }],
  [{ label: 'Menu', type: 'label' as const }, { label: 'Menu items', to: '/admin/products' }, { label: 'Add-ons', to: '/admin/add-ons' }],
  [{ label: 'Branch', to: '/admin/branches' }],
]

function activeLabels(path: string) {
  return withActiveItem(groups, path).flat().filter(item => item.active).map(item => item.label)
}

describe('the sidebar\'s active item', () => {
  it('is the page itself', () => {
    expect(activeLabels('/admin/branches')).toEqual(['Branch'])
    expect(activeLabels('/admin')).toEqual(['Dashboard'])
  })

  it('stays on the section for a page under it', () => {
    expect(activeLabels('/admin/branches/br-1')).toEqual(['Branch'])
    expect(activeLabels('/admin/products/new')).toEqual(['Menu items'])
    expect(activeLabels('/admin/add-ons/grp-1')).toEqual(['Add-ons'])
  })

  it('never marks Dashboard for another admin page, nor a section sharing a prefix', () => {
    expect(activeLabels('/admin/staff')).toEqual([])
    expect(activeLabels('/admin/products-archive')).toEqual([])
  })

  it('leaves labels alone', () => {
    expect(withActiveItem(groups, '/admin')[1]![0]).toEqual({ label: 'Menu', type: 'label' })
  })
})
