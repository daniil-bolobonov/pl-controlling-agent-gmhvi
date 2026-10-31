## Testing CAP Applications

### Basic Setup

First, scaffold the test files by running:

```sh
cds add test
```

Replace then the test scaffolds with the actual test code. 

Rules:
- Call `cds.test()` **once per file**, at the top level, before any `describe` or `it` blocks
- `cds.test()` must be the first CDS call within the file, never load `cds.env` before `cds.test()`
- Write isolated test cases by preparing the use case with CQL, **never** rely on existing data
- Always use `cds.utils.uuid()` to generate UUIDs, **never** invent some UUIDs
- Never use `test.data.reset` to reset data, write isolated tests
- Use ESM `import` syntax — the project is configured with `"type": "module"`
- Use `node:assert` for assertions (strict mode) or the `expect` from `cds.test`
- Place test files in `test/` with the `.test.js` extension

### Testing Custom Logic with CQL

Since `cds.test()` runs the server in-process, you can access services programmatically using CQL. Only test custom handler logic, **never** test generic CRUD that CAP handles out of the box.

- `srv.run(query)` — sends CQL through the application service, triggering all `on`/`before`/`after` handlers
- `await query` — bypasses handlers and calls the database directly (useful for seeding test data)

```js
import cds from '@sap/cds'
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

const { expect } = cds.test(import.meta.dirname + '/..')

let srv, Books, Orders

describe('BookShopService Testing', () => {
  before(async () => {
    // `before` must be nested inside `describe`. A top-level `before`
    // runs before `cds.test()`'s bootstrap has fully populated
    // `cds.services`, causing `cds.connect.to(...)` to fail with
    // "Didn't find a configuration for 'cds.requires.<Service>'".
    srv = await cds.connect.to('CatalogService')
    Books = srv.entities.Books
    Orders = srv.entities.Orders
  })

  it('should reject orders that exceed stock', async () => {
    // Seed a book with limited stock directly in the db (bypasses handlers)
    const ID = cds.utils.uuid()
    await INSERT.into(Books).entries({ ID, title: 'Limited Edition', stock: 2 })

    // Order through the service — custom before handler should reject
    const orderQuery = INSERT.into(Orders).entries({ book_ID: ID, quantity: 5 })
    await assert.rejects(
      () => srv.run(orderQuery),
      (err) => /stock/i.test(err.message)
    )
  })

  it('should reduce stock after calling submitOrder action', async () => {
    const ID = cds.utils.uuid()
    await INSERT.into(Books).entries({ ID, title: 'CAP Guide', stock: 10 })

    await srv.send('submitOrder', { book: ID, quantity: 3 })

    const book = await srv.run(SELECT.one.from(Books).where({ ID }))
    assert.strictEqual(book.stock, 7)
  })
})
```

### Running the Tests

- Always run tests with `npm test`.
- Never run `node --test` directly — it bypasses `c8`, the custom reporter, and `write-test-report.mjs`, so `test_report.json` will not be produced.
- If `npm test` fails, fix the npm script or the test code first. Do not work around the problem by invoking `node --test` manually.
- A full `npm test` run writes `test_report.json` at the project root via the custom reporter and post-step script installed by `project-init.sh`. Verify that the file exists after the run. If it does not, rerun `npm test` without filters.
- The test command uses `c8` for code coverage (outputs to `coverage/`) and the Node.js native test runner (`node --test`). Coverage is merged into the report in a post-step after `c8` finishes writing.
