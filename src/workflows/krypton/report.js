// The Krypton report: Report.md (plain, easy to share or convert to DOC/PDF) and
// Report.html (the same content, readable in a browser and in the control panel).

const cell = (v) => String(v ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const link = (text, url) => (url ? `[${cell(text) || 'link'}](${url})` : cell(text));
const short = (s, n = 220) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function table(head, rows) {
  if (!rows.length) return '_None._\n';
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') + '\n';
}

// People named by Agent 3 (post authors, commenters, reactors), one row per person.
function postProspects(posts) {
  const byKey = new Map();
  for (const post of posts) {
    for (const p of post.prospects || []) {
      const level = Number(p.level);
      if (![1, 2].includes(level)) continue;
      const key = p.profileUrl || p.name;
      const prev = byKey.get(key);
      if (!prev || level < prev.level) byKey.set(key, { ...p, level, post: post.url, source: post.source });
    }
  }
  return [...byKey.values()].sort((a, b) => a.level - b.level);
}

export function buildMarkdown({ settings: s, plan, stats, results, notes, limits, usage, provider, folder }) {
  const { people, posts, jobs, indicators } = results;
  const lvl = (list, n) => list.filter((x) => x.level === n);
  const prospects = postProspects(posts);
  const total = (k) => Object.values(stats).reduce((sum, st) => sum + (st?.[k] || 0), 0);
  const peopleRow = (p) => [link(p.name, p.url), short(p.headline, 90), p.term ? `"${p.term}"${p.page ? ` p.${p.page}` : ''}` : p.icp ? `Sales Navigator: ${p.icp}` : '', short(p.evidence, 300), p.websites?.length ? p.websites.join(' ') : ''];
  const jobRow = (j) => [link(j.title, j.url), link(j.company, j.companyUrl), j.location || '', short(j.evidence, 260)];
  const postRow = (p) => [link(short(p.caption, 80) || '(no text)', p.url), link(p.author, p.authorUrl), p.source, short(p.evidence, 260)];
  const out = [];
  out.push(`# Krypton report: ${s.business_name}`);
  out.push('');
  out.push(`${s.business_type}. ${s.business_description}`);
  out.push('');
  out.push(`- Run folder: \`${folder}\``);
  out.push(`- Finished: ${new Date().toLocaleString()}`);
  out.push(`- AI: ${provider} (fast ${s[`fast_model_${s.ai_vendor}`]}, medium ${s[`medium_model_${s.ai_vendor}`]}, power ${s[`power_model_${s.ai_vendor}`]}${s.extra_power ? ', extra power' : ''})`);
  if (usage.input_tokens || usage.output_tokens) out.push(`- AI tokens: ${usage.input_tokens.toLocaleString()} in, ${usage.output_tokens.toLocaleString()} out`);
  out.push('');

  out.push('## Summary');
  out.push('');
  out.push(`- Search terms: ${plan.terms.length} (${plan.termSource === 'given' ? 'given' : 'written by the AI'})`);
  out.push(`- People in search results: ${total('people')}, kept after the provider filter: ${total('kept')}, profiles read: ${people.length}`);
  out.push(`- **People actively looking (level 1): ${lvl(people, 1).length}**; matching indicators (level 2): ${lvl(people, 2).length}`);
  out.push(`- Posts read: ${posts.length} (level 1: ${lvl(posts, 1).length}, level 2: ${lvl(posts, 2).length}); people named in posts and responses: ${prospects.length}`);
  out.push(`- Jobs read: ${jobs.length}; **exact matches: ${lvl(jobs, 1).length}**; similar: ${lvl(jobs, 2).length}`);
  out.push(`- Groups found: ${total('groups')}`);
  out.push('');

  out.push('## People actively looking (level 1)');
  out.push('');
  out.push(table(['Person', 'Headline', 'Found by', 'What the AI found', 'Websites'], lvl(people, 1).map(peopleRow)));
  out.push('## People matching the indicators (level 2)');
  out.push('');
  out.push(table(['Person', 'Headline', 'Found by', 'What the AI found', 'Websites'], lvl(people, 2).map(peopleRow)));
  out.push('## People found in posts, comments and reactions');
  out.push('');
  out.push(table(['Person', 'Level', 'Where', 'What the AI found'], prospects.map((p) => [link(p.name, p.profileUrl), p.level, link(p.source, p.post), short(p.evidence, 260)])));
  out.push('## Companies hiring for what we offer (exact match)');
  out.push('');
  out.push(table(['Job', 'Company', 'Location', 'Why'], lvl(jobs, 1).map(jobRow)));
  out.push('## Similar jobs');
  out.push('');
  out.push(table(['Job', 'Company', 'Location', 'Why'], lvl(jobs, 2).map(jobRow)));
  out.push('## Posts worth reading');
  out.push('');
  out.push(table(['Post', 'Author', 'Found by', 'What the AI found'], [...lvl(posts, 1), ...lvl(posts, 2)].map(postRow)));

  out.push('## Search terms');
  out.push('');
  out.push(table(['Term', 'People', 'Kept', 'Profiles', 'Their posts', 'Jobs', 'Posts', 'Groups'], plan.terms.map((t) => {
    const st = stats[t] || {};
    return [t, st.people ?? '-', st.kept ?? '-', st.profiles ?? '-', st.profilePosts ?? '-', st.jobs ?? '-', st.posts ?? '-', st.groups ?? '-'];
  })));
  if (stats['Sales Navigator']) {
    out.push('## Sales Navigator');
    out.push('');
    out.push(table(['ICP', 'Results shown', 'Leads saved', 'Broadened', 'Profiles read'], (stats['Sales Navigator'].icps || []).map((x) => [x.name, x.total ?? '?', x.leads, x.broadened, x.profiles])));
  }
  out.push('## Key indicators (Agent 1)');
  out.push('');
  out.push(indicators.length ? indicators.map((x) => `- ${x}`).join('\n') : '_None._');
  out.push('');
  out.push('## Ideal customer profiles');
  out.push('');
  for (const icp of plan.icps) {
    out.push(`### ${icp.name}`);
    out.push('');
    if (icp.summary) out.push(`${icp.summary}\n`);
    for (const [k, v] of Object.entries(icp)) {
      if (['name', 'summary', 'filters'].includes(k) || v === '' || v == null) continue;
      out.push(`- **${k.replace(/_/g, ' ')}**: ${Array.isArray(v) ? v.join('; ') : v}`);
    }
    if (icp.filters) out.push(`- **LinkedIn filters**: ${Object.entries(icp.filters).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k.replace(/_/g, ' ')} = ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')}`);
    out.push('');
  }
  if (plan.criteria) {
    out.push('## Job criteria used');
    out.push('');
    for (const [k, v] of Object.entries(plan.criteria)) out.push(`- **${k.replace(/_/g, ' ')}**: ${Array.isArray(v) ? v.join('; ') : v}`);
    out.push('');
  }
  out.push('## Notes');
  out.push('');
  const all = [...limits.map((l) => `Daily limit reached: ${l}`), ...notes.filter((n) => !limits.some((l) => n.includes(l)))];
  out.push(all.length ? all.map((n) => `- ${n}`).join('\n') : '- Nothing went wrong.');
  out.push('- Levels come from AI reading public LinkedIn content. Check each person before reaching out.');
  out.push('');
  out.push('All collected pages, posts, jobs and every AI prompt and answer are in the run folder (People, Jobs, Posts, Groups, AI Runs, Results).');
  out.push('');
  return out.join('\n');
}

// Small Markdown to HTML converter for the report's own output (headings, lists, tables,
// links, bold, code). Not a general Markdown parser.
export function markdownToHtml(md, title) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t) => esc(t)
    .replace(/\\\|/g, '|')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = md.split('\n');
  const html = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^### /.test(line)) html.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (/^## /.test(line)) html.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (/^# /.test(line)) html.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^\| /.test(line)) {
      const rows = [];
      while (i < lines.length && /^\| /.test(lines[i])) rows.push(lines[i++]);
      i -= 1;
      const split = (r) => r.slice(2, -2).split(/ (?<!\\)\| /);
      const head = split(rows[0]);
      html.push(`<div class="tw"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${split(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      i -= 1;
      html.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
    } else if (/^_.+_$/.test(line.trim())) html.push(`<p><em>${inline(line.trim().slice(1, -1))}</em></p>`);
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { --bg: #fff; --fg: #1d2330; --muted: #5d6675; --line: #e3e6ec; --accent: #0a66c2; --head: #f5f7fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171c; --fg: #e6e9ef; --muted: #9aa3b2; --line: #2b313b; --accent: #6cb4ff; --head: #1c2027; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 26px; margin: 0 0 8px; } h2 { font-size: 19px; margin: 32px 0 10px; padding-top: 8px; border-top: 1px solid var(--line); } h3 { font-size: 16px; margin: 20px 0 6px; }
a { color: var(--accent); } code { font-size: 13px; background: var(--head); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
.tw { overflow-x: auto; } table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; } th { background: var(--head); }
p em { color: var(--muted); }
</style></head><body><main>
${html.join('\n')}
</main></body></html>`;
}

export function writeReport({ store, settings, plan, stats, results, notes, limits, usage, provider }) {
  const md = buildMarkdown({ settings, plan, stats, results, notes, limits, usage, provider, folder: store.root });
  const mdFile = store.text(['Report.md'], md);
  const htmlFile = store.text(['Report.html'], markdownToHtml(md, `Krypton report: ${settings.business_name}`));
  return { md: mdFile, html: htmlFile };
}
