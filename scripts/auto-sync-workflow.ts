import { stringify } from 'yaml'
import { validateSourceConfig } from './sync-cloud-ledger'

export interface AutoSyncWorkflowOptions {
  ledgerRepository: string
  ledgerBranch: string
  appRepository: string
  appRef: string
  activate: boolean
}

const actions = {
  checkout: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  node: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
  python: 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065',
}

/** Run inside the private ledger repo using main or an explicitly pinned app commit. */
export function createAutoSyncWorkflow(options: AutoSyncWorkflowOptions): string {
  const source = validateSourceConfig({ repository: options.ledgerRepository, entryPath: 'main.beancount', ref: options.ledgerBranch })
  const app = validateSourceConfig({ repository: options.appRepository, entryPath: 'main.beancount' })
  if (!source.ref || (options.appRef !== 'main' && !/^[a-f0-9]{40}$/.test(options.appRef))) throw new Error('工作流需要有效账本分支，应用版本必须是 main 或完整提交 SHA。')
  const events = {
    ...(options.activate ? { push: { branches: [source.ref] } } : {}),
    workflow_dispatch: {
      inputs: {
        validate_only: { description: 'Only validate and build, without publishing', type: 'boolean', default: false },
      },
    },
  }
  const workflow = {
    name: 'Update Countwell private ledger',
    on: events,
    permissions: { contents: 'read' },
    concurrency: { group: 'countwell-private-production', 'cancel-in-progress': false },
    jobs: {
      publish: {
        if: `github.repository == '${source.repository}' && github.ref == 'refs/heads/${source.ref}' && (vars.COUNTWELL_AUTO_SYNC_ENABLED == 'true' || (github.event_name == 'workflow_dispatch' && inputs.validate_only))`,
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 15,
        defaults: { run: { 'working-directory': 'countwell', shell: 'bash' } },
        steps: [
          { name: 'Checkout Countwell application', uses: actions.checkout, with: { repository: app.repository, ref: options.appRef === 'main' ? 'refs/heads/main' : options.appRef, path: 'countwell', 'persist-credentials': false } },
          {
            name: 'Record application version', id: 'application',
            env: { COUNTWELL_APP_REF: options.appRef },
            run: [
              'sha=$(git rev-parse HEAD)',
              '[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "::error::Unable to identify the application commit."; exit 1; }',
              'echo "sha=$sha" >> "$GITHUB_OUTPUT"',
              'printf \'Countwell source: %s (%s)\\n\' "$COUNTWELL_APP_REF" "$sha"',
              'printf \'Countwell application: `%s` at `%s`\\n\' "$COUNTWELL_APP_REF" "$sha" >> "$GITHUB_STEP_SUMMARY"',
            ].join('\n'),
          },
          { name: 'Set up Node.js', uses: actions.node, with: { 'node-version': 22, cache: 'npm', 'cache-dependency-path': 'countwell/package-lock.json' } },
          { name: 'Set up official Beancount runtime', uses: actions.python, with: { 'python-version': '3.12', cache: 'pip', 'cache-dependency-path': 'countwell/requirements.txt' } },
          { name: 'Install application dependencies', run: 'npm ci' },
          { name: 'Install official engine', run: 'python -m pip install -r requirements.txt' },
          { name: 'Verify application', run: 'npm test' },
          {
            name: 'Validate ledger and prepare private snapshot',
            env: {
              GH_TOKEN: '${{ github.token }}',
              COUNTWELL_LEDGER_ENTRY: '${{ vars.COUNTWELL_LEDGER_ENTRY }}',
              COUNTWELL_ALLOWED_USER_ID: '${{ vars.COUNTWELL_ALLOWED_USER_ID }}',
            },
            run: [
              'gh auth setup-git --hostname github.com',
              'npm run cloud:sync -- \\',
              '  --repository "$GITHUB_REPOSITORY" \\',
              '  --entry "$COUNTWELL_LEDGER_ENTRY" \\',
              '  --ref "$GITHUB_SHA" \\',
              '  --expected-owner-id "$COUNTWELL_ALLOWED_USER_ID"',
            ].join('\n'),
          },
          { name: 'Build private interface', run: 'npm run cloud:build' },
          {
            name: 'Check Worker bundle without publishing',
            env: { COUNTWELL_ALLOWED_USER_ID: '${{ vars.COUNTWELL_ALLOWED_USER_ID }}', WRANGLER_SEND_METRICS: 'false' },
            run: 'npx wrangler deploy --config wrangler.private.json --var "GITHUB_ALLOWED_USER_ID:$COUNTWELL_ALLOWED_USER_ID" --dry-run',
          },
          {
            name: 'Reject stale commits', id: 'current',
            env: {
              GH_TOKEN: '${{ github.token }}', COUNTWELL_LEDGER_BRANCH: source.ref,
              ...(options.appRef === 'main' ? {
                COUNTWELL_APP_REPOSITORY: app.repository,
                COUNTWELL_APP_SHA: '${{ steps.application.outputs.sha }}',
              } : {}),
            },
            run: [
              ...(options.appRef === 'main' ? [
                'app_head=$(gh api "repos/$COUNTWELL_APP_REPOSITORY/git/ref/heads/main" --jq .object.sha)',
                'if [ "$app_head" != "$COUNTWELL_APP_SHA" ]; then',
                '  echo "::error::Countwell main changed during this build. Re-run this workflow to use the latest code."',
                '  exit 1',
                'fi',
              ] : []),
              'head=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$COUNTWELL_LEDGER_BRANCH" --jq .object.sha)',
              'if [ "$head" = "$GITHUB_SHA" ]; then',
              '  echo "publish=true" >> "$GITHUB_OUTPUT"',
              'else',
              '  echo "publish=false" >> "$GITHUB_OUTPUT"',
              '  echo "A newer ledger commit exists; this run will not publish."',
              'fi',
            ].join('\n'),
          },
          {
            name: 'Publish protected site', id: 'deploy',
            if: "steps.current.outputs.publish == 'true' && !(github.event_name == 'workflow_dispatch' && inputs.validate_only)",
            env: {
              CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
              CLOUDFLARE_ACCOUNT_ID: '${{ vars.CLOUDFLARE_ACCOUNT_ID }}',
              COUNTWELL_ALLOWED_USER_ID: '${{ vars.COUNTWELL_ALLOWED_USER_ID }}',
              WRANGLER_SEND_METRICS: 'false',
            },
            run: [
              'if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then',
              '  echo "::error::Cloudflare deployment credentials are not configured."',
              '  exit 1',
              'fi',
              'npx wrangler deploy --config wrangler.private.json --var "GITHUB_ALLOWED_USER_ID:$COUNTWELL_ALLOWED_USER_ID"',
            ].join('\n'),
          },
          {
            name: 'Verify private access protection',
            if: "steps.deploy.outcome == 'success'",
            env: { COUNTWELL_SITE_URL: '${{ vars.COUNTWELL_SITE_URL }}' },
            run: [
              'auth=$(curl --fail --silent --show-error --retry 2 --max-time 25 "$COUNTWELL_SITE_URL/api/auth/status")',
              'printf \'%s\' "$auth" | node -e \'let data="";process.stdin.on("data",chunk=>data+=chunk);process.stdin.on("end",()=>{const auth=JSON.parse(data);if(auth.cloud!==true||auth.configured!==true||auth.authenticated!==false)process.exit(1)})\'',
              'code=$(curl --silent --show-error --max-time 25 --output /dev/null --write-out \'%{http_code}\' "$COUNTWELL_SITE_URL/api/ledger/snapshot")',
              '[ "$code" = "401" ] || { echo "::error::Anonymous access must be denied."; exit 1; }',
            ].join('\n'),
          },
        ],
      },
    },
  }
  return '# Managed by Countwell auto-sync.\n' + stringify(workflow, { lineWidth: 0 })
}
