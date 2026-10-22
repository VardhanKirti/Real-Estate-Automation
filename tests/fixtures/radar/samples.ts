/**
 * Radar parser samples (05 AC-05-1). Reconstructed from the response shapes 05 section 3 records
 * as verified on 2026-10-11, with fictional titles, authors and ids. No network call was made to
 * build them (the lane forbids live calls); field names and nesting follow the spec's samples.
 */

export const HN = {
  hits: [
    { objectID: '90000001', title: 'Introducing Sample Model 7: our fastest reasoning model', url: 'https://example.com/blog/sample-model-7', points: 412, num_comments: 180, created_at: '2026-10-11T08:40:00Z', created_at_i: 1791794400, author: 'fictional_one', _tags: ['story', 'front_page'] },
    { objectID: '90000002', title: 'Whatever became of holography? (2011)', url: 'https://example.com/holography', points: 60, num_comments: 19, created_at: '2026-10-11T07:50:34Z', created_at_i: 1791791434, author: 'fictional_two', _tags: ['story'] },
    { objectID: '90000003', title: 'Ask HN: Which LLM do you use for coding?', url: null, points: 120, num_comments: 300, created_at: '2026-10-11T06:00:00Z', created_at_i: 1791784800, author: 'fictional_three', _tags: ['story', 'ask_hn'] },
    { objectID: '90000004', title: 'Show HN: An open source MCP server for spreadsheets', url: 'https://example.com/mcp-sheets', points: 45, num_comments: 12, created_at: '2026-10-11T09:00:00Z', created_at_i: 1791795600, author: 'fictional_four', _tags: ['story', 'show_hn'] },
  ],
  nbHits: 4,
  nbPages: 1,
  page: 0,
  hitsPerPage: 1000,
};

export const HF_MODELS = [
  { _id: '6aa8000000000000000001', id: 'samplelab/SampleModel-7-32B-Instruct', likes: 1712, trendingScore: 1579, downloads: 98829, tags: ['transformers'], pipeline_tag: 'text-generation', library_name: 'transformers', createdAt: '2026-10-08T14:53:42.000Z', modelId: 'samplelab/SampleModel-7-32B-Instruct' },
  { _id: '6aa8000000000000000002', id: 'unsloth/SampleModel-7-32B-Instruct-GGUF', likes: 300, trendingScore: 900, downloads: 5000, tags: ['gguf'], pipeline_tag: 'text-generation', library_name: 'gguf', createdAt: '2026-10-10T10:00:00.000Z', modelId: 'unsloth/SampleModel-7-32B-Instruct-GGUF' },
  { _id: '6aa8000000000000000003', id: 'examplecorp/embedder-2', likes: 120, trendingScore: 400, downloads: 1000, tags: ['sentence-transformers'], pipeline_tag: 'feature-extraction', library_name: 'sentence-transformers', createdAt: '2026-08-14T23:23:19.000Z', modelId: 'examplecorp/embedder-2' },
];

export const HF_SPACES = [
  { id: 'samplelab/SampleModel-7-demo', likes: 1421, trendingScore: 247, sdk: 'gradio', createdAt: '2026-10-09T23:23:19.000Z' },
  { id: 'bartowski/mirror-space', likes: 10, trendingScore: 20, sdk: 'gradio', createdAt: '2026-10-01T00:00:00.000Z' },
];

export const GITHUB = {
  total_count: 2,
  incomplete_results: false,
  items: [
    { full_name: 'exampleorg/agent-kit', html_url: 'https://github.com/exampleorg/agent-kit', description: 'A sample agent toolkit', stargazers_count: 2275, forks_count: 288, created_at: '2026-10-08T00:00:00Z', pushed_at: '2026-10-11T00:00:00Z', topics: ['llm', 'ai-agents'], owner: { login: 'exampleorg', type: 'Organization' } },
    { full_name: 'someone-new/tiny-mcp', html_url: 'https://github.com/someone-new/tiny-mcp', description: 'tiny', stargazers_count: 40, forks_count: 2, created_at: '2026-10-10T00:00:00Z', pushed_at: '2026-10-11T00:00:00Z', topics: ['mcp'], owner: { login: 'someone-new', type: 'User' } },
  ],
};

/** OpenAI-style RSS with CDATA titles. */
export const OPENAI_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Sample news</title>
<item><title><![CDATA[Introducing Sample Model 7]]></title><link>https://example.com/index/sample-model-7/</link><guid isPermaLink="false">sample-model-7</guid><pubDate>Sat, 11 Oct 2026 08:05:00 GMT</pubDate></item>
<item><title><![CDATA[Sample Corp cuts threat investigation time by 96% with Sample Daybreak]]></title><link>https://example.com/index/daybreak/</link><guid isPermaLink="false">daybreak</guid><pubDate>Fri, 10 Oct 2026 16:00:00 GMT</pubDate></item>
</channel></rss>`;

/** Mistral-style RSS on a single line. */
export const MISTRAL_RSS =
  '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Sample AI news</title><item><title>Introducing Mistral Large 4</title><link>https://example.com/news/large-4</link><guid>large-4</guid><pubDate>Sat, 11 Oct 2026 07:00:00 GMT</pubDate></item><item><title>Our partnership with a bank</title><link>https://example.com/news/bank</link><guid>bank</guid><pubDate>Thu, 09 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>';

export const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Sample blog</title>
<entry><title>Sample Model 7 is now available in the API</title><link href="https://example.com/blog/sample-model-7-api"/><id>tag:example.com,2026:1</id><updated>2026-10-11T10:00:00Z</updated></entry>
<entry><title>Notes from our offsite</title><link href="https://example.com/blog/offsite"/><id>tag:example.com,2026:2</id><updated>2026-10-01T10:00:00Z</updated></entry>
</feed>`;

export const ANTHROPIC_HTML = `<html><body><nav><a href="/news">News</a></nav>
<a href="/news/introducing-sample-model-7">Introducing Sample Model 7</a>
<a href="/news/sample-safety-update">Safety update</a>
<a href="/news/sample-partnership">Partnership</a>
<a href="/news/introducing-sample-model-7">dup</a>
</body></html>`;

export const META_HTML = `<html><body>
<a href="https://ai.meta.com/blog/sample-vision-2/">Sample Vision 2</a>
<a href="https://ai.meta.com/blog/sample-research-notes/">Notes</a>
<a href="https://ai.meta.com/research/">Research</a>
</body></html>`;

export const PAGEVIEWS = {
  items: [
    { project: 'en.wikipedia', article: 'Sample_Tool', granularity: 'daily', timestamp: '2026101000', access: 'all-access', agent: 'user', views: 47525 },
    { project: 'en.wikipedia', article: 'Sample_Tool', granularity: 'daily', timestamp: '2026100900', access: 'all-access', agent: 'user', views: 16929 },
  ],
};

export const OPENSEARCH = ['Sample Agent Kit', ['Sample Agent Kit (software)', 'Sample agent'], ['', ''], ['https://en.wikipedia.org/wiki/Sample_Agent_Kit_(software)', 'https://en.wikipedia.org/wiki/Sample_agent']];

export const TWEETS = [
  { id: '1900000000000000001', url: 'https://x.com/OpenAI/status/1900000000000000001', text: 'Introducing Sample Model 7, our most capable model yet.', createdAt: '2026-10-11T08:05:00.000Z', lang: 'en', likeCount: 5000, retweetCount: 900, replyCount: 300, quoteCount: 100, bookmarkCount: 50, author: { userName: 'OpenAI', id: '1', name: 'Sample Vendor', isVerified: true, followers: 1000000 } },
  { id: '1900000000000000002', url: 'https://x.com/fictional_dev/status/1900000000000000002', text: 'Trying sample model 7 right now, wild', createdAt: '2026-10-11T09:00:00.000Z', lang: 'en', likeCount: 40, retweetCount: 2, replyCount: 1, quoteCount: 0, bookmarkCount: 1, author: { userName: 'fictional_dev', id: '2', name: 'Fictional Dev', isVerified: false, followers: 1200 } },
  { id: '1900000000000000002', url: 'https://x.com/fictional_dev/status/1900000000000000002', text: 'duplicate', createdAt: '2026-10-11T09:00:00.000Z', author: { userName: 'fictional_dev' } },
];

export const PH_ACTOR = [
  { name: 'Sample Agent Kit', tagline: 'Agents for your spreadsheets', votes: 412, comments: 40, url: 'https://www.producthunt.com/posts/sample-agent-kit', topics: ['Artificial Intelligence', 'Productivity'], date: '2026-10-10', period: 'daily' },
  { name: 'Sample Plant Shop', tagline: 'Buy plants', votes: 500, comments: 20, url: 'https://www.producthunt.com/posts/sample-plant-shop', topics: ['E-Commerce'], date: '2026-10-10', period: 'daily' },
  { name: 'Sample Writer', tagline: 'An LLM that writes your emails', votes: 120, comments: 8, url: 'https://www.producthunt.com/posts/sample-writer', topics: ['Email'], date: '2026-10-10', period: 'daily' },
];

export const TIKTOK_CC = [
  { type: 'hashtag', country: 'US', period_days: 7, rank: 3, hashtag_name: 'chatgpt', hashtag_id: '111', industry: 'Tech', publish_count: 12000, video_views: 90000000, detail_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/chatgpt', scraped_at: '2026-10-11T09:00:00Z' },
  { type: 'hashtag', country: 'US', period_days: 7, rank: 9, hashtag_name: 'veo3', hashtag_id: '222', industry: 'Tech', publish_count: 3000, video_views: 20000000, detail_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/veo3', scraped_at: '2026-10-11T09:00:00Z' },
  { type: 'hashtag', country: 'US', period_days: 7, rank: 1, hashtag_name: 'fallfashion', hashtag_id: '333', industry: 'Apparel', publish_count: 90000, video_views: 900000000, detail_url: 'https://ads.tiktok.com/business/creativecenter/hashtag/fallfashion', scraped_at: '2026-10-11T09:00:00Z' },
];
