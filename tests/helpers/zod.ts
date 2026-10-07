// A stand-in for the slice of zod that docs examples use (z.object, z.string, z.infer), built
// on the Standard Schema interface zod implements. The root package does not depend on zod,
// and adding it would change package.json, so vitest.config.ts and tsconfig.test.json alias
// 'zod' here: an example can import { z } from 'zod' exactly as the page shows and still run.
// Like zod, z.object keeps only the keys its shape names. Synchronous validators only.
import type { StandardIssue, StandardResult, StandardSchemaV1 } from '../../src/types.js'

type Output<S> = S extends StandardSchemaV1<infer T> ? T : never

function schema<T>(validate: (value: unknown) => StandardResult<T>): StandardSchemaV1<T> {
  return { '~standard': { version: 1, vendor: 'zod-stand-in', validate } }
}

function string(): StandardSchemaV1<string> {
  return schema<string>(v => (typeof v === 'string' ? { value: v } : { issues: [{ message: `Expected string, received ${typeof v}` }] }))
}

function object<S extends Record<string, StandardSchemaV1<unknown>>>(shape: S): StandardSchemaV1<{ [K in keyof S]: Output<S[K]> }> {
  return schema<{ [K in keyof S]: Output<S[K]> }>(v => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { issues: [{ message: 'Expected object' }] }
    const out: Record<string, unknown> = {}
    const issues: StandardIssue[] = []
    for (const [key, field] of Object.entries(shape)) {
      const r = field['~standard'].validate((v as Record<string, unknown>)[key]) as StandardResult<unknown>
      if (r.issues) issues.push(...r.issues.map(i => ({ ...i, path: [key, ...(i.path ?? [])] })))
      else out[key] = r.value
    }
    return issues.length ? { issues } : { value: out as { [K in keyof S]: Output<S[K]> } }
  })
}

export const z = { object, string }
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace z {
  type infer<S> = Output<S>
}
