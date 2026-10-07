---
title: "Use with React"
order: 4
---
This hook uses React's `useEffect` and `useState`, imported from `react`. `api` and `User` are from [Quick start](/start/quick-start/).

<!-- tested: react-effect -->
```ts
function useUser(id: string) {
  const [state, setState] = useState<{ user?: User; failed?: boolean }>({})

  useEffect(() => {
    const controller = new AbortController()
    api.getUser({ id }, { signal: controller.signal }).then(({ data, error }) => {
      if (error?.kind === 'abort') return // unmounted, or id changed
      setState(error ? { failed: true } : { user: data })
    })
    return () => controller.abort() // cancel when the component goes away
  }, [id])

  return state
}
```

Aborting on cleanup means a fast navigation never writes stale data into a component that has moved on.
