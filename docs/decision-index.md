# Decision index

History lookup only; do not read the full index or decisions log at startup. Search an ID or domain, then read that decision through the next `### D…` heading. Existing IDs and original headings are retained. Titles summarize choices made at the time, not current requirements. Read later follow-ups and the current task standards before changing a pattern.

## Domain entry points

| Domain | Search IDs / terms |
|---|---|
| Replaced Spring/SPA/SDK | D1–D5; superseded by D39, D43, D71, D95 |
| API/server architecture and integrity | D39–D45, D52, D71, D116; version, idempotency, guard, audit |
| App queries, mutations, sessions | D22, D28–D30, D97, D102, D142, D149–D153, D173 |
| UI and responsive workflows | D74–D90, D126–D129, D152, D165–D166 |
| Tenancy and permissions | D134–D146; organization, tenant, branch |
| Orders, payment and KHQR | D98–D106, D114–D115, D130–D132, D148, D156–D157 |
| Reports/Telegram/marketing | D110–D113, D157, D163–D164 |
| AI assistant | D107–D109 |
| Operations/tests/deploy | D42, D53–D54, D83, D103, D120–D123, D133, D147, D172, D174, D175, D176, D177 |
| Documentation loading | D167 |

## Entries by ID

Search first:

```bash
rg -n 'D135:|idempotency|tenant' docs/decision-index.md
rg -n '^### D135:|^### D136:' docs/decisions.md
```

The links below jump to headings in a viewer; an agent should use bounded file reads rather than loading the whole destination. Regenerate these rows from `### D<number>:` headings whenever a title or ID changes.

| ID | Decision title (historical) |
|---|---|
| [D1](decisions.md#d1-frontend-only-spa-ssr-false-2026-09-26) | Frontend-only SPA (`ssr: false`), 2026-09-26 |
| [D2](decisions.md#d2-dev-proxy-with-origin-rewrite-2026-09-26) | Dev proxy with `Origin` rewrite, 2026-09-26 |
| [D3](decisions.md#d3-hey-api-codegen-with-the-ofetch-client-2026-09-26) | Hey API codegen with the ofetch client, 2026-09-26 |
| [D4](decisions.md#d4-sdk-scope-and-naming-2026-09-26) | SDK scope and naming, 2026-09-26 |
| [D5](decisions.md#d5-api-wrapper-createapifetch-2026-09-26) | API wrapper `createApiFetch`, 2026-09-26 |
| [D6](decisions.md#d6-apierror-classification-2026-09-26) | `ApiError` classification, 2026-09-26 |
| [D7](decisions.md#d7-nuxt-native-state-and-data-fetching-2026-09-26) | Nuxt-native state and data fetching, 2026-09-26 |
| [D8](decisions.md#d8-feature-based-architecture-2026-09-26) | Feature-based architecture, 2026-09-26 |
| [D9](decisions.md#d9-feature-names-follow-backend-resources-2026-09-26) | Feature names follow backend resources, 2026-09-26 |
| [D10](decisions.md#d10-data-freshness-by-feature-prefixed-keys-2026-09-26) | Data freshness by feature-prefixed keys, 2026-09-26 |
| [D11](decisions.md#d11-usemutation-per-item-concurrency-and-shared-state-2026-09-26) | `useMutation`: per-item concurrency and shared state, 2026-09-26 |
| [D12](decisions.md#d12-batch-actions-run-client-side-2026-09-26) | Batch actions run client-side, 2026-09-26 |
| [D13](decisions.md#d13-form-modals-while-saving-2026-09-26) | Form modals while saving, 2026-09-26 |
| [D14](decisions.md#d14-form-schemas-are-handwritten-2026-09-26) | Form schemas are handwritten, 2026-09-26 |
| [D15](decisions.md#d15-tests-2026-09-26) | Tests, 2026-09-26 |
| [D16](decisions.md#d16-promote-shared-code-on-the-second-use-2026-09-26) | Promote shared code on the second use, 2026-09-26 |
| [D17](decisions.md#d17-english-only-ui-2026-09-26) | English-only UI, 2026-09-26 |
| [D18](decisions.md#d18-icons-are-bundled-into-the-client-2026-09-26) | Icons are bundled into the client, 2026-09-26 |
| [D19](decisions.md#d19-unsaved-changes-guard-2026-09-26) | Unsaved-changes guard, 2026-09-26 |
| [D20](decisions.md#d20-e2e-tests-build-once-and-mock-the-backend-in-the-browser-2026-09-26) | E2E tests build once and mock the backend in the browser, 2026-09-26 |
| [D21](decisions.md#d21-list-state-lives-in-the-url-updated-with-replace-2026-09-26) | List state lives in the URL, updated with `replace`, 2026-09-26 |
| [D22](decisions.md#d22-cross-tab-invalidation--refetch-stale-data-on-return-and-reconnect-not-polling-2026-09-26-amended-the-same-day) | Cross-tab invalidation + refetch stale data on return and reconnect, not polling, 2026-09-26 (amended the same day) |
| [D23](decisions.md#d23-tab-titles-from-route-meta-2026-09-26) | Tab titles from route meta, 2026-09-26 |
| [D24](decisions.md#d24-ci-with-github-actions-following-pnpms-recommended-setup-2026-09-26) | CI with GitHub Actions, following pnpm's recommended setup, 2026-09-26 |
| [D25](decisions.md#d25-keyboard-shortcuts-through-a-guarded-wrapper-2026-09-26) | Keyboard shortcuts through a guarded wrapper, 2026-09-26 |
| [D26](decisions.md#d26-loginlogout-across-tabs-and-a-safe-post-login-redirect-2026-09-26) | Login/logout across tabs, and a safe post-login redirect, 2026-09-26 |
| [D27](decisions.md#d27-bounded-refresh-no-hidden-retries-expire-once-per-identity-2026-09-26) | Bounded refresh, no hidden retries, expire once per identity, 2026-09-26 |
| [D28](decisions.md#d28-record-locks-across-mutations-prototype-free-state-records-2026-09-26) | Record locks across mutations; prototype-free state records, 2026-09-26 |
| [D29](decisions.md#d29-session-transition-contract-2026-09-26) | Session-transition contract, 2026-09-26 |
| [D30](decisions.md#d30-useapiquery-handles-watch-itself-with-cancel-semantics-2026-09-26) | `useApiQuery` handles `watch` itself, with cancel semantics, 2026-09-26 |
| [D31](decisions.md#d31-picker-display-vs-eligibility-no-blur-validation-in-the-category-form-2026-09-26) | Picker display vs eligibility; no blur validation in the Category form, 2026-09-26 |
| [D32](decisions.md#d32-unanswered-contracts-safest-encoding-verified-on-first-login-schedules-2026-09-26) | Unanswered contracts: safest encoding, verified on first login (Schedules), 2026-09-26 |
| [D33](decisions.md#d33-schedule-times-in-the-viewers-timezone-12-hour-2026-09-26) | Schedule times in the viewer's timezone, 12-hour, 2026-09-26 |
| [D34](decisions.md#d34-products-phase-1-slide-over-form-usd-variants-kept-pickers-forward-attributes-2026-09-26) | Products phase 1: slide-over form, USD, variants kept, pickers forward attributes, 2026-09-26 |
| [D35](decisions.md#d35-variant-editor-full-list--reply-check-drag-and-drop-with-a-keyboard-path-2026-09-26) | Variant editor: full list + reply check, drag and drop with a keyboard path, 2026-09-26 |
| [D36](decisions.md#d36-category-sort-order-one-type-whole-list-explicit-save-2026-09-26) | Category sort order: one type, whole list, explicit save, 2026-09-26 |
| [D37](decisions.md#d37-list-ui-refresh-layout-per-screen-categories-as-a-tree-shared-list-pieces-2026-09-26) | List UI refresh: layout per screen, Categories as a tree, shared list pieces, 2026-09-26 |
| [D38](decisions.md#d38-full-stack-target-and-new-data-model-2026-09-26) | Full stack target and new data model, 2026-09-26 |
| [D39](decisions.md#d39-remove-the-external-api-integration-before-building-the-new-api-2026-09-26) | Remove the external API integration before building the new API, 2026-09-26 |
| [D40](decisions.md#d40-our-own-api-identity-access-errors-ids-2026-09-26) | Our own API: identity, access, errors, ids, 2026-09-26 |
| [D41](decisions.md#d41-menu-api-contract-2026-09-26) | Menu API contract, 2026-09-26 |
| [D42](decisions.md#d42-tests-for-the-full-stack-2026-09-26) | Tests for the full stack, 2026-09-26 |
| [D43](decisions.md#d43-server-standard-rebuilt-from-scratch-2026-09-27) | Server standard, rebuilt from scratch, 2026-09-27 |
| [D44](decisions.md#d44-menu-model-option-sets-add-on-groups-two-level-categories-2026-09-27) | Menu model: option sets, add-on groups, two-level categories, 2026-09-27 |
| [D45](decisions.md#d45-business-rules-for-launch-2026-09-27) | Business rules for launch, 2026-09-27 |
| [D46](decisions.md#d46-server-skeleton-step-11-2026-09-27) | Server skeleton (step 1.1), 2026-09-27 |
| [D47](decisions.md#d47-identity-configuration-step-12-2026-09-27) | Identity configuration (step 1.2), 2026-09-27 |
| [D48](decisions.md#d48-access-helpers-and-security-headers-step-13-2026-09-27) | Access helpers and security headers (step 1.3), 2026-09-27 |
| [D49](decisions.md#d49-staff-management-and-the-seed-task-step-14-2026-09-27) | Staff management and the seed task (step 1.4), 2026-09-27 |
| [D50](decisions.md#d50-platform-tables-audit-idempotency-outbox-step-15-2026-09-27) | Platform tables: audit, idempotency, outbox (step 1.5), 2026-09-27 |
| [D51](decisions.md#d51-customer-accounts-account-emails-and-customer-profiles-step-16-2026-09-27) | Customer accounts, account emails and customer profiles (step 1.6), 2026-09-27 |
| [D52](decisions.md#d52-the-admin-app-on-the-new-identity-step-17-2026-09-27) | The admin app on the new identity (step 1.7), 2026-09-27 |
| [D53](decisions.md#d53-cloudflare-staging-step-21-2026-09-27) | Cloudflare staging (step 2.1), 2026-09-27 |
| [D54](decisions.md#d54-ci-deploy-to-staging-step-22-2026-09-27) | CI deploy to staging (step 2.2), 2026-09-27 |
| [D55](decisions.md#d55-menu-categories-api-step-31-2026-09-27) | Menu categories API (step 3.1), 2026-09-27 |
| [D56](decisions.md#d56-parallel-e2e-shards-in-ci-2026-09-27) | Parallel e2e shards in CI, 2026-09-27 |
| [D57](decisions.md#d57-media-uploads-step-32-2026-09-27) | Media uploads (step 3.2), 2026-09-27 |
| [D58](decisions.md#d58-options-library-api-step-33-2026-09-27) | Options library API (step 3.3), 2026-09-27 |
| [D59](decisions.md#d59-add-ons-library-api-step-34-2026-09-27) | Add-ons library API (step 3.4), 2026-09-27 |
| [D60](decisions.md#d60-menu-items-and-the-price-grid-step-35a-2026-09-27) | Menu items and the price grid (step 3.5a), 2026-09-27 |
| [D61](decisions.md#d61-add-ons-on-items-step-35b-2026-09-27) | Add-ons on items (step 3.5b), 2026-09-27 |
| [D62](decisions.md#d62-d1s-limit-of-100-parameters-per-statement-2026-09-27) | D1's limit of 100 parameters per statement, 2026-09-27 |
| [D63](decisions.md#d63-availability-rules-step-37-2026-09-27) | Availability rules (step 3.7), 2026-09-27 |
| [D64](decisions.md#d64-sold-out-per-branch-step-36-2026-09-27) | Sold out per branch (step 3.6), 2026-09-27 |
| [D65](decisions.md#d65-the-public-menu-no-cache-yet-step-38a-2026-09-27) | The public menu, no cache yet (step 3.8a), 2026-09-27 |
| [D66](decisions.md#d66-moving-the-admin-screens-onto-the-new-api-step-38b-and-the-availability-page-part-1-2026-09-27) | Moving the admin screens onto the new API (step 3.8b), and the Availability page (part 1), 2026-09-27 |
| [D67](decisions.md#d67-the-options-page-step-38b-part-2a-2026-09-27) | The Options page (step 3.8b, part 2a), 2026-09-27 |
| [D68](decisions.md#d68-the-add-ons-page-step-38b-part-2b-2026-09-28) | The Add-ons page (step 3.8b, part 2b), 2026-09-28 |
| [D69](decisions.md#d69-categories-on-the-new-api-step-38b-part-3a-2026-09-28) | Categories on the new API (step 3.8b, part 3a), 2026-09-28 |
| [D70](decisions.md#d70-menu-items-on-the-new-api-step-38b-part-3b-2026-09-28) | Menu items on the new API (step 3.8b, part 3b), 2026-09-28 |
| [D71](decisions.md#d71-the-legacy-menu-removed-step-38b-part-3c-2026-09-28) | The legacy menu removed (step 3.8b, part 3c), 2026-09-28 |
| [D72](decisions.md#d72-the-categories-page-redesign-2026-09-28) | The Categories page redesign, 2026-09-28 |
| [D73](decisions.md#d73-the-options-page-and-option-set-editor-redesign-2026-09-28) | The Options page and option-set editor redesign, 2026-09-28 |
| [D74](decisions.md#d74-design-system-first-categories-and-options-back-on-nuxt-ui-defaults-2026-09-28) | Design system first: Categories and Options back on Nuxt UI defaults, 2026-09-28 |
| [D75](decisions.md#d75-the-add-ons-library-and-the-add-on-group-page-2026-09-28) | The Add-ons library and the add-on group page, 2026-09-28 |
| [D76](decisions.md#d76-the-availability-page-as-a-weekly-agenda-2026-09-28) | The Availability page as a weekly agenda, 2026-09-28 |
| [D77](decisions.md#d77-responsive-ui-standard-documentation-2026-09-28) | Responsive UI standard (documentation), 2026-09-28 |
| [D78](decisions.md#d78-ui-foundations-phase-b-step-1-2026-09-28) | UI foundations (Phase B step 1), 2026-09-28 |
| [D79](decisions.md#d79-staff-on-the-ui-standard-phase-b-step-2-2026-09-28) | Staff on the UI standard (Phase B step 2), 2026-09-28 |
| [D80](decisions.md#d80-light-mode-warning-contrast-2026-09-28) | Light-mode warning contrast, 2026-09-28 |
| [D81](decisions.md#d81-nuxt-uis-default-control-sizes-on-phones-2026-09-28) | Nuxt UI's default control sizes on phones, 2026-09-28 |
| [D82](decisions.md#d82-the-add-on-group-page-on-the-ui-standard-phase-b-step-3-2026-09-28) | The Add-on group page on the UI standard (Phase B step 3), 2026-09-28 |
| [D83](decisions.md#d83-a-faster-check-workflow-with-the-same-gates-2026-09-28) | A faster check workflow with the same gates, 2026-09-28 |
| [D84](decisions.md#d84-sign-in-and-change-password-as-task-flows-phase-b-step-4-2026-09-28) | Sign-in and change-password as task flows (Phase B step 4), 2026-09-28 |
| [D85](decisions.md#d85-categories-on-the-ui-standard-phase-b-step-5a-2026-09-28) | Categories on the UI standard (Phase B step 5a), 2026-09-28 |
| [D86](decisions.md#d86-options-on-the-ui-standard-phase-b-step-5b-2026-09-28) | Options on the UI standard (Phase B step 5b), 2026-09-28 |
| [D87](decisions.md#d87-availability-on-the-ui-standard-phase-b-step-5c-2026-09-28) | Availability on the UI standard (Phase B step 5c), 2026-09-28 |
| [D88](decisions.md#d88-the-add-ons-library-on-the-ui-standard-phase-b-step-5d-2026-09-28) | The Add-ons library on the UI standard (Phase B step 5d), 2026-09-28 |
| [D89](decisions.md#d89-the-menu-items-list-on-the-ui-standard-phase-b-step-5e-part-1-2026-09-28) | The Menu items list on the UI standard (Phase B step 5e, part 1), 2026-09-28 |
| [D90](decisions.md#d90-the-menu-item-editor-route-phase-b-step-5e-part-2-2026-09-28) | The Menu item editor route (Phase B step 5e, part 2), 2026-09-28 |
| [D91](decisions.md#d91-branch-settings-and-dining-tables-on-the-server-step-51a-2026-09-29) | Branch settings and dining tables on the server (step 5.1a), 2026-09-29 |
| [D92](decisions.md#d92-the-branch-pages-step-51b-2026-09-29) | The Branch pages (step 5.1b), 2026-09-29 |
| [D93](decisions.md#d93-the-customer-menu-and-the-admin-workspace-under-admin-step-53a-2026-09-29) | The customer menu, and the admin workspace under `/admin` (step 5.3a), 2026-09-29 |
| [D94](decisions.md#d94-the-sample-data-page-test-data-from-the-admin-2026-09-29) | The Sample data page (test data from the admin), 2026-09-29 |
| [D95](decisions.md#d95-server-rendering-for-the-customer-site-q38-2026-09-29) | Server rendering for the customer site (Q38), 2026-09-29 |
| [D96](decisions.md#d96-light-and-dark-mode-light-by-default-2026-09-29) | Light and dark mode, light by default, 2026-09-29 |
| [D97](decisions.md#d97-the-customers-account-pages-step-52-2026-09-29) | The customer's account pages (step 5.2), 2026-09-29 |
| [D98](decisions.md#d98-pricing-and-the-checkout-quote-step-61-2026-09-29) | Pricing and the checkout quote (step 6.1), 2026-09-29 |
| [D99](decisions.md#d99-placing-an-order-step-62a-server-2026-09-29) | Placing an order (step 6.2a, server), 2026-09-29 |
| [D100](decisions.md#d100-review-order-and-the-order-placed-step-62b-the-pages-2026-09-29) | Review order and the order placed (step 6.2b, the pages), 2026-09-29 |
| [D101](decisions.md#d101-the-counter-on-the-server-queue-payment-and-actions-step-63a-2026-09-29) | The counter on the server: queue, payment and actions (step 6.3a), 2026-09-29 |
| [D102](decisions.md#d102-the-counter-app-and-the-payments-page-step-63b-2026-09-29) | The counter app and the Payments page (step 6.3b), 2026-09-29 |
| [D103](decisions.md#d103-rate-limits-per-real-client-address-and-sqlite-waits-for-a-lock-found-in-ci-on-step-63b-2026-09-29) | Rate limits per real client address, and SQLite waits for a lock (found in CI on step 6.3b), 2026-09-29 |
| [D104](decisions.md#d104-unpaid-orders-cancelled-after-30-minutes-step-66-2026-09-30) | Unpaid orders cancelled after 30 minutes (step 6.6), 2026-09-30 |
| [D105](decisions.md#d105-the-counters-sold-out-page-step-63c-2026-09-30) | The counter's Sold out page (step 6.3c), 2026-09-30 |
| [D106](decisions.md#d106-order-tracking-on-the-server-step-65a-2026-09-30) | Order tracking on the server (step 6.5a), 2026-09-30 |
| [D107](decisions.md#d107-an-ai-assistant-for-admins-on-any-provider-phase-9-plan-2026-09-30) | An AI assistant for admins, on any provider (phase 9 plan), 2026-09-30 |
| [D108](decisions.md#d108-the-ai-assistants-groundwork-step-90-2026-09-30) | The AI assistant's groundwork (step 9.0), 2026-09-30 |
| [D109](decisions.md#d109-the-help-assistant-step-91-2026-09-30) | The help assistant (step 9.1), 2026-09-30 |
| [D110](decisions.md#d110-reports-on-the-server-step-81a-2026-09-30) | Reports on the server (step 8.1a), 2026-09-30 |
| [D111](decisions.md#d111-the-report-pages-csv-and-print-step-81b-2026-09-30) | The report pages, CSV and Print (step 8.1b), 2026-09-30 |
| [D112](decisions.md#d112-telegram-connection-and-send-to-telegram-step-81c-2026-09-30) | Telegram connection and Send to Telegram (step 8.1c), 2026-09-30 |
| [D113](decisions.md#d113-new-order-and-payment-alerts-the-closing-summary-and-the-delivery-history-step-81d-2026-09-30) | New-order and payment alerts, the closing summary and the delivery history (step 8.1d), 2026-09-30 |
| [D114](decisions.md#d114-order-tracking-pages-polled-live-pushes-planned-for-later-step-65b-2026-09-30) | Order tracking pages, polled; live pushes planned for later (step 6.5b), 2026-09-30 |
| [D115](decisions.md#d115-points-and-vouchers-deferred-launch-essentials-first-an-admin-resets-a-staff-password-step-101-2026-09-30) | Points and vouchers deferred; launch essentials first; an admin resets a staff password (step 10.1), 2026-09-30 |
| [D116](decisions.md#d116-consistent-nuxt-server-import-aliases-2026-10-01) | Consistent Nuxt server import aliases, 2026-10-01 |
| [D117](decisions.md#d117-the-counters-finished-orders-today-step-102-2026-09-30) | The counter's finished orders today (step 10.2), 2026-09-30 |
| [D118](decisions.md#d118-reorder-menu-items-within-a-category-step-103-2026-09-30) | Reorder menu items within a category (step 10.3), 2026-09-30 |
| [D119](decisions.md#d119-server-error-alerts-on-telegram-and-the-restore-drill-runbook-step-104-2026-09-30) | Server error alerts on Telegram and the restore drill runbook (step 10.4), 2026-09-30 |
| [D120](decisions.md#d120-the-release-check-step-105-2026-10-01) | The release check (step 10.5), 2026-10-01 |
| [D121](decisions.md#d121-rate-limits-on-the-public-api-without-a-domain-step-106-2026-10-01) | Rate limits on the public API without a domain (step 10.6), 2026-10-01 |
| [D122](decisions.md#d122-load-speed-for-customers-the-menu-page-cached-photos-made-smaller-step-107-2026-10-01) | Load speed for customers: the menu page cached, photos made smaller (step 10.7), 2026-10-01 |
| [D123](decisions.md#d123-the-customer-menu-stops-loading-the-admins-calendar-step-108-2026-10-01) | The customer menu stops loading the admin's calendar (step 10.8), 2026-10-01 |
| [D124](decisions.md#d124-the-customer-menu-revised-the-header-at-every-width-the-order-always-in-reach-staff-links-step-109-2026-10-01) | The customer menu revised: the header at every width, the order always in reach, staff links (step 10.9), 2026-10-01 |
| [D125](decisions.md#d125-publish-from-the-item-form-and-bulk-publish-step-1010-2026-10-02) | Publish from the item form, and bulk Publish (step 10.10), 2026-10-02 |
| [D126](decisions.md#d126-ui-polish-the-page-width-sheets-without-dragging-the-period-picker-searchable-dropdowns-surfaces-step-1011-2026-10-02) | UI polish: the page width, sheets without dragging, the period picker, searchable dropdowns, surfaces (step 10.11), 2026-10-02 |
| [D127](decisions.md#d127-phone-numbers-a-country-with-the-number-e164-on-the-wire-libphonenumber-on-both-sides-step-1012-2026-10-02) | Phone numbers: a country with the number, E.164 on the wire, libphonenumber on both sides (step 10.12), 2026-10-02 |
| [D128](decisions.md#d128-tabs-that-scroll-one-pager-one-quantity-stepper-the-order-line-card-step-1013-2026-10-02) | Tabs that scroll, one pager, one quantity stepper, the order line card (step 10.13), 2026-10-02 |
| [D129](decisions.md#d129-list-toolbars-at-every-width-modes-as-toggles-the-bulk-bar-on-phones-step-1014-2026-10-02) | List toolbars at every width, modes as toggles, the bulk bar on phones (step 10.14), 2026-10-02 |
| [D130](decisions.md#d130-khqr-at-the-counter-a-qr-per-order-confirmed-by-the-cashier-step-1015a-2026-10-02) | KHQR at the counter: a QR per order, confirmed by the cashier (step 10.15a), 2026-10-02 |
| [D131](decisions.md#d131-khqr-checked-with-bakong-the-counter-records-a-paid-qr-by-itself-step-1015b-2026-10-02) | KHQR checked with Bakong: the counter records a paid QR by itself (step 10.15b), 2026-10-02 |
| [D132](decisions.md#d132-the-bakong-tokens-expiry-on-payments-and-reminders-on-telegram-step-1016-2026-10-02) | The Bakong token's expiry on Payments and reminders on Telegram (step 10.16), 2026-10-02 |
| [D133](decisions.md#d133-a-merge-to-main-deploys-without-running-the-checks-again-2026-10-02) | A merge to main deploys without running the checks again, 2026-10-02 |
| [D134](decisions.md#d134-multi-tenant-saas-ready-a-tenant-per-cafe-paths-on-one-domain-organization--tenant-phase-t-t0-2026-10-02) | Multi-tenant (SaaS-ready): a tenant per cafe, paths on one domain, organization = tenant (phase T, T0), 2026-10-02 |
| [D135](decisions.md#d135-tenancy-core-organization--tenant-our-own-branches-and-branch-staff-the-migration-step-t11-2026-10-02) | Tenancy core: organization = tenant, our own branches and branch staff, the migration (step T1.1), 2026-10-02 |
| [D136](decisions.md#d136-the-menu-and-its-uploads-per-tenant-step-t12-2026-10-03) | The menu and its uploads per tenant (step T1.2), 2026-10-03 |
| [D137](decisions.md#d137-orders-customer-profiles-the-khqr-settings-and-the-riel-rate-per-tenant-step-t13-2026-10-03) | Orders, customer profiles, the KHQR settings and the riel rate per tenant (step T1.3), 2026-10-03 |
| [D138](decisions.md#d138-telegram-and-notifications-per-tenant-the-outbox-names-its-tenant-step-t14a-2026-10-03) | Telegram and notifications per tenant; the outbox names its tenant (step T1.4a), 2026-10-03 |
| [D139](decisions.md#d139-audit-idempotency-the-assistants-usage-and-sample-data-per-tenant-reports-isolation-tested-step-t14b-2026-10-03) | Audit, idempotency, the assistant's usage and sample data per tenant; reports' isolation tested (step T1.4b), 2026-10-03 |
| [D140](decisions.md#d140-each-cafes-api-under-its-address-apicslug-step-t15a-2026-10-03) | Each cafe's API under its address, `/api/c/<slug>/…` (step T1.5a), 2026-10-03 |
| [D141](decisions.md#d141-each-cafes-pages-under-its-address-cslug-step-t15b-2026-10-03) | Each cafe's pages under its address, `/c/<slug>/…` (step T1.5b), 2026-10-03 |
| [D142](decisions.md#d142-the-platform-console-cafes-their-first-owner-pause-and-resume-change-of-address-step-t2a-2026-10-03) | The platform console: cafes, their first owner, pause and resume, change of address (step T2a), 2026-10-03 |
| [D143](decisions.md#d143-each-cafes-own-name-and-logo-and-its-not-found-and-paused-pages-step-t2b-2026-10-03) | Each cafe's own name and logo, and its not-found and paused pages (step T2b), 2026-10-03 |
| [D144](decisions.md#d144-your-cafes-and-the-cafe-switcher-step-t2c-2026-10-03) | Your cafes and the cafe switcher (step T2c), 2026-10-03 |
| [D145](decisions.md#d145-the-cafe-menu-in-the-sidebar-view-menu-and-an-items-address-on-the-menu-2026-10-03) | The cafe menu in the sidebar, View menu and an item's address on the menu, 2026-10-03 |
| [D146](decisions.md#d146-new-cafe-for-an-existing-owner-2026-10-08) | New cafe for an existing owner, 2026-10-08 |
| [D147](decisions.md#d147-the-builds-heap-set-to-4-gb-in-ci-2026-10-09) | The build's heap set to 4 GB in CI, 2026-10-09 |
| [D148](decisions.md#d148-each-cafes-own-bakong-token-sealed-in-the-database-t2d-2026-10-09) | Each cafe's own Bakong token, sealed in the database (T2d), 2026-10-09 |
| [D149](decisions.md#d149-the-reliability-pack-the-screen-kept-on-a-new-version-offered-the-queues-last-update-its-tab-count-browser-errors-reported-2026-10-10) | The reliability pack: the screen kept on, a new version offered, the queue's last update, its tab count, browser errors reported, 2026-10-10 |
| [D150](decisions.md#d150-reliability-pack-2-alerts-sent-at-once-screens-that-keep-their-data-the-counters-sound-and-stale-warning-failed-jobs-alerted-2026-10-10) | Reliability pack 2: alerts sent at once, screens that keep their data, the counter's sound and stale warning, failed jobs alerted, 2026-10-10 |
| [D151](decisions.md#d151-drafts-kept-in-the-browser-unsaved-input-offered-back-after-a-crash-or-a-lost-session-2026-10-10) | Drafts kept in the browser: unsaved input offered back after a crash or a lost session, 2026-10-10 |
| [D152](decisions.md#d152-the-ux-pack-undo-instead-of-asking-ctrlk-search-a-sold-out-switch-that-moves-at-once-an-accessibility-check-2026-10-10) | The UX pack: Undo instead of asking, Ctrl/⌘+K search, a sold-out switch that moves at once, an accessibility check, 2026-10-10 |
| [D153](decisions.md#d153-someone-else-saved-first-reload-keeps-your-input-on-top-part-by-part-2026-10-10) | Someone else saved first: Reload keeps your input on top, part by part, 2026-10-10 |
| [D154](decisions.md#d154-duplicate-a-menu-item-2026-10-10) | Duplicate a menu item, 2026-10-10 |
| [D155](decisions.md#d155-the-admins-home-page-today-set-up-your-cafe-shortcuts-2026-10-10) | The admin's home page: today, "Set up your cafe", shortcuts, 2026-10-10 |
| [D156](decisions.md#d156-customers-order-without-an-account-guests-and-without-verifying-their-email-2026-10-10) | Customers order without an account (guests), and without verifying their email, 2026-10-10 |
| [D157](decisions.md#d157-your-order-is-ready-on-telegram-for-customers-2026-10-10) | "Your order is ready" on Telegram, for customers, 2026-10-10 |
| [D158](decisions.md#d158-menu-photos-a-photo-editor-a-square-and-a-43-file-blurred-placeholders-2026-10-10) | Menu photos: a photo editor, a square and a 4:3 file, blurred placeholders, 2026-10-10 |
| [D159](decisions.md#d159-a-menu-photo-uploads-in-the-form-not-in-the-editor-2026-10-11) | A menu photo uploads in the form, not in the editor, 2026-10-11 |
| [D160](decisions.md#d160-photos-unsaved-while-uploading-big-photos-opened-smaller-and-the-items-without-one-2026-10-11) | Photos: unsaved while uploading, big photos opened smaller, and the items without one, 2026-10-11 |
| [D161](decisions.md#d161-the-photo-editor-frames-each-view-like-a-crop-rotate-turns-at-once-2026-10-11) | The photo editor frames each view like a crop; Rotate turns at once, 2026-10-11 |
| [D162](decisions.md#d162-the-photo-editors-layout-from-the-owners-mockup-2026-10-11) | The photo editor's layout, from the owner's mockup, 2026-10-11 |
| [D163](decisions.md#d163-promotions-a-discount-on-the-menu-the-checkout-and-the-order-with-an-uploaded-poster-2026-10-11) | Promotions: a discount on the menu, the checkout and the order, with an uploaded poster, 2026-10-11 |
| [D164](decisions.md#d164-promotions-posted-to-the-cafes-telegram-channel-with-orders-counted-per-channel-2026-10-11) | Promotions posted to the cafe's Telegram channel, with orders counted per channel, 2026-10-11 |
| [D165](decisions.md#d165-ui-fixes-the-order-drawers-scrollbar-reorder-chevrons-that-slide-ampm-by-a-tap-each-pre-selected-box-its-own-2026-10-13) | UI fixes: the order drawer's scrollbar, reorder chevrons that slide, AM/PM by a tap, each Pre-selected box its own, 2026-10-13 |
| [D166](decisions.md#d166-errors-that-leave-when-fixed-preselected-without-waiting-drawer-padding-a-black-backdrop-and-the-expected-ui-behavior-written-down-2026-10-13) | Errors that leave when fixed, Preselected without waiting, drawer padding, a black backdrop, and the expected UI behavior written down, 2026-10-13 |
| [D167](decisions.md#d167-task-based-agent-documentation-loading-2026-10-13) | Task-based agent documentation loading, 2026-10-13 |
| [D168](decisions.md#d168-architecture-reliability-bounded-requests-owned-delivery-and-durable-cleanup-2026-10-14) | Architecture reliability: bounded requests, owned delivery and durable cleanup, 2026-10-14 |
| [D169](decisions.md#d169-server-log-privacy-fresh-catalog-reads-and-successful-job-health-2026-10-14) | Server log privacy, fresh catalog reads and successful-job health, 2026-10-14 |
| [D170](decisions.md#d170-tenant-scoped-admin-pricing-and-fresh-counter-batches-2026-10-14) | Tenant-scoped admin pricing and fresh counter batches, 2026-10-14 |
| [D171](decisions.md#d171-errors-of-a-removed-or-moved-row-follow-the-row-2026-10-16) | Errors of a removed or moved row follow the row, 2026-10-16 |
| [D172](decisions.md#d172-faster-and-reliable-local-checks-2026-10-17) | Faster and reliable local checks, 2026-10-17 |
| [D173](decisions.md#d173-reference-data-kept-between-visits-a-querys-first-fetch-joins-a-running-one-2026-10-17) | Reference data kept between visits; a query's first fetch joins a running one, 2026-10-17 |
| [D174](decisions.md#d174-the-server-tests-database-is-built-once-per-run-2026-10-18) | The server tests' database is built once per run, 2026-10-18 |
| [D175](decisions.md#d175-heavy-server-tests-tagged-slow-quick-test-commands-for-the-inner-loop-2026-10-18) | Heavy server tests tagged `slow`; quick test commands for the inner loop, 2026-10-18 |
| [D176](decisions.md#d176-every-server-test-database-is-closed-2026-10-18) | Every server-test database is closed, 2026-10-18 |
| [D177](decisions.md#d177-the-local-e2e-build-leaves-dependencies-untraced-2026-10-18) | The local e2e build leaves dependencies untraced, 2026-10-18 |
