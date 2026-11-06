import { stringify } from 'yaml'

/** Installed in the private ledger repository and dispatched by the daily automation. */
export function createFundNavWorkflow(): string {
  return '# Managed by Countwell. Only appends validated official fund quotes.\n' + stringify({
    name: 'Update Countwell fund NAV',
    on: { workflow_dispatch: { inputs: {
      dry_run: { description: 'Validate without committing or publishing', type: 'boolean', default: true },
    } } },
    permissions: { contents: 'write', actions: 'write' },
    concurrency: { group: 'countwell-record-expense', queue: 'max' },
    jobs: {
      update: {
        if: '${{ github.event.repository.private && github.ref_name == github.event.repository.default_branch }}',
        'runs-on': 'ubuntu-24.04',
        'timeout-minutes': 10,
        steps: [
          { name: 'Checkout latest ledger', uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', with: { ref: '${{ github.ref_name }}', path: 'ledger' } },
          { name: 'Checkout Countwell', uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', with: { repository: 'ststyin/countwell', ref: 'main', path: 'countwell', 'persist-credentials': false } },
          { name: 'Set up Node', uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', with: { 'node-version': 22, cache: 'npm', 'cache-dependency-path': 'countwell/package-lock.json' } },
          { name: 'Set up Python', uses: 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065', with: { 'python-version': '3.12', cache: 'pip', 'cache-dependency-path': 'countwell/requirements.txt' } },
          { name: 'Install dependencies', 'working-directory': 'countwell', run: 'npm ci --silent\npython -m pip install -q -r requirements.txt' },
          { name: 'Fetch official unit NAVs and validate ledger', 'working-directory': 'countwell', env: {
            COUNTWELL_LEDGER_DIR: '${{ github.workspace }}/ledger',
            COUNTWELL_LEDGER_ENTRY: '${{ vars.COUNTWELL_LEDGER_ENTRY }}',
          }, run: 'node --import tsx scripts/update-fund-nav.ts' },
          { name: 'Commit validated quotes', id: 'commit', if: '${{ !inputs.dry_run }}', 'working-directory': 'ledger', run: [
            'git add -- investments/prices.beancount',
            'if git diff --cached --quiet; then exit 0; fi',
            'git diff --cached --check',
            'git -c user.name=Countwell -c user.email=Countwell@users.noreply.github.com commit -qm "Update official fund NAVs"',
            'git push -q origin "HEAD:refs/heads/$GITHUB_REF_NAME"',
            'echo "changed=true" >> "$GITHUB_OUTPUT"',
          ].join('\n') },
          { name: 'Start private site update', if: "steps.commit.outputs.changed == 'true'", env: { GH_TOKEN: '${{ github.token }}' },
            run: 'gh workflow run countwell-sync.yml --repo "$GITHUB_REPOSITORY" --ref "$GITHUB_REF_NAME" -f validate_only=false' },
        ],
      },
    },
  }, { lineWidth: 0 })
}
