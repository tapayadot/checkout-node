import { useCallback, useEffect, useRef, useState } from 'react'
import { PaymentError, loadTapaya } from './index.js'
import type { LoadOptions, Payment, PaymentOptions, PaymentSnapshot, SubmitInput } from './index.js'

// Matches the hosted frame's default, for failures before the frame loads.
const UNAVAILABLE = "Card payment isn't available right now. Try again, or choose another payment method."

const initial: PaymentSnapshot = {
  state: 'unmounted',
  outcome: 'open',
  busy: false,
  canSubmit: false,
  complete: false,
}

export type UsePaymentOptions = PaymentOptions & LoadOptions & { publishableKey: string }

/**
 * Optional React binding. The host owns the form, method selector and submit button.
 * Pass `prepare` to resume on mount and pay with `submit()`. `clientSecret` is read when the
 * fields mount; pass a later one to `submit()`.
 */
export function usePayment(options: UsePaymentOptions | null) {
  const [revision, setRevision] = useState(0)
  const [container, fieldRef] = useState<HTMLElement | null>(null)
  const [snapshot, setSnapshot] = useState<PaymentSnapshot>(initial)
  const component = useRef<Payment | null>(null)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const publishableKey = options?.publishableKey
  const origin = options?.origin
  const apiOrigin = options?.apiOrigin
  const locale = options?.locale
  // Compare by value so inline objects do not remount or restyle the fields.
  const labels = JSON.stringify(options?.labels ?? null)
  const appearance = JSON.stringify(options?.appearance ?? null)
  // The provider places the brand icon only when its fields mount.
  const cardBrandIcon = options?.appearance?.cardBrandIcon
  const prepareEndpoint = typeof options?.prepare === 'string' ? options.prepare : undefined
  const activeSecret = useRef<{ identity: string; value: string } | null>(null)
  const [presentation, setPresentation] = useState({
    locale,
    labels,
    cardBrandIcon,
    prepareEndpoint,
  })
  const identity = JSON.stringify([publishableKey, origin, apiOrigin, presentation.prepareEndpoint])
  useEffect(() => {
    // Never remove a frame while it is tokenizing, challenging or confirming.
    if (snapshot.busy) return
    setPresentation((current) =>
      current.locale === locale && current.labels === labels && current.cardBrandIcon === cardBrandIcon && current.prepareEndpoint === prepareEndpoint
        ? current
        : { locale, labels, cardBrandIcon, prepareEndpoint },
    )
  }, [locale, labels, cardBrandIcon, prepareEndpoint, snapshot.busy])

  useEffect(() => {
    if (!publishableKey) {
      activeSecret.current = null
      setSnapshot(initial)
      return
    }
    // Removing the fields to show a receipt must preserve the final result.
    if (!container) return
    // When options arrive after an async lookup, wait for their presentation too.
    // Mounting once with the old labels would immediately remount and replay results.
    if (
      presentation.locale !== latest.current?.locale ||
      presentation.labels !== JSON.stringify(latest.current?.labels ?? null) ||
      presentation.cardBrandIcon !== latest.current?.appearance?.cardBrandIcon ||
      presentation.prepareEndpoint !== (typeof latest.current?.prepare === 'string' ? latest.current.prepare : undefined)
    )
      return
    let active = true
    let payment: Payment | undefined
    const fail = (error: unknown) => {
      if (!active) return
      // Developers get the cause; shoppers get the same message as a frame that failed.
      console.error('[tapaya] card payment unavailable', error)
      setSnapshot({
        ...initial,
        state: 'error',
        error: {
          code: 'unavailable',
          message: JSON.parse(presentation.labels)?.unavailable ?? UNAVAILABLE,
        },
      })
    }
    setSnapshot({ ...initial, state: 'loading', busy: true })
    loadTapaya(publishableKey, { origin, apiOrigin })
      .then((payments) => {
        if (!active) return
        payment = payments.createPayment({
          clientSecret:
            activeSecret.current?.identity === identity ? activeSecret.current.value : latest.current?.clientSecret,
          // Read the latest prepare option, so an inline function never remounts the fields.
          prepare:
            latest.current?.prepare === undefined
              ? undefined
              : typeof latest.current.prepare === 'string'
                ? latest.current.prepare
                : () => {
                    const prepare = latest.current?.prepare
                    if (typeof prepare !== 'function')
                      throw new PaymentError('configuration', 'The prepare option was removed.')
                    return prepare()
                  },
          locale: presentation.locale,
          labels: JSON.parse(presentation.labels) ?? undefined,
          appearance: latest.current?.appearance,
          onChange: (value) => {
            if (!active) return
            if (payment?.clientSecret) activeSecret.current = { identity, value: payment.clientSecret }
            setSnapshot(value)
            latest.current?.onChange?.(value)
          },
        })
        component.current = payment
        void payment.mount(container).catch(() => {
          // The payment publishes initialization and recovery errors in its snapshot.
        })
      })
      .catch(fail)
    return () => {
      active = false
      payment?.destroy()
      component.current = null
    }
  }, [container, publishableKey, origin, apiOrigin, identity, presentation, revision])
  // Restyle in place: remounting would clear what the shopper has typed.
  useEffect(() => {
    if (appearance !== 'null') component.current?.update({ appearance: JSON.parse(appearance) })
  }, [appearance])

  const submit = useCallback((submitOptions?: SubmitInput) => {
    if (!component.current) return Promise.reject(new PaymentError('not_mounted', 'Mount the payment fields first.'))
    return component.current.submit(submitOptions)
  }, [])
  const recover = useCallback(() => {
    if (!component.current) return Promise.reject(new PaymentError('not_mounted', 'Mount the payment fields first.'))
    return component.current.recover()
  }, [])
  const retryMount = useCallback(() => {
    const current = component.current?.snapshot
    if (
      current?.busy ||
      current?.state === 'pending' ||
      current?.state === 'action_required' ||
      current?.state === 'successful'
    )
      return
    activeSecret.current = null
    setRevision((value) => value + 1)
  }, [])
  return { fieldRef, snapshot, submit, recover, retryMount }
}
