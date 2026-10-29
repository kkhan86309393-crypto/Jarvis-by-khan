const maxContextBytes = 18_000;

export function selectRecentChatContext(messages, maximumBytes = maxContextBytes) {
  const encoder = new TextEncoder();
  const selectedInReverse = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.kind || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      continue;
    }

    const candidateMessage = { role: message.role, content: message.content };
    const candidate = [...selectedInReverse, candidateMessage].reverse();
    if (encoder.encode(JSON.stringify({ messages: candidate })).byteLength > maximumBytes) break;
    selectedInReverse.push(candidateMessage);
  }

  return selectedInReverse.reverse();
}