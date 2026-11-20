// Maps Search Console / Google API errors to { status, error, message } for routes.
export function mapGscError(err, where) {
  const code = Number(err?.code || err?.response?.status);
  const message = err?.response?.data?.error?.message || err?.message || 'Search Console request failed';
  console.error(`[${where}]`, code || '', message);
  if (/invalid_grant/i.test(message)) {
    return { status: 401, error: 'gsc_not_connected', message: 'The Search Console connection expired. Reconnect it.' };
  }
  if (code === 403) return { status: 403, error: 'no_access', message };
  if (code === 429) return { status: 429, error: 'quota', message };
  if (code === 400) return { status: 400, error: 'bad_params', message };
  return { status: 502, error: 'gsc_error', message };
}
