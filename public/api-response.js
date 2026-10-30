function responseType(response) {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim();
  return contentType || 'unknown content type';
}

export async function readApiResponse(response) {
  let body;
  try {
    body = await response.text();
  } catch {
    throw new Error(`Could not read the server response (HTTP ${response.status}). Check the connection and server logs.`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    const type = responseType(response);
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status} with a non-JSON response (${type}). Check the server or hosting proxy logs.`);
    }
    throw new Error(`Server returned an unreadable response (HTTP ${response.status}, ${type}).`);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Server returned an invalid JSON response (HTTP ${response.status}, expected an object).`);
  }
  if (!response.ok) {
    const message = typeof data.error === 'string' && data.error.trim()
      ? data.error
      : 'The server request failed.';
    const code = typeof data.code === 'string' && data.code.trim() ? ` (${data.code})` : '';
    throw new Error(`HTTP ${response.status}${code}: ${message}`);
  }
  return data;
}

export function readChatReply(data) {
  if (typeof data?.reply !== 'string' || !data.reply.trim()) {
    throw new Error('The server returned a valid response but no usable AI reply. Check the server logs and provider response.');
  }
  return data.reply.trim();
}
