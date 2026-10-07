import { describe, it, expect } from 'vitest'
import { pickFetch } from '../src/playground/route-fetch'

const page = { pageOrigin: 'https://iremlopsum.github.io' }

describe('pickFetch: only the fake host is fake', () => {
  it('sends the fake host to the fake API', () => {
    expect(pickFetch('https://api.example.com/users/42', page)).toBe('fake')
    expect(pickFetch(new URL('https://api.example.com/graphql'), page)).toBe('fake')
  })
  it("keeps the page's own files on the page", () => {
    expect(pickFetch('https://iremlopsum.github.io/liaise/liaise/dts.json', page)).toBe('page')
    expect(pickFetch('/liaise/pagefind/pagefind-entry.json', page)).toBe('page')
    expect(pickFetch('liaise/dts.json', page)).toBe('page')
  })
  it('sends every other origin out for real', () => {
    expect(pickFetch('https://jsonplaceholder.typicode.com/users/1', page)).toBe('real')
    expect(pickFetch('http://api.example.com/users/42', page)).toBe('real') // another scheme is another origin
    expect(pickFetch('//jsonplaceholder.typicode.com/users/1', page)).toBe('real')
  })
  it('reads the URL of a Request', () => {
    expect(pickFetch(new Request('https://api.example.com/users/42'), page)).toBe('fake')
    expect(pickFetch(new Request('https://jsonplaceholder.typicode.com/users/1'), page)).toBe('real')
    expect(pickFetch(new Request('https://iremlopsum.github.io/liaise/liaise/dts.json'), page)).toBe('page')
  })
})
