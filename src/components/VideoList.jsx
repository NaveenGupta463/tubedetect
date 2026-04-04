import { useState } from 'react';
import { formatNum, calcEngagement, parseDuration, analyzeVideo } from '../utils/analysis';

const SORT_OPTIONS = [
  { key: 'date', label: 'Date' },
  { key: 'views', label: 'Views' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
];

function ScoreBadge({ score }) {
  const color =
    score >= 75 ? '#00c853' :
    score >= 55 ? '#ff9100' :
    score >= 40 ? '#ff6d00' : '#ff1744';
  return (
    <span className="score-badge" style={{ background: color + '22', color, border: `1px solid ${color}44` }}>
      {score}
    </span>
  );
}

export default function VideoList({ videos, onVideoSelect }) {
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filtered = videos.filter(v =>
    v.snippet?.title?.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    if (sortKey === 'date') {
      aVal = new Date(a.snippet?.publishedAt || 0).getTime();
      bVal = new Date(b.snippet?.publishedAt || 0).getTime();
    } else if (sortKey === 'views') {
      aVal = parseInt(a.statistics?.viewCount || 0);
      bVal = parseInt(b.statistics?.viewCount || 0);
    } else if (sortKey === 'engagement') {
      aVal = calcEngagement(a.statistics);
      bVal = calcEngagement(b.statistics);
    } else if (sortKey === 'likes') {
      aVal = parseInt(a.statistics?.likeCount || 0);
      bVal = parseInt(b.statistics?.likeCount || 0);
    } else if (sortKey === 'comments') {
      aVal = parseInt(a.statistics?.commentCount || 0);
      bVal = parseInt(b.statistics?.commentCount || 0);
    }
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
  });

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="sort-icon-neutral">↕</span>;
    return <span className="sort-icon-active">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="video-list">
      <div className="video-list-controls">
        <input
          type="text"
          className="search-filter"
          placeholder="Filter videos…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="sort-pills">
          <span className="sort-label">Sort:</span>
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              className={`sort-pill ${sortKey === opt.key ? 'sort-pill-active' : ''}`}
              onClick={() => handleSort(opt.key)}
            >
              {opt.label}
              {sortKey === opt.key && (
                <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="video-table">
          <thead>
            <tr>
              <th className="th-title">Video</th>
              <th className="th-num th-sortable" onClick={() => handleSort('views')}>
                Views <SortIcon col="views" />
              </th>
              <th className="th-num th-sortable" onClick={() => handleSort('likes')}>
                Likes <SortIcon col="likes" />
              </th>
              <th className="th-num th-sortable" onClick={() => handleSort('comments')}>
                Comments <SortIcon col="comments" />
              </th>
              <th className="th-num th-sortable" onClick={() => handleSort('engagement')}>
                Engagement <SortIcon col="engagement" />
              </th>
              <th className="th-num">Duration</th>
              <th className="th-num th-sortable" onClick={() => handleSort('date')}>
                Date <SortIcon col="date" />
              </th>
              <th className="th-num">Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(video => {
              const stats = video.statistics || {};
              const eng = calcEngagement(stats);
              const dur = parseDuration(video.contentDetails?.duration);
              const views = parseInt(stats.viewCount || 0);
              const likes = parseInt(stats.likeCount || 0);
              const comments = parseInt(stats.commentCount || 0);

              // Quick score estimate without full analysis
              const likeRate = views > 0 ? (likes / views) * 100 : 0;
              let quickScore = 50;
              if (likeRate > 4) quickScore += 15;
              else if (likeRate > 2) quickScore += 8;
              else if (likeRate < 0.5) quickScore -= 10;
              if (eng > 4) quickScore += 10;
              else if (eng < 1) quickScore -= 8;
              quickScore = Math.round(Math.max(10, Math.min(95, quickScore)));

              const publishDate = video.snippet?.publishedAt
                ? new Date(video.snippet.publishedAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })
                : '—';

              return (
                <tr
                  key={video.id}
                  className="video-row"
                  onClick={() => onVideoSelect(video)}
                >
                  <td className="td-video">
                    <img
                      src={video.snippet?.thumbnails?.default?.url || ''}
                      alt=""
                      className="video-thumb"
                      loading="lazy"
                    />
                    <span className="video-title">{video.snippet?.title}</span>
                  </td>
                  <td className="td-num">{formatNum(views)}</td>
                  <td className="td-num">{formatNum(likes)}</td>
                  <td className="td-num">{formatNum(comments)}</td>
                  <td className="td-num">
                    <span
                      style={{
                        color: eng > 4 ? '#00c853' : eng > 2 ? '#ff9100' : '#ff1744',
                        fontWeight: 600,
                      }}
                    >
                      {eng.toFixed(2)}%
                    </span>
                  </td>
                  <td className="td-num">{dur.formatted}</td>
                  <td className="td-num td-date">{publishDate}</td>
                  <td className="td-num">
                    <ScoreBadge score={quickScore} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="table-empty">No videos match your filter.</div>
        )}
      </div>
    </div>
  );
}
