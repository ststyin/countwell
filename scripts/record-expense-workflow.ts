import { stringify } from 'yaml'

/** Installed in the ledger repository alongside the private site update workflow. */
export function createRecordExpenseWorkflow(): string {
  return '# Managed by Countwell. Validate the full ledger before pushing.\n' + stringify({
    name: 'Record Countwell expense',
    'run-name': 'Countwell expense ${{ inputs.request_id }}',
    on: { workflow_dispatch: { inputs: {
      request_id: { description: 'Request identifier', required: true, type: 'string' },
      payload: { description: 'Encoded expense', required: true, type: 'string' },
      dry_run: { description: 'Validate without committing', type: 'boolean', default: false },
    } } },
    permissions: { contents: 'write', actions: 'write' },
    concurrency: { group: 'countwell-record-expense', queue: 'max' },
    jobs: { record: {
      'runs-on': 'ubuntu-latest', 'timeout-minutes': 10,
      steps: [
        { name: 'Checkout ledger', uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', with: { ref: '${{ github.ref_name }}', path: 'ledger' } },
        { name: 'Checkout application', uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', with: { repository: 'ststyin/countwell', ref: 'main', path: 'countwell', 'persist-credentials': false } },
        { name: 'Set up Node', uses: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', with: { 'node-version': 22, cache: 'npm', 'cache-dependency-path': 'countwell/package-lock.json' } },
        { name: 'Set up Python', uses: 'actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065', with: { 'python-version': '3.12', cache: 'pip', 'cache-dependency-path': 'countwell/requirements.txt' } },
        { name: 'Install dependencies', 'working-directory': 'countwell', run: 'npm ci --silent\npython -m pip install -q -r requirements.txt' },
        { name: 'Prepare and validate expense', 'working-directory': 'countwell', env: {
          COUNTWELL_EXPENSE_PAYLOAD: '${{ inputs.payload }}', COUNTWELL_REQUEST_ID: '${{ inputs.request_id }}',
          COUNTWELL_LEDGER_DIR: '${{ github.workspace }}/ledger', COUNTWELL_LEDGER_ENTRY: '${{ vars.COUNTWELL_LEDGER_ENTRY }}',
        }, run: 'node --import tsx scripts/record-expense.ts' },
        { name: 'Commit validated expense', if: '${{ !inputs.dry_run }}', 'working-directory': 'ledger', run: [
          'git config user.name "Countwell"',
          'git config user.email "countwell@users.noreply.github.com"',
          'git add -- main.beancount transactions',
          'if ! git diff --cached --quiet; then',
          '  git diff --cached --check',
          '  git commit -q -m "Record expense via Countwell"',
          '  git push -q origin "HEAD:refs/heads/$GITHUB_REF_NAME"',
          'fi',
        ].join('\n') },
        { name: 'Start private site update', if: '${{ !inputs.dry_run }}', env: {
          GH_TOKEN: '${{ github.token }}', COUNTWELL_REQUEST_ID: '${{ inputs.request_id }}',
        }, run: 'gh workflow run countwell-sync.yml --repo "$GITHUB_REPOSITORY" --ref "$GITHUB_REF_NAME" -f validate_only=false -f request_id="$COUNTWELL_REQUEST_ID"' },
      ],
    } },
  }, { lineWidth: 0 })
}
