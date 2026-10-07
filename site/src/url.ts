// Every internal link goes through here, so the /liaise base is never forgotten.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
export const url = (path: string) => (path.startsWith('/') ? BASE + path : path)
