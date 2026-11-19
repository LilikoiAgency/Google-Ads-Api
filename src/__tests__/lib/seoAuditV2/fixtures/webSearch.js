// Response shapes for the web search tool call, per the Claude API docs.
const usage = (searches = 2) => ({
  input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  server_tool_use: { web_search_requests: searches },
});

const call = (id, query) => ({ type: 'server_tool_use', id, name: 'web_search', input: { query } });
const result = (url, title) => ({ type: 'web_search_result', url, title, page_age: 'May 1, 2026', encrypted_content: 'enc' });

export const okResponse = {
  model: 'claude-opus-5-5',
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '' },
    call('srvtoolu_1', 'turf installation austin'),
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_1',
      content: [
        result('https://www.acme.com/turf', 'Turf installation | Acme'),
        result('https://rival.com/', 'Rival Turf'),
        result('https://www.yelp.com/search?q=turf', 'Best turf in Austin - Yelp'),
      ],
    },
    call('srvtoolu_2', 'artificial grass cost austin'),
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_2',
      content: [result('https://rival.com/cost', 'Turf cost'), result('https://notacme.com/', 'Not Acme')],
    },
    { type: 'text', text: 'Query 1: Acme appears. ' },
    { type: 'text', text: 'Query 2: Acme does not appear.' },
  ],
  usage: usage(2),
};

export const errorResultResponse = {
  ...okResponse,
  content: okResponse.content.map((b) => (b.tool_use_id === 'srvtoolu_2'
    ? { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }
    : b)),
};

export const pauseResponse = {
  model: 'claude-opus-5-5',
  stop_reason: 'pause_turn',
  content: [
    call('srvtoolu_1', 'turf installation austin'),
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [result('https://acme.com/turf', 'Turf | Acme')] },
  ],
  usage: usage(1),
};

export const pauseThenOk = [
  pauseResponse,
  {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [
      call('srvtoolu_2', 'artificial grass cost austin'),
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: [result('https://rival.com/cost', 'Turf cost')] },
      { type: 'text', text: 'Done.' },
    ],
    usage: usage(1),
  },
];
