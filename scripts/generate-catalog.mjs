import { readdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const animDir = join(__dirname, '..', 'public', 'animations')

const categoryKeywords = {
  emotion: ['angry', 'crying', 'defeat', 'happy', 'laughing', 'sad', 'terrified', 'thankful', 'victory', 'annoyed', 'relieved', 'loser', 'joyful'],
  gesture: ['arm stretching', 'clapping', 'crazy gesture', 'hand raising', 'happy hand gesture', 'head nod', 'looking around', 'nervously', 'no', 'pointing', 'shaking head', 'shrugging', 'thumbs up', 'waving', 'whatever gesture', 'weight shift', 'yawn', 'cocky', 'neck stretching', 'look around', 'flair', 'picking up', 'throw', 'leaning', 'quick formal bow', 'quick informal bow'],
  dance: ['dance', 'dancing', 'bellydancing', 'belly dance', 'bboy', 'breakdance', 'capoeira', 'chicken', 'hip hop', 'house', 'jazz', 'macarena', 'rumba', 'samba', 'shopping cart', 'silly', 'swing', 'thriller', 'tut', 'ymca', 'robot hip hop', 'butterfly twirl', 'catwalk'],
  idle: ['idle', 'standing greeting', 'sleeping'],
  movement: ['walking', 'running', 'run', 'jump', 'jumping', 'climbing', 'crouching', 'sneak', 'swimming', 'shuffling', 'crawl', 'landing', 'push up', 'jump push'],
  action: ['boxing', 'burpee', 'fishing', 'golf', 'kick', 'kettlebell', 'plank', 'push up', 'situps', 'typing', 'drinking', 'singing', 'praying', 'petting', 'batter', 'bicycle crunch', 'back squat', 'shoulder rubbing', 'torch inspect', 'rifle'],
  communication: ['talking', 'cheering', 'singing', 'thinking', 'talking on phone'],
}

function categorize(name) {
  const lower = name.toLowerCase()
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat
    }
  }
  return 'action'
}

function generateTags(name) {
  const clean = name.replace(/^\d+_/, '').replace(/_/g, ' ').toLowerCase()
  const tags = clean.split(/\s+/).filter(w => w.length > 2)
  tags.push(categorize(name))
  return [...new Set(tags)]
}

const files = readdirSync(animDir).filter(f => f.endsWith('.vrma')).sort()

const catalog = {
  animations: files.map(file => {
    const id = file.replace('.vrma', '')
    return {
      id,
      file,
      category: categorize(id),
      tags: generateTags(id),
    }
  })
}

const outPath = join(animDir, 'catalog.json')
writeFileSync(outPath, JSON.stringify(catalog, null, 2))
console.log(`Generated catalog with ${catalog.animations.length} animations → ${outPath}`)
