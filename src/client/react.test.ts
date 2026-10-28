// @vitest-environment jsdom
import { createElement, StrictMode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePayment } from './react.js'
import { loadTapaya } from './index.js'
import type { Payment, PaymentOptions, PaymentSnapshot, WalletOptions } from './types.js'

vi.mock('./index.js', async (original) => ({
  ...(await original<typeof import('./index.js')>()),
  loadTapaya: vi.fn(),
}))

const KEY = `pk_dev_${'0'.repeat(32)}`
const created: PaymentOptions[] = []
const destroy = vi.fn()
const submit = vi.fn()
const update = vi.fn()
let hook: ReturnType<typeof usePayment>

function Checkout({
  label,
  height = '48px',
  icon,
  walletButtonType,
  walletButtonColor,
  walletButtonRadius,
}: {
  label: string
  height?: string
  icon?: 'left' | 'right' | 'none'
  walletButtonType?: 'plain' | 'buy'
  walletButtonColor?: 'black' | 'white'
  walletButtonRadius?: number
}) {
  hook = usePayment({
    publishableKey: KEY,
    labels: { cardholder: label },
    appearance: {
      variables: { colorText: '#000', fieldHeight: height },
      ...(icon ? { cardBrandIcon: icon } : {}),
      ...(walletButtonType ? { walletButtonType } : {}),
      ...(walletButtonColor ? { walletButtonColor } : {}),
      ...(walletButtonRadius !== undefined ? { walletButtonRadius } : {}),
    },
  })
  return hook.snapshot.state === 'successful'
    ? createElement('p', null, 'Receipt')
    : createElement('div', { ref: hook.fieldRef })
}

beforeEach(() => {
  vi.resetAllMocks()
  created.length = 0
  vi.mocked(loadTapaya).mockResolvedValue({
    version: '0.3.0',
    handleNextAction: vi.fn(),
    createPayment: (options = {}) => {
      created.push(options)
      let snapshot: PaymentSnapshot = { state: 'ready', outcome: 'open', busy: false, canSubmit: true, complete: false }
      return {
        clientSecret: options.clientSecret,
        get snapshot() {
          return snapshot
        },
        mount: async () => options.onChange?.(snapshot),
        submit: async (submitOptions) => {
          submit(submitOptions)
          snapshot = { ...snapshot, state: 'successful', canSubmit: false }
          options.onChange?.(snapshot)
          return { status: 'successful', paymentId: 'p', retryAllowed: false }
        },
        recover: vi.fn(),
        update,
        subscribe: vi.fn(),
        destroy,
      } satisfies Payment
    },
  })
})
afterEach(cleanup)

it('updates wallet totals without remounting and uses the latest checkout callback', async () => {
  const first = vi.fn().mockResolvedValue('first')
  const second = vi.fn().mockResolvedValue('second')
  function WalletCheckout({ amount, onClick }: { amount: number; onClick: () => Promise<string> }) {
    hook = usePayment({ publishableKey: KEY, wallets: { amount, currency: 'EUR' }, onWalletClick: onClick })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(WalletCheckout, { amount: 1200, onClick: first }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  const mounts = created.length
  expect(first).not.toHaveBeenCalled()
  view.rerender(createElement(WalletCheckout, { amount: 2450, onClick: second }))
  await act(async () => {})
  expect(created).toHaveLength(mounts)
  expect(update).toHaveBeenCalledWith({ wallets: { amount: 2450, currency: 'EUR' } })
  expect(await created.at(-1)!.onWalletClick!()).toBe('second')
  expect(first).not.toHaveBeenCalled()
})

it('forwards shipping callbacks and reads their latest values without remounting', async () => {
  const first = vi.fn().mockResolvedValue(undefined)
  const next = vi.fn().mockResolvedValue(undefined)
  const quoteHandler = vi.fn()
  function ShippingCheckout({ handler }: { handler: NonNullable<PaymentOptions['onShippingAddressChange']> }) {
    hook = usePayment({ publishableKey: KEY, onShippingAddressChange: handler, onShippingOptionChange: handler, onShippingQuoteChange: quoteHandler })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(ShippingCheckout, { handler: first }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  const mounts = created.length
  const event = { paymentId: 'payment-1', revision: 1, address: { country: 'CZ' }, selectedOptionId: null }
  await created.at(-1)!.onShippingAddressChange!(event)
  expect(first).toHaveBeenCalledWith(event)
  view.rerender(createElement(ShippingCheckout, { handler: next }))
  await act(async () => {})
  await created.at(-1)!.onShippingAddressChange!(event)
  await created.at(-1)!.onShippingOptionChange!({ ...event, selectedOptionId: 'standard' })
  const quote = { paymentId: 'payment-1', revision: 1, amount: 1500, shipping: 300, tax: 200, currency: 'EUR' }
  created.at(-1)!.onShippingQuoteChange!(quote)
  expect(next).toHaveBeenCalledTimes(2)
  expect(quoteHandler).toHaveBeenCalledWith(quote)
  expect(created).toHaveLength(mounts)
})

it('accepts null wallet totals and hides wallets without remounting', async () => {
  function WalletCheckout({ wallets }: { wallets: WalletOptions | null }) {
    hook = usePayment({ publishableKey: KEY, wallets })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(WalletCheckout, { wallets: null }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  expect(created[0].wallets).toBeNull()
  const mounts = created.length
  view.rerender(createElement(WalletCheckout, { wallets: { amount: 1200, currency: 'EUR' } }))
  expect(update).toHaveBeenLastCalledWith({ wallets: { amount: 1200, currency: 'EUR' } })
  view.rerender(createElement(WalletCheckout, { wallets: null }))
  expect(update).toHaveBeenLastCalledWith({ wallets: null })
  expect(created).toHaveLength(mounts)
  expect(destroy).not.toHaveBeenCalled()
})

it('passes saving policy before payment creation and remounts only when its values change', async () => {
  function Saving({ usage }: { usage: 'on_session' | 'off_session' }) {
    hook = usePayment({ publishableKey: KEY, cardSaving: { savePaymentMethod: 'optional', paymentMethodUsage: usage } })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(Saving, { usage: 'on_session' }))
  await waitFor(() => expect(created).toHaveLength(1))
  expect(created[0].cardSaving).toEqual({ savePaymentMethod: 'optional', paymentMethodUsage: 'on_session' })
  view.rerender(createElement(Saving, { usage: 'on_session' }))
  expect(created).toHaveLength(1)
  view.rerender(createElement(Saving, { usage: 'off_session' }))
  await waitFor(() => expect(created.at(-1)?.cardSaving?.paymentMethodUsage).toBe('off_session'))
  expect(created).toHaveLength(2)
})

it('does not remount when inline labels and appearance keep their values', async () => {
  const view = render(createElement(StrictMode, null, createElement(Checkout, { label: 'Name' })))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  const mounts = created.length
  view.rerender(createElement(StrictMode, null, createElement(Checkout, { label: 'Name' })))
  await act(async () => {})
  expect(created).toHaveLength(mounts)
  view.rerender(createElement(StrictMode, null, createElement(Checkout, { label: 'Jméno' })))
  await waitFor(() => expect(created.at(-1)?.labels).toEqual({ cardholder: 'Jméno' }))
})

it('restyles the mounted fields when the appearance changes', async () => {
  const view = render(createElement(Checkout, { label: 'Name' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  const mounts = created.length
  view.rerender(createElement(Checkout, { label: 'Name', height: '36px' }))
  await act(async () => {})
  expect(created).toHaveLength(mounts)
  expect(destroy).not.toHaveBeenCalled()
  expect(update).toHaveBeenLastCalledWith({ appearance: { variables: { colorText: '#000', fieldHeight: '36px' } } })
})

it('remounts when the card brand icon changes, because the provider sets it only at mount', async () => {
  const view = render(createElement(Checkout, { label: 'Name' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  view.rerender(createElement(Checkout, { label: 'Name', icon: 'right' }))
  await waitFor(() => expect(created.at(-1)?.appearance?.cardBrandIcon).toBe('right'))
  expect(destroy).toHaveBeenCalled()
})

it('remounts when the wallet button type changes, because the wallets draw their buttons at mount', async () => {
  const view = render(createElement(Checkout, { label: 'Name' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  view.rerender(createElement(Checkout, { label: 'Name', walletButtonType: 'buy' }))
  await waitFor(() => expect(created.at(-1)?.appearance?.walletButtonType).toBe('buy'))
  expect(destroy).toHaveBeenCalled()
})

it.each([
  ['color', { walletButtonColor: 'white' as const }, 'walletButtonColor', 'white'],
  ['radius', { walletButtonRadius: 0 }, 'walletButtonRadius', 0],
] as const)('remounts when the wallet button %s changes', async (_, props, key, value) => {
  const view = render(createElement(Checkout, { label: 'Name' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  view.rerender(createElement(Checkout, { label: 'Name', ...props }))
  await waitFor(() => expect(created.at(-1)?.appearance?.[key]).toBe(value))
  expect(destroy).toHaveBeenCalled()
})

it('passes the latest prepare function without remounting', async () => {
  const first = vi.fn(async () => 'first')
  const second = vi.fn(async () => 'second')
  function Prepared({ prepare }: { prepare: () => Promise<string> }) {
    hook = usePayment({ publishableKey: KEY, prepare })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(Prepared, { prepare: first }))
  await waitFor(() => expect(created).toHaveLength(1))
  view.rerender(createElement(Prepared, { prepare: second }))
  const prepare = created[0].prepare as () => Promise<string>
  await expect(prepare()).resolves.toBe('second')
  expect(first).not.toHaveBeenCalled()
  expect(created).toHaveLength(1)
})

it('forwards the payment endpoint shortcut', async () => {
  render(createElement(Checkout, { label: 'Name' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  await act(() => hook.submit('/api/payments').then(() => {}))
  expect(submit).toHaveBeenCalledWith('/api/payments')
})

it('uses a changed prepare URL for the next order and discards the previous secret', async () => {
  function Prepared({ prepare }: { prepare: string }) {
    hook = usePayment({ publishableKey: KEY, prepare, clientSecret: prepare.includes('/first/') ? 'previous-secret' : undefined })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(Prepared, { prepare: '/api/orders/first/payments' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  view.rerender(createElement(Prepared, { prepare: '/api/orders/second/payments' }))
  await waitFor(() => expect(created.at(-1)?.prepare).toBe('/api/orders/second/payments'))
  expect(created.at(-1)?.clientSecret).toBeUndefined()
  expect(destroy).toHaveBeenCalledOnce()
})

it('waits for an in-flight payment before switching prepare endpoints', async () => {
  function Prepared({ prepare }: { prepare: string }) {
    hook = usePayment({ publishableKey: KEY, prepare })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(Prepared, { prepare: '/api/first' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  act(() => created[0].onChange?.({ state: 'submitting', outcome: 'open', busy: true, canSubmit: false, complete: true }))
  view.rerender(createElement(Prepared, { prepare: '/api/second' }))
  expect(created).toHaveLength(1)
  expect(destroy).not.toHaveBeenCalled()
  act(() => created[0].onChange?.({ state: 'pending', outcome: 'pending', busy: false, canSubmit: false, complete: true }))
  await waitFor(() => expect(created.at(-1)?.prepare).toBe('/api/second'))
})

it('keeps the final result after the fields are replaced by a receipt', async () => {
  const view = render(createElement(Checkout, { label: 'Name' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  const secret = async () => 'secret'
  await act(() => hook.submit({ clientSecret: secret }).then(() => {}))
  expect(submit).toHaveBeenCalledWith({ clientSecret: secret })
  expect(view.getByText('Receipt')).toBeTruthy()
  expect(hook.snapshot.state).toBe('successful')
})

it('reports a load failure in the snapshot', async () => {
  vi.mocked(loadTapaya).mockRejectedValue(new Error('Tapaya.js could not load.'))
  render(createElement(Checkout, { label: 'Name' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await waitFor(() =>
    expect(hook.snapshot).toMatchObject({
      state: 'error',
      error: { code: 'unavailable', message: expect.stringContaining("Card payment isn't available") },
    }),
  )
})

it('forwards the method chosen by the merchant selector', async () => {
  function Selected({ paymentMethod }: { paymentMethod: 'card' | 'google_pay' }) {
    hook = usePayment({ publishableKey: KEY, paymentMethod })
    return createElement('div', { ref: hook.fieldRef })
  }
  const view = render(createElement(Selected, { paymentMethod: 'google_pay' }))
  await waitFor(() => expect(hook.snapshot.state).toBe('ready'))
  expect(created[0].paymentMethod).toBe('google_pay')
  view.rerender(createElement(Selected, { paymentMethod: 'card' }))
  await waitFor(() => expect(created.at(-1)?.paymentMethod).toBe('card'))
})
