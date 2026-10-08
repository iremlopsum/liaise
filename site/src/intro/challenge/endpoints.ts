// What the API docs drawer at step 10 lists: the site's fake API (playground/fake-server.ts), the
// same server /playground/ uses. intro-challenge.test.ts sends every example and compares the answer.
import { SLOW_MS } from '../../playground/fake-server'

export interface Endpoint {
  method: 'GET'
  path: string
  what: string
  params: Array<[string, string]>
  returns: string
  example: { request: string; status: number; body: string }
  errors?: string
  /** The endpoint the challenge asks for. */
  challenge?: boolean
}

export const ENDPOINTS: Endpoint[] = [
  {
    method: 'GET', path: '/notifications/unread', what: 'How many notifications are unread.', challenge: true,
    params: [], returns: '{ unread: number }',
    example: { request: 'GET /notifications/unread', status: 200, body: '{ "unread": 3 }' },
  },
  {
    method: 'GET', path: '/users/:id', what: 'One person: 42, 7 or 3. Any other id answers with Ada.',
    params: [['id', 'in the path']], returns: '{ id: string; name: string; email: string }',
    example: { request: 'GET /users/42', status: 200, body: '{ "id": "42", "name": "Ada Lovelace", "email": "ada@example.com" }' },
    errors: "These ids fail on purpose: '404' answers 404, '500' answers 500, 'offline' never connects, 'slow' never answers, and 'flaky' answers 500 twice, then 200.",
  },
  {
    method: 'GET', path: '/search?q=', what: 'Three suggestions for q. The shorter q is, the slower the answer.',
    params: [['q', 'in the query']], returns: 'string[]',
    example: { request: 'GET /search?q=liaise', status: 200, body: '["liaise", "liaise docs", "liaise examples"]' },
  },
  {
    method: 'GET', path: '/jobs/:id', what: "A job's status. It reads queued twice, then running, then done.",
    params: [['id', 'in the path: only 42 exists']], returns: "{ id: string; status: 'queued' | 'running' | 'done'; result?: string }",
    example: { request: 'GET /jobs/42', status: 200, body: '{ "id": "42", "status": "queued" }' },
    errors: 'Any other id answers 404.',
  },
]

/** The server switch beside Run. Check my code ignores it: one run Healthy, one run Down. */
export const MODES: Array<[string, string]> = [
  ['Healthy', '/notifications/unread answers { "unread": 3 } in about 0.1 s.'],
  ['Down', '/notifications/unread answers 500 { "message": "Server error" }. In liaise that is an error with kind \'http\'.'],
  ['Slow', `/notifications/unread takes ${SLOW_MS / 1000} s to answer.`],
]
