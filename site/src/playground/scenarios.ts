// The playground's tabs, in order. Each id names an example in ./examples/<id>.ts, and every
// hint is checked: tests/playground.test.ts runs the example and each variant a hint names.
export interface Scenario {
  id: 'quick-start' | 'errors' | 'search' | 'share' | 'retry' | 'graphql' | 'polling'
  label: string
  hint: string
}

export const SCENARIOS: Scenario[] = [
  { id: 'quick-start', label: 'Quick start', hint: "Change the id to '404', '500' or 'offline' and run it again. Hover over data or error to see the types." },
  { id: 'errors', label: 'Every failure', hint: 'Five ids, five outcomes, and none of them throws. error.kind tells you which failure it was.' },
  { id: 'search', label: 'Search as you type', hint: 'Set dedupe to false and run it again: the slow early answers land last and overwrite the right one.' },
  { id: 'share', label: 'Share', hint: 'One request in the network panel for five callers. Set share to false and compare.' },
  { id: 'retry', label: 'Retry', hint: 'Two 500s, then a 200. Lower the timeout to 600 and the one deadline stops the retries.' },
  { id: 'graphql', label: 'GraphQL', hint: "Change the id to '404' and the GraphQL error comes back in error.body, with error.partialData. '500' and 'slow' fail as they do over REST." },
  { id: 'polling', label: 'Polling', hint: "Four requests in the network panel, then the finished job. Set giveUpAfter to 600 and it gives up with a timeout; change the id to '404' and it stops at once." },
]
