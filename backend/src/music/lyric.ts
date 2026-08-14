import type { LyricLine, Lyrics } from './types'

const TIME_TAG = /\[[0-9]+(?:\.[0-9]+)?:[0-9]+(?:\.[0-9]+)?\]/g

export function parseLyrics(raw: string, lang = 'und'): Lyrics {
  const tmp = new Map<number, LyricLine>()
  for (const line of raw.split(/\r?\n/)) {
    const tags = line.match(TIME_TAG) ?? []
    if (!tags.length) continue
    const lyric = line.replace(TIME_TAG, '').replace(/\r$/, '')
    for (const tag of tags) {
      const inner = tag.slice(1, -1)
      const sep = inner.indexOf(':')
      if (sep < 0) continue
      const minutes = Number(inner.slice(0, sep))
      const seconds = Number(inner.slice(sep + 1))
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue
      const time = minutes * 60 + seconds
      tmp.set(time, { time, lyric })
    }
  }
  const content = [...tmp.values()].sort((a, b) => a.time - b.time)
  if (!content.length) content.push({ time: 0, lyric: '' })
  content.push({ time: content[content.length - 1].time + 5, lyric: '' })
  content.push({ time: 99999999999, lyric: '' })
  return { lang, content }
}

export function findLyricIndex(lyrics: Lyrics, time: number): number {
  const lines = lyrics.content
  if (lines.length < 2) return -1
  let start = 0
  let end = lines.length - 1
  while (start < end) {
    const mid = Math.floor((start + end) / 2)
    if (lines[mid].time <= time && time < lines[mid + 1].time) return mid
    if (lines[mid].time > time) end = mid
    else start = mid + 1
  }
  return -1
}

export function findLyric(lyrics: Lyrics, time: number): LyricLine {
  const index = findLyricIndex(lyrics, time)
  return index < 0 ? { time: 0, lyric: '' } : lyrics.content[index]
}

export function lyricsToLrc(lyrics: Lyrics): string {
  return lyrics.content
    .filter((line) => line.time < 1e10)
    .map((line) => {
      const minutes = Math.floor(line.time / 60)
      const seconds = (line.time - minutes * 60).toFixed(2).padStart(5, '0')
      return `[${String(minutes).padStart(2, '0')}:${seconds}]${line.lyric}`
    })
    .join('\n')
}
