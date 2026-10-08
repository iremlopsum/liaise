// Every file the intro shows finished, by name. `npm run docs:types` compiles them as one project
// against liaise's source and React's types (scripts/check-doc-types.mjs), so code a reader copies
// from a slide, or the challenge's solution, can't drift out of date.
import { SOURCES } from './engine/slides'
import { SCAFFOLD, SOLUTION } from './challenge/files'

export const FILES: Record<string, string> = {
  // Slide 1's api.ts, and slide 3's with the search box it serves.
  'setup/api.ts': SOURCES.API_TS,
  'dedupe/api.ts': SOURCES.API_TS_DEDUPE,
  'dedupe/Search.tsx': SOURCES.SEARCH_TSX,
  // The finished app: slide 9's api.ts and search box, and every other slide's file beside them.
  'api.ts': SOURCES.API_FINAL,
  'profile.ts': SOURCES.PROFILE_TS,
  'Search.tsx': SOURCES.SEARCH_FINAL,
  'components.tsx': SOURCES.COMPONENTS_TSX,
  'auth.ts': SOURCES.AUTH_TS,
  'Blog.tsx': SOURCES.BLOG_TSX,
  'Bell.tsx': SOURCES.BELL_TSX,
  'weather.ts': SOURCES.WEATHER_TS,
  // auth.ts imports these from the reader's own app; the slides never show them.
  'session.ts': 'export declare function getToken(): string\nexport declare function signOut(): void\n',
  // Step 10.
  'challenge/scaffold.ts': SCAFFOLD,
  'challenge/solution.ts': SOLUTION,
}
