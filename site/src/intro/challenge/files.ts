// Step 10's file: what the editor opens with, and the solution behind "Show a solution".
// docs:types compiles both against liaise (site/src/intro/files.ts).
export const FILE_NAME = 'unread.ts'
export const ENDPOINT = '/notifications/unread'
export const HEALTHY = '3 unread'
export const DOWN = 'Notifications are unavailable (http)'

export const SCAFFOLD = `import { createApi, defineRequest } from 'liaise'

// GET https://api.example.com/notifications/unread answers { unread: 3 }.

export async function unreadLabel(): Promise<string> {
  // Return '3 unread', or 'Notifications are unavailable (http)'
  // when the call fails, with the kind taken from error.kind.
  return ''
}
`

export const SOLUTION = `import { createApi, defineRequest } from 'liaise'

// GET /notifications/unread: how many are unread
const getUnread = defineRequest<{ unread: number }>()({
  method: 'GET',
  path: '/notifications/unread',
})

const api = createApi({
  baseUrl: 'https://api.example.com',
  requests: { getUnread },
})

export async function unreadLabel(): Promise<string> {
  const { data, error } = await api.getUnread()
  if (error) return \`Notifications are unavailable (\${error.kind})\`
  return \`\${data.unread} unread\`
}
`
