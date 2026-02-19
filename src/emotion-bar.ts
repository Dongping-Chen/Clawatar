import { requestAction } from './action-state-machine'
import { setExpression } from './expressions'
import { state } from './main'

type EmotionAction = {
  expression: string
  intensity: number
  actionId?: string
  randomActions?: string[]
}

const EMOTION_MAP: Record<string, EmotionAction> = {
  happy: {
    expression: 'happy',
    intensity: 0.92,
    actionId: '116_Happy Hand Gesture',
  },
  sad: {
    expression: 'sad',
    intensity: 0.95,
    actionId: '142_Sad Idle',
  },
  angry: {
    expression: 'angry',
    intensity: 0.92,
    actionId: '0_Angry',
  },
  surprised: {
    expression: 'surprised',
    intensity: 0.95,
    actionId: '129_Looking Around',
  },
  relaxed: {
    expression: 'relaxed',
    intensity: 0.76,
    actionId: '119_Idle',
  },
  dance: {
    expression: 'happy',
    intensity: 0.9,
    randomActions: [
      '105_Dancing',
      '143_Samba Dancing',
      '164_Ymca Dance',
      '41_Hip Hop Dancing',
      '70_Silly Dancing',
    ],
  },
}

export function initEmotionBar() {
  const bar = document.getElementById('emotion-bar')
  if (!bar) return

  bar.querySelectorAll<HTMLButtonElement>('[data-emotion]').forEach((button) => {
    button.addEventListener('click', () => {
      const emotion = button.dataset.emotion
      if (!emotion || !(emotion in EMOTION_MAP)) return

      applyEmotion(EMOTION_MAP[emotion])

      button.classList.remove('is-popping')
      void button.offsetWidth
      button.classList.add('is-popping')
    })
  })
}

function applyEmotion(cfg: EmotionAction) {
  setExpression(cfg.expression, cfg.intensity)

  if (!state.vrm || !state.mixer) return

  const actionId = cfg.actionId ?? pickRandom(cfg.randomActions)
  if (!actionId) return

  requestAction(actionId, {
    expression: { name: cfg.expression, weight: cfg.intensity },
  }).catch((err) => {
    console.warn('Emotion action failed:', err)
  })
}

function pickRandom(list?: string[]): string | undefined {
  if (!list || list.length === 0) return undefined
  return list[Math.floor(Math.random() * list.length)]
}
