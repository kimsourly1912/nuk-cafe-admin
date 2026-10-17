# HTTP evidence — after-nuxt

Server: e2e build (`.output/server/index.mjs`), seed cafe `nuk`. Dynamic header values are masked.

## (a) unknown page under a cafe

`GET /c/nuk/definitely-not-a-page` → **404**

```
cache-control: no-cache
connection: keep-alive
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-type: text/html;charset=utf-8
cross-origin-opener-policy: same-origin
keep-alive: timeout=5
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
vary: accept, sec-fetch-mode
x-content-type-options: nosniff
x-frame-options: DENY
x-powered-by: Nuxt
x-request-id: <dynamic>
```

Body: non-JSON (text/html;charset=utf-8): title=Page not found · NUK Cafe, has __NUXT__ payload=true

## (b) unknown cafe API route

`GET /api/c/nuk/definitely-not-a-route` → **404**

```
cache-control: no-store
connection: keep-alive
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-type: application/json
cross-origin-opener-policy: same-origin
keep-alive: timeout=5
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
x-request-id: <dynamic>
```

Body: JSON shape: {"statusCode":"number","message":"string","data":{"code":"string","message":"string","requestId":"string"}}

## (c) unauthenticated admin API GET

`GET /api/c/nuk/admin/orders` → **401**

```
cache-control: no-store
connection: keep-alive
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-type: application/json
cross-origin-opener-policy: same-origin
keep-alive: timeout=5
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
x-request-id: <dynamic>
```

Body: JSON shape: {"statusCode":"number","message":"string","data":{"code":"string","message":"string","requestId":"string"}}

## (d) SSR redirect (server/middleware/30.old-addresses) with percent-encoded query

`GET /admin/orders?q=caf%C3%A9%20au%20lait&tag=a%26b&next=%2Ftable%2Fx%3Fy%3D1` → **302** Location: `/c/nuk/admin/orders?q=caf%C3%A9%20au%20lait&tag=a%26b&next=%2Ftable%2Fx%3Fy%3D1`

```
connection: keep-alive
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-type: text/html
cross-origin-opener-policy: same-origin
keep-alive: timeout=5
location: /c/nuk/admin/orders?q=caf%C3%A9%20au%20lait&tag=a%26b&next=%2Ftable%2Fx%3Fy%3D1
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
x-request-id: <dynamic>
```

Body: non-JSON (text/html): title=(none), has __NUXT__ payload=false

## (d2) admin page without a session (auth is a client-side redirect; no Location expected)

`GET /c/nuk/admin/orders?q=caf%C3%A9%20au%20lait&tag=a%26b&next=%2Ftable%2Fx%3Fy%3D1` → **200**

```
connection: keep-alive
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-type: text/html;charset=utf-8
cross-origin-opener-policy: same-origin
keep-alive: timeout=5
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
x-powered-by: Nuxt
x-request-id: <dynamic>
```

Body: non-JSON (text/html;charset=utf-8): title=NUK Cafe, has __NUXT__ payload=true

## (e) unknown table token

`GET /table/not-a-real-token` → **200**

```
connection: keep-alive
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
content-type: text/html;charset=utf-8
cross-origin-opener-policy: same-origin
keep-alive: timeout=5
permissions-policy: camera=(), microphone=(), geolocation=(), payment=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
x-powered-by: Nuxt
x-request-id: <dynamic>
```

Body: non-JSON (text/html;charset=utf-8): title=NUK Cafe, has __NUXT__ payload=true
