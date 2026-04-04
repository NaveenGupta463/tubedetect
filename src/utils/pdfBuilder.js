import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { formatNum, calcEngagement, parseDuration, analyzeVideo } from './analysis';

const BRAND = '#cc0000';
const DARK  = '#111111';
const GRAY  = '#888888';
const LIGHT = '#f5f5f5';

function drawBar(doc, x, y, w, h, fillHex) {
  doc.setFillColor(fillHex);
  doc.rect(x, y, w, h, 'F');
}

function sectionHeader(doc, title, y) {
  doc.setFillColor(DARK);
  doc.rect(40, y, 515, 24, 'F');
  doc.setTextColor('#ffffff');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(title.toUpperCase(), 50, y + 15.5);
  doc.setTextColor(DARK);
  return y + 34;
}

function coverPage(doc, channel) {
  const { title, customUrl, description, thumbnails } = channel.snippet || {};
  const stats = channel.statistics || {};

  // Red header bar
  doc.setFillColor(BRAND);
  doc.rect(0, 0, 595, 90, 'F');

  doc.setTextColor('#ffffff');
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text('TubeIntel', 40, 45);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('YouTube Analytics Report', 40, 62);

  // Channel block
  doc.setTextColor(DARK);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(title || 'Channel Report', 40, 125);
  if (customUrl) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRAY);
    doc.text(customUrl, 40, 140);
  }

  // Stats strip
  const statItems = [
    ['Subscribers', formatNum(stats.subscriberCount)],
    ['Total Videos', formatNum(stats.videoCount)],
    ['Total Views', formatNum(stats.viewCount)],
  ];
  let sx = 40;
  doc.setFillColor(LIGHT);
  doc.rect(40, 155, 515, 50, 'F');
  statItems.forEach(([label, val]) => {
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(BRAND);
    doc.text(val, sx + 10, 178);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRAY);
    doc.text(label.toUpperCase(), sx + 10, 193);
    sx += 172;
  });

  // Description
  if (description) {
    doc.setFontSize(10);
    doc.setTextColor(GRAY);
    doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(description.slice(0, 300), 515);
    doc.text(lines.slice(0, 4), 40, 225);
  }

  // Date footer
  doc.setFillColor(LIGHT);
  doc.rect(0, 800, 595, 42, 'F');
  doc.setFontSize(9);
  doc.setTextColor(GRAY);
  doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}`, 40, 820);
  doc.text('tubeintel.app', 515, 820, { align: 'right' });
}

function topVideosPage(doc, videos) {
  doc.addPage();
  let y = 40;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK);
  doc.text('Video Performance', 40, y);
  y += 20;

  const rows = [...videos]
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, 15)
    .map(v => [
      (v.snippet?.title || '').slice(0, 48),
      formatNum(v.statistics?.viewCount),
      formatNum(v.statistics?.likeCount),
      formatNum(v.statistics?.commentCount),
      calcEngagement(v.statistics).toFixed(2) + '%',
      parseDuration(v.contentDetails?.duration).formatted,
    ]);

  doc.autoTable({
    startY: y,
    head: [['Title', 'Views', 'Likes', 'Comments', 'Engagement', 'Duration']],
    body: rows,
    headStyles: { fillColor: [204, 0, 0], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 8, textColor: DARK },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 190 },
      1: { cellWidth: 60, halign: 'right' },
      2: { cellWidth: 55, halign: 'right' },
      3: { cellWidth: 65, halign: 'right' },
      4: { cellWidth: 68, halign: 'right' },
      5: { cellWidth: 60, halign: 'right' },
    },
    margin: { left: 40, right: 40 },
  });
}

function viewsChartPage(doc, videos) {
  doc.addPage();
  let y = 40;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK);
  doc.text('Views Chart — Top 10 Videos', 40, y);
  y += 20;

  const top10 = [...videos]
    .sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))
    .slice(0, 10);

  const maxViews = Math.max(...top10.map(v => parseInt(v.statistics?.viewCount || 0)), 1);
  const chartX = 40;
  const chartMaxW = 360;
  const rowH = 28;

  top10.forEach((v, i) => {
    const views = parseInt(v.statistics?.viewCount || 0);
    const barW = Math.max(4, (views / maxViews) * chartMaxW);
    const rowY = y + i * rowH;

    // Label
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(DARK);
    const label = (v.snippet?.title || '').slice(0, 35);
    doc.text(label, chartX, rowY + 8);

    // Bar
    drawBar(doc, chartX, rowY + 11, barW, 12, BRAND);

    // Value
    doc.setFontSize(8);
    doc.setTextColor(GRAY);
    doc.text(formatNum(views), chartX + barW + 5, rowY + 21);
  });
}

function recommendationsPage(doc, videos, channel) {
  doc.addPage();
  let y = 40;
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(DARK);
  doc.text('Top Recommendations', 40, y);
  y += 14;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(GRAY);
  doc.text('Actionable insights based on your channel\'s data.', 40, y);
  y += 20;

  const avgViews = videos.length
    ? videos.reduce((s, v) => s + parseInt(v.statistics?.viewCount || 0), 0) / videos.length
    : 0;
  const avgEng = videos.length
    ? videos.reduce((s, v) => s + calcEngagement(v.statistics), 0) / videos.length
    : 0;

  const topVideo = [...videos].sort((a, b) => parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0))[0];
  const bottomVideo = [...videos].sort((a, b) => parseInt(a.statistics?.viewCount || 0) - parseInt(b.statistics?.viewCount || 0))[0];

  const recs = [
    {
      n: '01',
      title: 'Replicate Your Top Performer',
      body: topVideo
        ? `"${(topVideo.snippet?.title || '').slice(0, 60)}" is your best video with ${formatNum(topVideo.statistics?.viewCount)} views. Analyze its title pattern, thumbnail style, and hook — then create a series using the same formula.`
        : 'Identify your top performer and study its content formula.',
    },
    {
      n: '02',
      title: 'Improve Low-Engagement Videos',
      body: avgEng < 2
        ? `Your average engagement rate is ${avgEng.toFixed(2)}% — below the healthy 2% threshold. Add explicit CTAs ("Like if this helped"), end videos with a question, and ensure thumbnails match content.`
        : `Engagement at ${avgEng.toFixed(2)}% is healthy. Keep including interactive elements and strong CTAs.`,
    },
    {
      n: '03',
      title: 'Optimize Upload Schedule',
      body: 'Use the Best Time to Post feature to find which days and hours correlate with your highest view counts. Consistency signals health to the YouTube algorithm.',
    },
    {
      n: '04',
      title: 'Title A/B Testing',
      body: 'Test curiosity-gap titles ("I tried X for 30 days") against number-driven titles ("5 ways to X"). Track CTR changes in YouTube Studio for 48 hours post-upload.',
    },
    {
      n: '05',
      title: 'Competitor Gap Analysis',
      body: 'Use Competitor Comparison to find topics your niche covers that you haven\'t. First-mover advantage on trending topics can 3-5x typical view counts.',
    },
  ];

  recs.forEach(rec => {
    if (y > 720) { doc.addPage(); y = 40; }
    // Number
    doc.setFillColor(BRAND);
    doc.circle(51, y + 7, 9, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor('#ffffff');
    doc.text(rec.n, 51, y + 10, { align: 'center' });

    // Title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(DARK);
    doc.text(rec.title, 67, y + 8);

    // Body
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(GRAY);
    const lines = doc.splitTextToSize(rec.body, 490);
    doc.text(lines, 67, y + 20);
    y += 18 + lines.length * 13 + 8;

    // divider
    doc.setDrawColor('#eeeeee');
    doc.line(40, y, 555, y);
    y += 10;
  });
}

export function buildChannelReport(channel, videos) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  coverPage(doc, channel);
  topVideosPage(doc, videos);
  viewsChartPage(doc, videos);
  recommendationsPage(doc, videos, channel);

  const name = (channel.snippet?.title || 'channel').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  doc.save(`${name}-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}
