import { useMemo, useState } from 'react';
import { formatNum } from '../utils/analysis';

export default function SeoTagAnalyzer({ videos }) {
  const [search, setSearch] = useState('');

  const { topTags, bottomTags, missingFromBottom, allTagsSorted } = useMemo(() => {
    if (!videos.length) return { topTags: [], bottomTags: [], missingFromBottom: [], allTagsSorted: [] };

    const sorted = [...videos].sort((a, b) =>
      parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)
    );
    const top    = sorted.slice(0, Math.ceil(sorted.length * 0.3));
    const bottom = sorted.slice(-Math.ceil(sorted.length * 0.3));

    const buildTagMap = (vids) => {
      const map = {};
      vids.forEach(v => {
        const tags  = v.snippet?.tags || [];
        const views = parseInt(v.statistics?.viewCount || 0);
        tags.forEach(t => {
          const key = t.toLowerCase();
          if (!map[key]) map[key] = { tag: t, count: 0, totalViews: 0 };
          map[key].count++;
          map[key].totalViews += views;
        });
      });
      return Object.values(map).map(t => ({ ...t, avgViews: t.count > 0 ? Math.round(t.totalViews / t.count) : 0 }));
    };

    const topTagMap    = buildTagMap(top);
    const bottomTagMap = buildTagMap(bottom);
    const bottomKeys   = new Set(bottomTagMap.map(t => t.tag.toLowerCase()));

    const topTagsSorted    = topTagMap.sort((a, b) => b.avgViews - a.avgViews);
    const bottomTagsSorted = bottomTagMap.sort((a, b) => b.count - a.count);
    const missingFromBottom = topTagsSorted.filter(t => !bottomKeys.has(t.tag.toLowerCase())).slice(0, 10);

    // All tags across all videos
    const allMap = buildTagMap(videos);
    const allTagsSorted = allMap.sort((a, b) => b.avgViews - a.avgViews);

    return {
      topTags:   topTagsSorted.slice(0, 20),
      bottomTags: bottomTagsSorted.slice(0, 20),
      missingFromBottom,
      allTagsSorted,
    };
  }, [videos]);

  const filtered = allTagsSorted.filter(t =>
    !search || t.tag.toLowerCase().includes(search.toLowerCase())
  );

  const maxViews = Math.max(...filtered.map(t => t.avgViews), 1);

  if (!videos.length) return <div className="empty-state">Load a channel to analyze SEO tags.</div>;

  return (
    <div className="feature-page">
      <div className="feature-header">
        <h2 className="feature-title">🏷️ SEO Tag Analyzer</h2>
        <p className="feature-desc">
          Compare tags from your top-performing vs low-performing videos. Find which tags drive views.
        </p>
      </div>

      {/* Top vs Bottom tags side by side */}
      <div className="two-col-grid">
        <div className="chart-card">
          <h3 className="chart-title" style={{ color: '#00c853' }}>✅ Top Performer Tags</h3>
          <p className="chart-subtitle">Tags from your top 30% videos by views</p>
          <div className="tag-table">
            {topTags.slice(0, 15).map(t => (
              <div key={t.tag} className="tag-row">
                <span className="tag-name">{t.tag}</span>
                <span className="tag-meta">{formatNum(t.avgViews)} avg views</span>
                <span className="tag-count">{t.count}× used</span>
              </div>
            ))}
          </div>
        </div>

        <div className="chart-card">
          <h3 className="chart-title" style={{ color: '#ff1744' }}>⚠️ Low Performer Tags</h3>
          <p className="chart-subtitle">Tags from your bottom 30% videos by views</p>
          <div className="tag-table">
            {bottomTags.slice(0, 15).map(t => (
              <div key={t.tag} className="tag-row">
                <span className="tag-name">{t.tag}</span>
                <span className="tag-meta">{formatNum(t.avgViews)} avg views</span>
                <span className="tag-count">{t.count}× used</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Missing tags from low performers */}
      {missingFromBottom.length > 0 && (
        <div className="chart-card">
          <h3 className="chart-title">🎯 High-Value Tags Missing from Low Performers</h3>
          <p className="chart-subtitle">
            These tags appear in your top videos but not your bottom ones — add them to future uploads.
          </p>
          <div className="missing-tags-grid">
            {missingFromBottom.map(t => (
              <div key={t.tag} className="missing-tag-chip">
                <span>{t.tag}</span>
                <span className="missing-tag-views">{formatNum(t.avgViews)} avg views</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full tag directory */}
      <div className="chart-card">
        <h3 className="chart-title">All Tags by Avg Views</h3>
        <input
          className="search-filter"
          placeholder="Filter tags…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 14 }}
        />
        <div className="tag-bars">
          {filtered.slice(0, 40).map(t => (
            <div key={t.tag} className="tag-bar-row">
              <span className="tag-bar-label">{t.tag}</span>
              <div className="perf-bar-bg" style={{ flex: 1 }}>
                <div
                  className="perf-bar-fill"
                  style={{
                    width: `${(t.avgViews / maxViews) * 100}%`,
                    background: t.avgViews > maxViews * 0.6 ? '#00c853' : t.avgViews > maxViews * 0.3 ? '#ff9100' : '#ff1744',
                  }}
                />
              </div>
              <span className="tag-bar-val">{formatNum(t.avgViews)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
