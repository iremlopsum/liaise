---
title: "The problem it solves"
order: 1
---
`fetch` is a good building block. Every project still ends up writing the same few things around it, and they are easy to get subtly wrong.

| With plain fetch | liaise | See |
| ---------------- | ------ | --- |
| Typing fast in a search box shows old results. A slow early search lands last. | `dedupe` cancels the older call. | [Stale requests](/guide/cancelling-deadlines-and-stale-requests/#drop-stale-calls-with-dedupe) |
| Five components load the same data, or five 401s each refresh the token. That's five identical requests. | `share` sends one and hands everyone the answer. | [Sharing identical requests](/guide/sharing-identical-requests/) |
| A 500 counts as success, offline throws, a hung server waits forever. | Every call returns `{ data, error }`, and `error.kind` names the failure. With `timeout` set, a hung server becomes an error too. | [Handling errors](/guide/handling-errors/) |
| Retries run straight past your timeout. | `timeout` covers the whole operation, retries included. | [Deadlines](/guide/cancelling-deadlines-and-stale-requests/#set-a-deadline-with-timeout) |
| The backend changes a field and the page crashes three components later. | A schema checks the response. A bad shape is an error you handle. | [Validating responses](/guide/validating-responses/) |

## Before and after

Here is one form submit, written both ways. `show` stands for whatever puts a message on screen.

**With plain fetch**

```ts
try {
  const res = await fetch('/api/orders', { method: 'POST', body: JSON.stringify(order) })
  show(`Order ${(await res.json()).id} confirmed`) // a 500 lands here too
} catch {
  show('Something went wrong') // offline? broken JSON? no way to tell
}
```

**With liaise**

<!-- tested: problem-after -->
```ts
async function submit(order: { items: string[] }) {
  const { data, error } = await api.placeOrder(order)
  if (!error) return show(`Order ${data.id} confirmed`)

  switch (error.kind) {
    case 'http':    return show(`The server said no (${error.status})`)
    case 'network': return show("You're offline. We'll try again.")
    case 'timeout': return show('This is taking too long. Try again.')
    case 'parse':   return show('The server sent something unexpected.')
  }
}
```

`api.placeOrder` is an endpoint defined like the ones in [Quick start](/start/quick-start/), with `timeout: 5000` so a hung server gives up after five seconds.

The `switch` leaves out `'abort'`, because nothing here cancels a call, and `'middleware'`, which points at a bug in your own code ([all six kinds](/guide/handling-errors/)).

## Why another API client?

Without it, you have two options. You can hand-roll a wrapper around fetch, which means writing the same boilerplate on every project: a typed function per endpoint, status checks, error handling, retries, cancellation.

Or you can reach for a large library like Apollo or urql. They're built for very large apps with complex data needs. For most products, that's bringing a tank to a chess match, and you spend hours on setup and configuration for features you never use.

liaise sits in between. It's the wrapper you'd otherwise hand-roll, already written and tested. Your whole setup is a base URL and your endpoints.

**The API client you'd build on your third project, with the edge cases already handled.**
