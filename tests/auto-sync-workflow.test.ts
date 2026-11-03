import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createAutoSyncWorkflow } from '../scripts/auto-sync-workflow'

const options = { ledgerRepository: 'owner/books', ledgerBranch: 'master', appRepository: 'owner/countwell', appRef: 'a'.repeat(40), activate: true }
const definition = (activate = true) => parse(createAutoSyncWorkflow({ ...options, activate }))

describe('private ledger automation', () => {
  it('only activates pushes after setup and offers a deployment-free validation run', () => {
    expect(definition(false).on.push).toBeUndefined()
    const workflow = definition()
    expect(workflow.on.push.branches).toEqual(['master'])
    expect(workflow.on.workflow_dispatch.inputs.validate_only.type).toBe('boolean')
    expect(workflow.on.pull_request).toBeUndefined()
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('pins application code and official actions to immutable commits', () => {
    const steps = definition().jobs.publish.steps
    expect(steps[0].with.ref).toBe(options.appRef)
    expect(steps[0].with['persist-credentials']).toBe(false)
    for (const step of steps.filter((step: { uses?: string }) => step.uses)) expect(step.uses).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/)
  })

  it('keeps Cloudflare deployment credentials out of checkout, validation and builds', () => {
    const steps = definition().jobs.publish.steps
    const withCloudflareToken = steps.filter((step: { env?: Record<string, string> }) => step.env?.CLOUDFLARE_API_TOKEN)
    expect(withCloudflareToken).toHaveLength(1)
    expect(withCloudflareToken[0].id).toBe('deploy')
    expect(withCloudflareToken[0].env.GH_TOKEN).toBeUndefined()
    const snapshot = steps.find((step: { run?: string }) => step.run?.includes('npm run cloud:sync'))
    expect(snapshot.env.GH_TOKEN).toBe('${{ github.token }}')
    expect(snapshot.run).toContain('gh auth setup-git')
    expect(snapshot.run).toContain('--ref "$GITHUB_SHA"')
    expect(snapshot.run).toContain('--expected-owner-id "$COUNTWELL_ALLOWED_USER_ID"')
    expect(snapshot.run).not.toContain('--deploy')
  })

  it('serializes production changes and refuses to publish a stale or validation-only commit', () => {
    const workflow = definition()
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
    const steps = workflow.jobs.publish.steps
    const guard = steps.find((step: { id?: string }) => step.id === 'current')
    const deploy = steps.find((step: { id?: string }) => step.id === 'deploy')
    expect(guard.run).toContain('"$head" = "$GITHUB_SHA"')
    expect(deploy.if).toContain("steps.current.outputs.publish == 'true'")
    expect(deploy.if).toContain('inputs.validate_only')
    expect(steps.indexOf(guard)).toBeLessThan(steps.indexOf(deploy))
  })

  it('only caches dependencies and never uploads private snapshots as artifacts', () => {
    const steps = definition().jobs.publish.steps
    expect(steps.filter((step: { uses?: string }) => step.uses?.includes('upload-artifact'))).toHaveLength(0)
    expect(steps.filter((step: { with?: { cache?: string } }) => step.with?.cache).map((step: { with: { cache: string } }) => step.with.cache)).toEqual(['npm', 'pip'])
    expect(steps.some((step: { run?: string }) => /cat .*snapshot|cat .*\.beancount/.test(step.run ?? ''))).toBe(false)
    expect(steps.some((step: { run?: string }) => step.run === 'npm test')).toBe(true)
  })

  it('verifies authentication protection after publishing without using private credentials', () => {
    const check = definition().jobs.publish.steps.at(-1)
    expect(check.if).toBe("steps.deploy.outcome == 'success'")
    expect(Object.keys(check.env)).toEqual(['COUNTWELL_SITE_URL'])
    expect(check.run).toContain('/api/auth/status')
    expect(check.run).toContain('"$code" = "401"')
  })

  it('rejects mutable application refs and expression injection in the repository or branch', () => {
    expect(() => createAutoSyncWorkflow({ ...options, appRef: 'main' })).toThrow()
    expect(() => createAutoSyncWorkflow({ ...options, ledgerRepository: "owner/books' || true" })).toThrow()
    expect(() => createAutoSyncWorkflow({ ...options, ledgerBranch: "master' || true" })).toThrow()
  })
})
