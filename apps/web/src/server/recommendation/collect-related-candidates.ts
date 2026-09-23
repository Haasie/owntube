import type { AppDb } from "@/server/db/client";
import type { TaggedVideoCandidate } from "@/server/recommendation/collect-tagged-candidates";
import { deriveRecommendationReason } from "@/server/recommendation/reason";
import {
  type RecommendationScoreContext,
  scoreCandidateDetail,
} from "@/server/recommendation/scoring";
import type { UserSignals } from "@/server/recommendation/signals";
import {
  type TfidfModel,
  termFrequencyVector,
} from "@/server/recommendation/tfidf";
import type { ScoredVideo } from "@/server/recommendation/types";
import { fetchRelatedVideos } from "@/server/services/proxy";
import type { UnifiedVideo } from "@/server/services/proxy.types";

export type RelatedSeed = {
  videoId: string;
  rawScore: number;
  /**
   * The seed is something the user watched (or liked), not a pool member: it
   * is legitimately in the watched/excluded set and must still be expanded.
   */
  fromHistory?: boolean;
};

export type RelatedCollectionLimits = {
  maxSeeds: number;
  limitPerSeed: number;
  maxRelatedTotal: number;
  /**
   * Of `maxSeeds`, how many come from the user's own recent engaged watches
   * and likes (the rest are the pool's top-scored rows). Seeding from what was
   * actually watched grows the feed out of the user's real viewing — the
   * pool's own head is mostly keyword hits, so seeding only from it just
   * fetched "more of the same keyword". 0 / unset = pool seeds only.
   */
  maxHistorySeeds?: number;
};

export const HOME_RELATED_LIMITS: RelatedCollectionLimits = {
  maxSeeds: 10,
  maxHistorySeeds: 6,
  limitPerSeed: 12,
  maxRelatedTotal: 80,
};

/**
 * Deeper related-expansion for the personalized-only feed: with the trending
 * tail dropped, the pool leans harder on related videos to stay long, so more
 * seeds and a larger related cap replace that filler with actual discovery.
 * Costs more upstream related fetches per build (amortized by the 10-min pool
 * cache; watched seeds are usually already cached by the watch page), so it is
 * only used when the user opts into `personalizedFeedOnly`.
 */
export const HOME_RELATED_LIMITS_DEEP: RelatedCollectionLimits = {
  maxSeeds: 16,
  maxHistorySeeds: 10,
  // Deeper per seed: the one-year age cap discards roughly half of a related
  // list, and the fetch returns the same upstream page either way.
  limitPerSeed: 20,
  maxRelatedTotal: 160,
};

export const SHORTS_RELATED_LIMITS: RelatedCollectionLimits = {
  maxSeeds: 4,
  limitPerSeed: 8,
  maxRelatedTotal: 32,
};

const DEFAULT_CONCURRENCY = 4;
const RELATED_SEED_SCORE_BOOST = 0.06;

export type CollectRelatedVideoCandidatesOpts = RelatedCollectionLimits & {
  excludeVideoIds?: ReadonlySet<string>;
  /** Video ids already in the scored pool — skip duplicates. */
  excludeFromPool?: ReadonlySet<string>;
  concurrency?: number;
  filterVideo?: (video: UnifiedVideo) => boolean;
};

/**
 * Fetches upstream related videos for high-scoring seeds (Piped/Invidious via proxy cache).
 */
export async function collectRelatedVideoCandidates(
  db: AppDb,
  seeds: RelatedSeed[],
  opts: CollectRelatedVideoCandidatesOpts,
): Promise<TaggedVideoCandidate[]> {
  const {
    maxSeeds,
    limitPerSeed,
    maxRelatedTotal,
    excludeVideoIds = new Set<string>(),
    excludeFromPool = new Set<string>(),
    concurrency = DEFAULT_CONCURRENCY,
    filterVideo,
  } = opts;

  const pickedSeeds = seeds
    .filter(
      (s) =>
        s.videoId.length > 0 &&
        (s.fromHistory || !excludeVideoIds.has(s.videoId)),
    )
    .slice(0, maxSeeds);

  const seen = new Set<string>(excludeFromPool);
  const out: TaggedVideoCandidate[] = [];

  for (let i = 0; i < pickedSeeds.length; i += concurrency) {
    const batch = pickedSeeds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (seed) => {
        const result = await fetchRelatedVideos(
          db,
          { videoId: seed.videoId },
          limitPerSeed,
        );
        return { seed, videos: result.videos };
      }),
    );

    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      const { seed, videos } = item.value;
      for (const video of videos) {
        if (!video.videoId || video.videoId === seed.videoId) continue;
        if (seen.has(video.videoId) || excludeVideoIds.has(video.videoId)) {
          continue;
        }
        if (filterVideo && !filterVideo(video)) continue;
        seen.add(video.videoId);
        out.push({ video, source: `related:${seed.videoId}` });
        if (out.length >= maxRelatedTotal) return out;
      }
    }
  }

  return out;
}

export type RelatedExpansionStats = {
  seedCount: number;
  fetched: number;
  added: number;
};

export type ExpandScoredPoolWithRelatedOpts = {
  db: AppDb;
  scored: ScoredVideo[];
  coldStart: boolean;
  limits: RelatedCollectionLimits;
  excludeVideoIds: ReadonlySet<string>;
  signals: UserSignals;
  tasteModel: TfidfModel;
  dislikeModel?: TfidfModel;
  maxCh: number;
  scoreContext: RecommendationScoreContext;
  minScoredForExpansion?: number;
  filterVideo?: (video: UnifiedVideo) => boolean;
  /**
   * Videos the user recently engaged with (most relevant first) to seed
   * related expansion alongside the pool's head; capped by
   * `limits.maxHistorySeeds`. Ignored when that cap is 0 / unset.
   */
  historySeedVideoIds?: readonly string[];
};

/**
 * Seeds for one expansion: up to `maxHistorySeeds` of the user's own watches
 * first (they carry the full seed boost — nothing is a stronger signal than
 * what was actually watched), then the pool's top-scored rows fill the rest.
 */
export function pickRelatedSeeds(
  scored: readonly Pick<ScoredVideo, "videoId" | "rawScore">[],
  historySeedVideoIds: readonly string[],
  limits: Pick<RelatedCollectionLimits, "maxSeeds" | "maxHistorySeeds">,
): RelatedSeed[] {
  const topPoolScore = Math.max(...scored.map((s) => s.rawScore), 1e-9);
  const seeds: RelatedSeed[] = [];
  const seen = new Set<string>();
  const historyCap = Math.min(limits.maxSeeds, limits.maxHistorySeeds ?? 0);
  for (const videoId of historySeedVideoIds) {
    if (seeds.length >= historyCap) break;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    seeds.push({ videoId, rawScore: topPoolScore, fromHistory: true });
  }
  for (const s of scored) {
    if (seeds.length >= limits.maxSeeds) break;
    if (seen.has(s.videoId)) continue;
    seen.add(s.videoId);
    seeds.push({ videoId: s.videoId, rawScore: s.rawScore });
  }
  return seeds;
}

/**
 * Second pass: expand the scored pool with related videos from top seeds, re-score newcomers,
 * and apply a small boost tied to the parent seed score.
 */
export async function expandScoredPoolWithRelatedCandidates(
  opts: ExpandScoredPoolWithRelatedOpts,
): Promise<{ scored: ScoredVideo[]; stats: RelatedExpansionStats | null }> {
  const {
    db,
    scored,
    coldStart,
    limits,
    excludeVideoIds,
    signals,
    tasteModel,
    dislikeModel,
    maxCh,
    scoreContext,
    minScoredForExpansion = 8,
    filterVideo,
    historySeedVideoIds = [],
  } = opts;

  if (coldStart || scored.length < minScoredForExpansion) {
    return { scored, stats: null };
  }

  const poolIds = new Set(scored.map((s) => s.videoId));
  const seeds = pickRelatedSeeds(scored, historySeedVideoIds, limits);

  const maxSeedScore = Math.max(...seeds.map((s) => s.rawScore), 1e-9);
  const seedScoreById = new Map(seeds.map((s) => [s.videoId, s.rawScore]));

  const relatedTagged = await collectRelatedVideoCandidates(db, seeds, {
    ...limits,
    excludeVideoIds,
    excludeFromPool: poolIds,
    filterVideo,
  });

  if (relatedTagged.length === 0) {
    return {
      scored,
      stats: { seedCount: seeds.length, fetched: 0, added: 0 },
    };
  }

  const newRows: ScoredVideo[] = [];
  for (const { video, source } of relatedTagged) {
    const seedId = source.startsWith("related:")
      ? source.slice("related:".length)
      : "";
    const seedScore = seedScoreById.get(seedId) ?? 0;
    const detail = scoreCandidateDetail(
      video,
      signals,
      tasteModel,
      maxCh,
      scoreContext,
      dislikeModel,
    );
    const boost = RELATED_SEED_SCORE_BOOST * (seedScore / maxSeedScore);
    newRows.push({
      ...video,
      recommendationReason: deriveRecommendationReason(
        detail.breakdown,
        video,
        tasteModel,
        source,
      ),
      rawScore: detail.score + boost,
      scoreBreakdown: detail.breakdown,
      candidateSource: source,
      titleVector: termFrequencyVector(video.title),
    });
  }

  const merged = [...scored, ...newRows];
  merged.sort((a, b) => b.rawScore - a.rawScore);

  return {
    scored: merged,
    stats: {
      seedCount: seeds.length,
      fetched: relatedTagged.length,
      added: newRows.length,
    },
  };
}
