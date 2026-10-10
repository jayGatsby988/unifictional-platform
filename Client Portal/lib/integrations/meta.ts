import { dateStr, getJson } from "./types";

/**
 * Instagram professional account + Facebook Page via the Graph API, using a
 * long-lived Page access token stored per client (connected from the admin page).
 */

const G = "https://graph.facebook.com/v21.0";

export type IgProfile = { username?: string; followers_count?: number; media_count?: number };
export type IgInsights = { data?: { name: string; period?: string; values?: { value: number; end_time?: string }[]; total_value?: { value: number } }[] };
export type IgMedia = { data?: { id: string; caption?: string; media_type?: string; media_product_type?: string; timestamp: string; permalink?: string; like_count?: number; comments_count?: number; media_url?: string; thumbnail_url?: string }[] };
export type MediaInsights = { data?: { name: string; values?: { value: number }[] }[] };
export type FbPage = { name?: string; fan_count?: number; followers_count?: number; link?: string };

export function kindOf(m: { media_type?: string; media_product_type?: string }): "reel" | "carousel" | "image" | "story" {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_product_type === "STORY") return "story";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  return "image";
}

export function mapReachDaily(ins: IgInsights) {
  const reach = ins.data?.find((d) => d.name === "reach");
  return (reach?.values ?? []).map((v) => ({ date: (v.end_time ?? "").slice(0, 10), reach: v.value }));
}

export function sumMetric(ins: IgInsights, name: string) {
  const m = ins.data?.find((d) => d.name === name);
  if (m?.total_value) return m.total_value.value;
  return (m?.values ?? []).reduce((a, v) => a + v.value, 0);
}

export function mediaMetric(ins: MediaInsights, name: string) {
  return ins.data?.find((d) => d.name === name)?.values?.[0]?.value ?? 0;
}

export async function fetchInstagram(igUserId: string, token: string) {
  const since = Math.floor(new Date(dateStr(30)).getTime() / 1000);
  const until = Math.floor(Date.now() / 1000);
  const [profile, reach, visits, media] = await Promise.all([
    getJson<IgProfile>(`${G}/${igUserId}?fields=username,followers_count,media_count&access_token=${token}`),
    getJson<IgInsights>(`${G}/${igUserId}/insights?metric=reach&period=day&since=${since}&until=${until}&access_token=${token}`),
    getJson<IgInsights>(`${G}/${igUserId}/insights?metric=profile_views&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${token}`).catch(() => ({ data: [] }) as IgInsights),
    getJson<IgMedia>(`${G}/${igUserId}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count,media_url,thumbnail_url&limit=12&access_token=${token}`),
  ]);

  const posts = await Promise.all((media.data ?? []).map(async (m) => {
    const metrics = kindOf(m) === "story" ? "reach" : "reach,saved";
    const ins = await getJson<MediaInsights>(`${G}/${m.id}/insights?metric=${metrics}&access_token=${token}`).catch(() => ({ data: [] }) as MediaInsights);
    return {
      external_id: m.id, platform: "instagram" as const, kind: kindOf(m), caption: m.caption ?? "", media_url: m.thumbnail_url ?? m.media_url ?? null, permalink: m.permalink ?? null,
      posted_at: m.timestamp, status: "published" as const, likes: m.like_count ?? 0, comments: m.comments_count ?? 0, saves: mediaMetric(ins, "saved"), reach: mediaMetric(ins, "reach"),
    };
  }));

  const reachDaily = mapReachDaily(reach);
  const cutoff = dateStr(30);
  const engagement = posts.filter((p) => p.posted_at.slice(0, 10) >= cutoff);
  const interactions = engagement.reduce((a, p) => a + p.likes + p.comments + p.saves, 0);
  return {
    account: {
      platform: "instagram" as const, handle: profile.username ? `@${profile.username}` : "", url: profile.username ? `https://instagram.com/${profile.username}` : "",
      followers: profile.followers_count ?? 0, reach_30: reachDaily.reduce((a, r) => a + r.reach, 0), profile_visits_30: sumMetric(visits, "profile_views"),
      posts_30: engagement.length, engagement_rate: profile.followers_count ? +((interactions / engagement.length / profile.followers_count) * 100 || 0).toFixed(2) : 0,
    },
    reachDaily, posts,
  };
}

export async function fetchFacebookPage(pageId: string, token: string) {
  const since = Math.floor(new Date(dateStr(30)).getTime() / 1000);
  const until = Math.floor(Date.now() / 1000);
  const [page, reach] = await Promise.all([
    getJson<FbPage>(`${G}/${pageId}?fields=name,fan_count,followers_count,link&access_token=${token}`),
    getJson<IgInsights>(`${G}/${pageId}/insights?metric=page_impressions_unique&period=day&since=${since}&until=${until}&access_token=${token}`).catch(() => ({ data: [] }) as IgInsights),
  ]);
  const reach30 = (reach.data?.[0]?.values ?? []).reduce((a, v) => a + v.value, 0);
  return { platform: "facebook" as const, handle: page.name ?? "", url: page.link ?? `https://facebook.com/${pageId}`, followers: page.followers_count ?? page.fan_count ?? 0, reach_30: reach30, profile_visits_30: 0, posts_30: 0, engagement_rate: 0 };
}
