// A check result as text: plain for a terminal, Markdown for a GitHub step summary, a pull
// request or a file someone downloads from the page. One function for both the CLI and the
// page, so the report a collaborator downloads is the report CI writes.
//
// Pure. `t` is passed in, so this module keeps no language state of its own.

/** One mark per verdict and outcome, the same everywhere a result is shown. */
export const MARK = Object.freeze({ evidenced: '✓', missing: '✗', pending: '…', declared: '·', skipped: '-', unanswered: '?' });

export function formatReport(result, problems, { format = 'text', planPath = 'smp.json', t }) {
  const { summary: s } = result;
  const md = format === 'md';
  const out = [];
  out.push(md ? `### ${t('check.results')}: \`${planPath}\`` : `${t('check.results')}: ${planPath}`, '');
  const strip = (html) => html.replace(/<\/?b>/g, md ? '**' : '');
  out.push(strip(t('sum.answered', { a: s.answered, n: s.inScope })));
  out.push(strip(t('sum.evidenced', { e: s.evidenced, n: s.inScope })));
  out.push(strip(t('sum.failing', { m: s.failing })), '');

  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length) {
    out.push(t('plan.valid.errors', { n: errors.length }));
    for (const p of errors) out.push(`  ${md ? '- ' : ''}${p.path}: ${t(p.code, p.vars)}`);
    out.push('');
  }

  if (md) out.push(`| | ${t('how.th.req')} | ${t('plan.status.label')} | ${t('how.th.checks')} |`, '|---|---|---|---|');
  for (const r of result.requirements) {
    const title = t(`req.${r.id}.title`);
    const checks = r.checks.map((c) => `${MARK[c.outcome]} ${t(`chk.${c.id}`)}: ${t(c.detail, c.vars)}`);
    if (md) {
      out.push(`| ${MARK[r.verdict]} | ${title} | ${t(`status.${r.status}`)} | ${checks.join('<br>').replace(/\|/g, '\\|') || t(`verdict.${r.verdict}`)} |`);
    } else {
      out.push(`${MARK[r.verdict]} ${title} [${t(`status.${r.status}`)}] ${t(`verdict.${r.verdict}`)}`);
      for (const c of checks) out.push(`    ${c}`);
    }
  }
  return `${out.join('\n')}\n`;
}
