const { createDefaultRegistry } = require('../dist/music/registry')

async function main() {
  const registry = createDefaultRegistry()
  const source = process.argv[2] || 'kuwo'
  const keyword = process.argv[3] || '晴天'
  const results = await registry.search(keyword, source, 1, 3)
  console.log(JSON.stringify(results.map((item) => ({
    title: item.title,
    artist: item.artist,
    id: item.meta.identifier,
    source: item.meta.provider,
    duration: item.duration,
  })), null, 2))
  if (!results.length) throw new Error('no search results')
  console.log('phase3 search smoke ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
