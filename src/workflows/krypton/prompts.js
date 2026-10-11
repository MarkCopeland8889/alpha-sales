// Prompt templates for Krypton. Each returns { system, prompt } and asks for JSON so the
// answers can be saved and used by the next stage. Tiers follow the workflow doc:
// medium = search terms, job criteria, people filter, indicators, job matching;
// power = profile and post classification.

const business = (s) => [
  `Business name: ${s.business_name}`,
  `Business type: ${s.business_type}`,
  `What we offer: ${s.business_description}`,
].join('\n');

const icpText = (icp) => Object.entries(icp)
  .filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))
  .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
  .join('\n');

const SALES_ANALYST = 'You are a sales research analyst helping a small business find potential clients on LinkedIn. You are precise, you never invent facts that are not in the material you are given, and you answer in the exact JSON format requested.';

// LinkedIn / Sales Navigator people filters the ICPs are written against. Fixed option lists
// use LinkedIn's own labels so a Sales Navigator search can be built from them directly.
export const LINKEDIN_FILTERS = `Company: Current company, Company headcount, Past company, Company type, Company headquarters location
Role: Function, Current job title, Seniority level, Past job title, Years in current company, Years in current position
Personal: Geography, Industry, First name, Last name, Profile language, Years of experience, Groups, School
Buyer intent: Following your company, Viewed your profile recently
Best path in: Connection, Connections of, Past colleague, Shared experiences
Recent updates: Changed jobs, Posted on LinkedIn
Workflow: Persona, Account lists, Lead lists, People in CRM, People you interacted with, Saved leads and accounts`;

export const FILTER_OPTIONS = {
  company_headcount: ['Self-employed', '1-10', '11-50', '51-200', '201-500', '501-1,000', '1,001-5,000', '5,001-10,000', '10,001+'],
  company_type: ['Public Company', 'Privately Held', 'Non Profit', 'Educational Institution', 'Partnership', 'Self Employed', 'Self Owned', 'Government Agency'],
  seniority_level: ['Owner / Partner', 'CXO', 'Vice President', 'Director', 'Experienced Manager', 'Entry Level Manager', 'Strategic', 'Senior', 'Entry Level', 'In Training'],
  function: ['Accounting', 'Administrative', 'Arts and Design', 'Business Development', 'Community and Social Services', 'Consulting', 'Education', 'Engineering', 'Entrepreneurship', 'Finance', 'Healthcare Services', 'Human Resources', 'Information Technology', 'Legal', 'Marketing', 'Media and Communication', 'Military and Protective Services', 'Operations', 'Product Management', 'Program and Project Management', 'Purchasing', 'Quality Assurance', 'Real Estate', 'Research', 'Sales', 'Customer Success and Support'],
  years: ['Less than 1 year', '1 to 2 years', '3 to 5 years', '6 to 10 years', 'More than 10 years'],
};

const ICP_SHAPE = `{
  "name": "short name for this ICP",
  "summary": "who they are and why they buy",
  "reachability": "why this person reads and answers LinkedIn messages and posts",
  "industry": "...", "geography": "...", "company_size": "...", "budget": "...",
  "buying_process": "...", "decision_makers": "...", "pain_points": "...", "business_goals": "...",
  "buying_intent": ["phrases or situations that show they are ready to buy"],
  "filters": {
    "keywords": "optional free-text keywords",
    "geography": ["regions as LinkedIn names them, e.g. United States, Ontario, Canada"],
    "industry": ["LinkedIn industry names"],
    "company_headcount": [${FILTER_OPTIONS.company_headcount.map((x) => `"${x}"`).join(', ')}],
    "company_type": [${FILTER_OPTIONS.company_type.map((x) => `"${x}"`).join(', ')}],
    "company_headquarters_location": ["..."],
    "function": ["LinkedIn function names, e.g. Operations, Finance"],
    "current_job_title": ["Owner", "Founder", "..."],
    "seniority_level": [${FILTER_OPTIONS.seniority_level.map((x) => `"${x}"`).join(', ')}],
    "years_in_current_company": [${FILTER_OPTIONS.years.map((x) => `"${x}"`).join(', ')}],
    "years_in_current_position": ["same options"],
    "years_of_experience": ["same options"],
    "profile_language": ["English"],
    "changed_jobs": false,
    "posted_on_linkedin": true
  }
}`;

// ICPs written against the LinkedIn filters (power tier). When the business gave its own ICP
// lines, they are the starting point; otherwise the AI builds them from scratch.
export function generateIcps(s, given = null) {
  return {
    system: SALES_ANALYST,
    prompt: `Our business we are trying to get new clients for is:
${business(s)}
${given ? `\nThe business owner described their ideal customer like this. Use it as the basis:\n${icpText(given)}\n` : ''}
Using the LinkedIn filters below, build the best possible ideal customer profiles (ICPs). Return from 1 to 5, depending on the type of business: a narrow specialist service may have one or two, a broad service more.

Keep reachability in mind. Target people who actually read and answer LinkedIn posts and messages and who make or strongly influence the buying decision. For example, a Fortune 500 CEO would never read his social media messages, while the owner of a 10-person company often does.

Filter options:
${LINKEDIN_FILTERS}

Only use filters that narrow the search toward buyers. Leave out filters that depend on our own account data (Following your company, Viewed your profile recently, Best path in, Workflow) unless they clearly help. For fixed option lists use the exact labels shown below.

Return a JSON array of ICP objects shaped like this (omit filters you do not use):
${ICP_SHAPE}`,
  };
}

// Sent as a follow-up in the same conversation when a Sales Navigator search for an ICP finds
// too few people.
export function broadenIcp(icp, found, wanted) {
  return `The Sales Navigator search for the ICP "${icp.name}" found only ${found} people. We want at least ${wanted}.

Broaden this ICP's filters so the search finds more of the same kind of buyer: drop the narrowest filters first, widen headcount, seniority, years and geography, and use broader job titles. Keep the people reachable and still likely to buy.

Return only this one ICP as a JSON object in the same shape, with the broadened filters.`;
}

export function generateSearchTerms(s, icp, count) {
  return {
    system: SALES_ANALYST,
    prompt: `${business(s)}

Ideal customer profile:
${icpText(icp)}

People who fit this profile and need what we offer often say so on LinkedIn: in posts asking for recommendations, in their headline or about section, in comments, or in job posts. Write ${count} search terms they or their company would plausibly use, that we can paste into LinkedIn search to find them.

Mix these kinds of terms:
- requests for help ("need a ...", "looking for a ...", "recommend a ...", "hiring a ...")
- the problems that lead to the need (pain points written the way a business owner would write them)
- role and job-title language a company uses when it is hiring for this work in-house
- industry-specific phrasing for the ICP's industry and geography

Keep each term short (2 to 6 words), as a person would type it. No hashtags, no quotes, no duplicates.

Return a JSON array of strings.`,
  };
}

export function jobCriteria(s) {
  return {
    system: SALES_ANALYST,
    prompt: `${business(s)}

We will search LinkedIn job listings. A company that is hiring for work we could do for them is a prospect we can pitch instead. For example, if we are an online bookkeeping firm and a business posts a job for a remote, fully online bookkeeper, that business qualifies to be pitched by us.

Describe exactly which job listings qualify a business as a prospect for our pitch:
- exact_match: job titles and duties that we could fully replace with our service
- similar: listings that overlap with our service but are not an exact match
- disqualifiers: listings that look related but are not prospects (for example agencies or firms like ours hiring their own staff, or roles that must be on-site in a way we cannot serve)
- signals: details in a listing that make it a stronger prospect (remote, part-time, contract, small company, urgency, ...)

Return a JSON object with the keys exact_match, similar, disqualifiers and signals, each a list of short strings.`,
  };
}

// people: [{ id, name, text }]
export function filterPeople(s, term, people) {
  return {
    system: SALES_ANALYST,
    prompt: `${business(s)}

We searched LinkedIn people for "${term}" to find people who NEED our service. Many results are instead people who PROVIDE this service (competitors, freelancers, employees of firms like ours, recruiters for such roles).

Below are ${people.length} search results exactly as LinkedIn showed them. Keep every person who does NOT appear to provide the service. Drop only the ones who clearly provide it. When unsure, keep them.

For each person you keep, add a short "intent" note: what in their result suggests they might need the service (or "unclear").

${people.map((p) => `[${p.id}] ${p.name}\n${p.text}`).join('\n\n')}

Return a JSON array of objects: { "id": <the number in brackets>, "intent": "<note>" } for the people you keep only.`,
  };
}

export function indicators(s) {
  return {
    system: SALES_ANALYST,
    prompt: `${business(s)}

Based on what a company or person shares on LinkedIn (their profile, posts, comments, company activity, hiring), what are the key indicators that they would need our service? Think about company stage, growth events, recent changes, complaints, hiring patterns, tools they mention, and how people phrase the problem before they look for a provider.

Return a JSON array of 10 to 20 short indicator strings, strongest first.`,
  };
}

// profiles: [{ id, name, profileText, posts: [{ caption, metrics }] }]
export function classifyProfiles(s, signs, profiles, delimiter) {
  const blocks = profiles.map((p) => [
    `PROFILE ${p.id}: ${p.name}`,
    p.profileText,
    p.posts.length ? `RECENT POSTS (${p.posts.length}):\n${p.posts.map((post, i) => `(${i + 1}) ${post.caption}`).join('\n')}` : 'RECENT POSTS: none collected',
  ].join('\n\n'));
  return {
    system: SALES_ANALYST,
    prompt: `You are a sales research assistant. You are looking at LinkedIn profiles to see whether or not someone would need our services.

${business(s)}

The biggest indicator is that they are actively seeking a ${s.business_type}, or are in the market for a ${s.business_type}, or use similar language. In that case classify them as level 1.
They are level 2 if they match any of these indicators:
${signs.map((x) => `- ${x}`).join('\n')}
Otherwise they are level 0.

In this batch you are processing ${profiles.length} profile(s), separated by the delimiter "${delimiter.trim()}".

${blocks.join(delimiter)}

For each profile return its level (1, 2 or 0) and explain what you found and where (headline, about, experience, which post).
Return a JSON array: [{ "id": <profile number>, "level": 1 | 2 | 0, "evidence": "<what and where>" }].`,
  };
}

// posts: [{ id, author, caption, metrics, comments: [{ author, profileUrl, text }], reactions: [{ name, profileUrl, reaction }] }]
export function classifyPosts(s, signs, posts, delimiter) {
  const blocks = posts.map((p) => [
    `POST ${p.id} by ${p.author || 'unknown'}${p.url ? ` (${p.url})` : ''}`,
    p.caption || '(no text)',
    p.comments.length ? `COMMENTS:\n${p.comments.map((c) => `- ${c.author}${c.profileUrl ? ` <${c.profileUrl}>` : ''}: ${c.text}`).join('\n')}` : 'COMMENTS: none',
    p.reactions.length ? `REACTIONS: ${p.reactions.slice(0, 100).map((r) => `${r.name} (${r.reaction || 'reacted'})`).join(', ')}` : 'REACTIONS: none',
  ].join('\n\n'));
  return {
    system: SALES_ANALYST,
    prompt: `You are a sales research assistant. You are looking at LinkedIn posts to see whether the author, or the people responding, would need our services.

${business(s)}

The biggest indicator is that in the post, or in the journey they share, someone is actively seeking a ${s.business_type} or is in the market for a ${s.business_type}, or uses similar language. That is level 1.
Level 2 is anyone matching these indicators through what they share:
${signs.map((x) => `- ${x}`).join('\n')}

Also check the comments and reactions. If the author OFFERS this service and someone responds that they need it, or shares that they are looking for it, that responder is level 1. People who are only interested or following along are level 2.
Return level 0 for a post when nothing in it or its responses meets these requirements.

In this batch you are processing ${posts.length} post(s), separated by the delimiter "${delimiter.trim()}".

${blocks.join(delimiter)}

Return a JSON array, one object per post:
[{ "id": <post number>, "level": 1 | 2 | 0, "evidence": "<what and where>", "prospects": [{ "name": "...", "profileUrl": "... or null", "level": 1 | 2, "evidence": "..." }] }]
"prospects" lists the specific people (author or responders) who are level 1 or 2; use [] when there are none.`,
  };
}

// jobs: [{ id, title, company, url, text }]
export function matchJobs(s, criteria, jobs, delimiter) {
  return {
    system: SALES_ANALYST,
    prompt: `${business(s)}

You are getting a list of ${jobs.length} LinkedIn job listings, separated by "${delimiter.trim()}". Decide for each one whether the hiring company is a prospect for our pitch.

Exact matches (level 1): ${criteria.exact_match?.join('; ') || 'n/a'}
Similar (level 2): ${criteria.similar?.join('; ') || 'n/a'}
Not prospects: ${criteria.disqualifiers?.join('; ') || 'n/a'}
Stronger signals: ${criteria.signals?.join('; ') || 'n/a'}

Return level 1 and the job url if the job is one of the exact matches. Return level 2 and the job url if it is only similar, not an exact match. Return level 3 if it does not match.

${jobs.map((j) => `JOB ${j.id}: ${j.title} at ${j.company}\n${j.url}\n${j.text}`).join(delimiter)}

Return a JSON array: [{ "id": <job number>, "url": "<job url>", "level": 1 | 2 | 3, "evidence": "<why>" }].`,
  };
}
