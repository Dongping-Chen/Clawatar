export interface EmotionResult {
  primary: string
  intensity: number
  animation?: string
  expression?: string
  expressionWeight?: number
}

interface EmotionPattern {
  keywords: RegExp
  animation: string
  expression: string
  expressionWeight: number
  priority: number  // higher = checked first (more specific patterns win)
}

// Ordered by specificity: specific emotions first, broad ones last
// All regexes use 'gi' flag for proper global match counting
const EMOTION_PATTERNS: Record<string, EmotionPattern> = {
  excited: {
    keywords: /\b(wow|amazing|incredible|omg|awesome|fantastic|brilliant)\b|太棒了|厉害|好厉害|不可思议/gi,
    animation: 'dm_18',
    expression: 'happy',
    expressionWeight: 0.9,
    priority: 9,
  },
  loving: {
    keywords: /\b(i love you|love you|darling|sweetheart|sweetie|honey|my dear)\b|爱你|亲爱的|喜欢你|么么|抱抱/gi,
    animation: 'dm_29',
    expression: 'happy',
    expressionWeight: 0.6,
    priority: 8,
  },
  angry: {
    keywords: /\b(angry|furious|hate this|so mad|pissed)\b|no!+|生气了|好烦|讨厌|气死/gi,
    animation: 'dm_14',
    expression: 'angry',
    expressionWeight: 0.7,
    priority: 8,
  },
  sad: {
    keywords: /\b(so sad|i'm sorry|miss you|crying|heartbroken|unfortunately)\b|好难过|伤心|想哭|哭了|对不起/gi,
    animation: 'dm_17',
    expression: 'sad',
    expressionWeight: 0.6,
    priority: 7,
  },
  shy: {
    keywords: /\b(blush|blushing|um+m|uh+h|well\.\.\.)\b|害羞|不好意思|那个那个|嗯嗯嗯|脸红/gi,
    animation: 'dm_40',
    expression: 'happy',
    expressionWeight: 0.3,
    priority: 7,
  },
  surprised: {
    keywords: /\b(what\?!|really\?!|oh my god|no way|whoa|holy)\b|真的吗[?!？！]|啊[?!？！]+|诶[?!？！]+|不会吧/gi,
    animation: 'dm_19',
    expression: 'surprised',
    expressionWeight: 0.7,
    priority: 6,
  },
  happy: {
    keywords: /\b(haha|hehe|lol|yay|great|wonderful|glad|happy)\b|哈哈|开心|好棒|嘻嘻|喜欢|太好了|高兴/gi,
    animation: 'dm_41',
    expression: 'happy',
    expressionWeight: 0.7,
    priority: 5,
  },
}

export function detectEmotion(text: string): EmotionResult {
  let bestMatch: string | null = null
  let bestScore = 0

  for (const [emotion, pattern] of Object.entries(EMOTION_PATTERNS)) {
    const matches = [...text.matchAll(pattern.keywords)]
    if (matches.length === 0) continue
    // Score = match count * priority (specific emotions win ties)
    const score = matches.length * pattern.priority
    if (score > bestScore) {
      bestScore = score
      bestMatch = emotion
    }
  }

  if (!bestMatch) {
    return { primary: 'neutral', intensity: 0.3 }
  }

  const p = EMOTION_PATTERNS[bestMatch]
  const exclamations = (text.match(/[!！]/g) || []).length
  const intensity = Math.min(1, 0.5 + exclamations * 0.1)

  return {
    primary: bestMatch,
    intensity,
    animation: p.animation,
    expression: p.expression,
    expressionWeight: p.expressionWeight * intensity,
  }
}
