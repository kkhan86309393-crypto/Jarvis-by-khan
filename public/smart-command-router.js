function normalizeCommand(text) {
  return text
    .trim()
    .toLocaleLowerCase()
    .replace(/[?!.,،؛:]+$/u, '')
    .replace(/\s+/gu, ' ');
}

const commandPatterns = [
  {
    type: 'dashboard',
    patterns: [
      /^(?:open|show|go to|switch to) (?:the )?dashboard$/,
      /^(?:डैशबोर्ड|मुख्य पटल) (?:खोलो|खोलें|दिखाओ|दिखाएं)$/,
      /^(?:डैशबोर्ड|मुख्य पटल) पर जाओ$/,
    ],
  },
  {
    type: 'notes',
    patterns: [
      /^(?:open|show|go to) (?:my |saved )?notes?$/,
      /^(?:नोट्स?|मेरे नोट्स?) (?:खोलो|खोलें|दिखाओ|दिखाएं)$/,
      /^नोट्स? पर जाओ$/,
    ],
  },
  {
    type: 'tasks',
    patterns: [
      /^(?:open|show|go to) (?:my )?tasks?$/,
      /^(?:कार्य|टास्क|काम) (?:खोलो|खोलें|दिखाओ|दिखाएं)$/,
      /^(?:कार्य|टास्क|काम) पर जाओ$/,
    ],
  },
  {
    type: 'pending-tasks',
    patterns: [
      /^(?:show|list|view) (?:my )?(?:pending|incomplete|open) tasks?$/,
      /^(?:दिखाओ|दिखाएं|सूची दिखाओ) (?:मेरे )?(?:बाकी|अधूरे|लंबित) (?:काम|कार्य|टास्क)$/,
      /^(?:मेरे )?(?:बाकी|अधूरे|लंबित) (?:काम|कार्य|टास्क) दिखाओ$/,
    ],
  },
  {
    type: 'completed-tasks',
    patterns: [
      /^(?:show|list|view) (?:my )?(?:completed|done|finished) tasks?$/,
      /^(?:दिखाओ|दिखाएं|सूची दिखाओ) (?:मेरे )?(?:पूरे|पूर्ण|किए गए) (?:काम|कार्य|टास्क)$/,
      /^(?:मेरे )?(?:पूरे|पूर्ण|किए गए) (?:काम|कार्य|टास्क) दिखाओ$/,
    ],
  },
  {
    type: 'start-focus',
    patterns: [
      /^(?:start|resume|begin) (?:the )?focus timer$/,
      /^(?:फोकस टाइमर|ध्यान टाइमर) (?:शुरू करो|शुरू करें|चालू करो|फिर शुरू करो)$/,
    ],
  },
  {
    type: 'pause-focus',
    patterns: [
      /^(?:pause|stop) (?:the )?focus timer$/,
      /^(?:फोकस टाइमर|ध्यान टाइमर) (?:रोक दो|रोकें|विराम दो|विराम दें)$/,
    ],
  },
  {
    type: 'system-status',
    patterns: [
      /^(?:show|check|open) (?:the )?(?:system )?status$/,
      /^show system information$/,
      /^(?:सिस्टम|प्रणाली) (?:स्थिति|स्टेटस) (?:दिखाओ|दिखाएं|बताओ|बताएं)$/,
    ],
  },
];

export function parseSmartCommand(text) {
  if (typeof text !== 'string') return null;
  const command = normalizeCommand(text);
  if (!command) return null;

  for (const { type, patterns } of commandPatterns) {
    if (patterns.some((pattern) => pattern.test(command))) return { type };
  }

  const noteSearchPatterns = [
    /^(?:search|find|look up) (?:my |saved )?notes?(?: for| about| containing)?(?: (.+))?$/,
    /^(?:नोट्स? में खोजो|नोट्स? खोजो|नोट्स? ढूंढो)(?: (.+))?$/,
    /^(.+) नोट्स? में खोजो$/,
  ];
  for (const pattern of noteSearchPatterns) {
    const match = command.match(pattern);
    if (match) return { type: 'search-notes', query: (match[1] || '').trim() };
  }

  return null;
}
