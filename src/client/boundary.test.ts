import { expect, it } from 'vitest'

it('makes the server entry throw in browser builds', async () => {
  await expect(import('../browser.js')).rejects.toThrow('@tapayadot/checkout/client')
})
