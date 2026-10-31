const maxContextBytes = 18_000;
const maxContextMessages = 24;

export function selectRecentChatContext(messages, maximumBytes = maxContextBytes) {
  const encoder = new TextEncoder();
  const eligibleMessages = [];

  for (const message of messages) {
    if (!message || message.kind || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      continue;
    }

    eligibleMessages.push({ role: message.role, content: message.content });
  }

  let newestUserIndex = -1;
  for (let index = eligibleMessages.length - 1; index >= 0; index -= 1) {
    if (eligibleMessages[index].role === 'user') {
      newestUserIndex = index;
      break;
    }
  }

  const selectedIndices = [];
  const serializedSize = (indices) => {
    const selected = indices
      .slice()
      .sort((left, right) => left - right)
      .map((index) => eligibleMessages[index]);
    return encoder.encode(JSON.stringify({ messages: selected })).byteLength;
  };

  if (newestUserIndex === -1) {
    for (let index = eligibleMessages.length - 1; index >= 0; index -= 1) {
      if (selectedIndices.length >= maxContextMessages) break;
      const candidate = [...selectedIndices, index];
      if (serializedSize(candidate) > maximumBytes) break;
      selectedIndices.push(index);
    }

    return selectedIndices
      .sort((left, right) => left - right)
      .map((index) => eligibleMessages[index]);
  }

  selectedIndices.push(newestUserIndex);
  if (serializedSize(selectedIndices) > maximumBytes) {
    return [];
  }

  for (let index = eligibleMessages.length - 1; index > newestUserIndex; index -= 1) {
    if (selectedIndices.length >= maxContextMessages) break;
    const candidate = [...selectedIndices, index];
    if (serializedSize(candidate) > maximumBytes) break;
    selectedIndices.push(index);
  }

  for (let index = newestUserIndex - 1; index >= 0; index -= 1) {
    if (selectedIndices.length >= maxContextMessages) break;
    const candidate = [...selectedIndices, index];
    if (serializedSize(candidate) > maximumBytes) break;
    selectedIndices.push(index);
  }

  return selectedIndices
    .sort((left, right) => left - right)
    .map((index) => eligibleMessages[index]);
}