// Bundlers resolve this file for browser builds, so the secret-key client never reaches a page.
throw new Error('@tapayadot/checkout is server-only. Import @tapayadot/checkout/client in browser code.')

export {}
