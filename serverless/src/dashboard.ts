/** Static dashboard shell — fetches /api/events client-side and renders it. */
export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Bellingham Events</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 780px; margin: 0 auto; padding: 24px 16px 64px; background: #fafafa; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #121212; color: #eee; } .card { background: #1e1e1e !important; border-color: #333 !important; } .meta, .badge { color: #999 !important; } input, select { background: #1e1e1e !important; color: #eee !important; border-color: #444 !important; } }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
  .controls { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  input, select { padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; font-size: 14px; }
  input[type="search"] { flex: 1; min-width: 160px; }
  .day-heading { font-size: 15px; font-weight: 600; margin: 24px 0 8px; }
  .card { display: block; border: 1px solid #ddd; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; background: #fff; text-decoration: none; color: inherit; }
  .card:hover { border-color: #888; }
  .title { font-weight: 600; font-size: 15px; }
  .meta { color: #666; font-size: 13px; margin-top: 3px; }
  .badge { display: inline-block; font-size: 11px; color: #888; border: 1px solid currentColor; border-radius: 999px; padding: 1px 8px; margin-left: 6px; }
  .empty, .error { color: #888; padding: 24px 0; }
  .error { color: #c0392b; }
</style>
</head>
<body>
  <h1>Bellingham Events</h1>
  <div class="sub" id="generated-at">Loading…</div>
  <div class="controls">
    <input type="search" id="search" placeholder="Search title or venue…" />
    <select id="source-filter"><option value="">All sources</option></select>
  </div>
  <div id="content"><div class="empty">Loading events…</div></div>

<script>
  let allEvents = [];

  function fmtDay(iso) {
    return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function fmtTime(ev) {
    if (ev.allDay) return 'All day';
    return new Date(ev.startDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function render() {
    const q = document.getElementById('search').value.trim().toLowerCase();
    const src = document.getElementById('source-filter').value;
    const filtered = allEvents.filter(e => {
      const matchesQ = !q || e.title.toLowerCase().includes(q) || (e.venueName || '').toLowerCase().includes(q);
      const matchesSrc = !src || e.sourceName === src;
      return matchesQ && matchesSrc;
    });

    const content = document.getElementById('content');
    if (!filtered.length) {
      content.innerHTML = '<div class="empty">No events match.</div>';
      return;
    }

    let html = '';
    let lastKey = null;
    for (const e of filtered) {
      const key = dayKey(e.startDateTime);
      if (key !== lastKey) {
        html += '<div class="day-heading">' + fmtDay(e.startDateTime) + '</div>';
        lastKey = key;
      }
      html += '<a class="card" href="' + escapeHtml(e.url) + '" target="_blank" rel="noopener">' +
        '<div class="title">' + escapeHtml(e.title) + '</div>' +
        '<div class="meta">' + fmtTime(e) + (e.venueName ? ' &middot; ' + escapeHtml(e.venueName) : '') +
        '<span class="badge">' + escapeHtml(e.sourceName) + '</span></div>' +
        '</a>';
    }
    content.innerHTML = html;
  }

  async function load() {
    try {
      const res = await fetch('/api/events');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      allEvents = data.events || [];

      const sources = [...new Set(allEvents.map(e => e.sourceName))].sort();
      const sel = document.getElementById('source-filter');
      for (const s of sources) {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        sel.appendChild(opt);
      }

      document.getElementById('generated-at').textContent =
        allEvents.length + ' upcoming events · last updated ' + new Date(data.generatedAt).toLocaleString();

      render();
    } catch (err) {
      document.getElementById('content').innerHTML = '<div class="error">Failed to load events: ' + err.message + '</div>';
      document.getElementById('generated-at').textContent = '';
    }
  }

  document.getElementById('search').addEventListener('input', render);
  document.getElementById('source-filter').addEventListener('change', render);
  load();
</script>
</body>
</html>`;
}
