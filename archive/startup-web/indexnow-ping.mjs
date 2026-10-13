// Pings IndexNow (feeds Bing, DuckDuckGo, Yandex, Seznam, Naver) with every
// sitemap URL so new/changed pages get crawled fast. Google does not use
// IndexNow — that's what Search Console + sitemap submission are for.
// Key file: public/f94e185a579e5db6a8ed7603ce98ff6f.txt (must stay deployed).
// Run after deploying content changes: node indexnow-ping.mjs

const KEY = 'f94e185a579e5db6a8ed7603ce98ff6f'
const HOST = 'unifictional.com'

const sitemap = await (await fetch(`https://${HOST}/sitemap.xml`)).text()
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
if (urls.length === 0) {
  console.error('No URLs found in live sitemap — aborting')
  process.exit(1)
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  }),
})
console.log(`IndexNow: ${res.status} ${res.statusText} — submitted ${urls.length} urls for ${HOST}`)
if (!res.ok && res.status !== 202) process.exit(1)
