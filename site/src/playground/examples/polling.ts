import { createApi, defineRequest, pollUntil } from 'liaise'

type Job = { id: string; status: 'queued' | 'running' | 'done'; result?: string }

const getJob = defineRequest<Job>()({ method: 'GET', path: '/jobs/:id' })
const api = createApi({ baseUrl: 'https://api.example.com', requests: { getJob } })

// Ask every 300 ms until the job is done, and give up after 5 seconds.
const { data, error } = await pollUntil(api.getJob, { id: '42' }, {
  every: 300,
  until: r => r.data.status === 'done',
  giveUpAfter: 5000,
})

if (error) console.log(`gave up: ${error.kind} ${error.status}`)
else console.log(`job ${data.id} is ${data.status}: ${data.result}`)
