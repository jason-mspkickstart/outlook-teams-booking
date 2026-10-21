// The admin page. Plain HTML and JS, no build step.
// Note: the script below deliberately avoids backticks and template placeholders.
export const ADMIN_HTML = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Booking admin</title>
<style>
:root {
  --bg: #f6f7f9; --card: #fff; --text: #1b1f24; --muted: #667085; --line: #e3e6ea;
  --accent: #2563eb; --accent-text: #fff; --danger: #c62828; --ok: #1b7f3b; --input: #fff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111418; --card: #1a1f25; --text: #e8eaed; --muted: #98a2b3; --line: #2b323a;
    --accent: #5b8def; --accent-text: #fff; --danger: #ef5350; --ok: #4caf50; --input: #12161b;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; max-width: 960px; margin: 0 auto; }
header h1 { font-size: 18px; margin: 0; }
header small { color: var(--muted); }
nav { display: flex; gap: 4px; overflow-x: auto; padding: 0 16px; max-width: 960px; margin: 0 auto; border-bottom: 1px solid var(--line); }
nav button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 10px 12px; color: var(--muted); font: inherit; cursor: pointer; white-space: nowrap; }
nav button.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
main { max-width: 960px; margin: 0 auto; padding: 16px; }
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; }
.bar p { margin: 0; color: var(--muted); font-size: 14px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.row .t { font-weight: 600; }
.row .s { color: var(--muted); font-size: 13px; word-break: break-word; }
.pill { font-size: 12px; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--line); color: var(--muted); }
.pill.off { color: var(--danger); border-color: var(--danger); }
.pill.good { color: var(--ok); border-color: var(--ok); }
button.btn { font: inherit; border-radius: 8px; padding: 7px 14px; border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.danger { color: var(--danger); }
button.link { background: none; border: 0; color: var(--accent); cursor: pointer; font: inherit; padding: 0; }
form { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
label.wide { grid-column: 1 / -1; }
label.check { flex-direction: row; align-items: center; gap: 8px; color: var(--text); }
input, select, textarea { font: inherit; color: var(--text); background: var(--input); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
textarea { min-height: 70px; resize: vertical; }
.hint { font-size: 12px; }
.actions { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
.hours { margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px; }
.hours h3 { font-size: 14px; margin: 0 0 8px; }
.hrow { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.hrow select { width: 90px; } .hrow input { width: 120px; }
.empty { color: var(--muted); text-align: center; padding: 24px; }
#toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: 8px; display: none; max-width: 90vw; }
#toast.err { background: var(--danger); color: #fff; }
</style>
</head>
<body>
<header><div><h1>Booking admin</h1><small id="who"></small></div></header>
<nav id="tabs"></nav>
<main id="main"><p class="empty">Loading...</p></main>
<div id="toast"></div>
<script>
var DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
var data = {};
var tab = 'meeting_types';
var editing = null;

function h(tag, attrs) {
  var el = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v == null ? '' : v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  });
  for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
  return el;
}
function add(el, c) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
  el.append(c instanceof Node ? c : document.createTextNode(String(c)));
}

function toast(msg, err) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(function () { t.style.display = 'none'; }, err ? 6000 : 2500);
}

function api(path, method, body) {
  return fetch('/admin/api/' + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Admin': '1' },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error(j.error || ('Error ' + r.status));
      return j;
    });
  });
}

function load() {
  return api('all').then(function (j) {
    data = j;
    document.getElementById('who').textContent = 'Signed in as ' + j.email;
    render();
  }).catch(function (e) { toast(e.message, true); });
}

function opts(list, val, lab, blank) {
  var o = list.map(function (r) { return [r[val], lab(r)]; });
  if (blank) o.unshift(['', blank]);
  return o;
}
function siteOpts() { return opts(data.sites || [], 'key', function (r) { return r.name; }); }
function schedOpts(blank) { return opts(data.schedules || [], 'key', function (r) { return r.name; }, blank); }
function typeOpts() { return opts(data.meeting_types || [], 'id', function (r) { return r.name + ' (' + r.site_key + ')'; }); }
function nameOf(list, key, val) { var r = (list || []).filter(function (x) { return String(x[key]) === String(val); })[0]; return r ? r.name : val; }

var DEF = {
  meeting_types: {
    title: 'Meeting types', table: 'meeting_types', pk: 'id',
    intro: 'What people can book on each site.',
    list: function () { return data.meeting_types; },
    label: function (r) { return r.name; },
    sub: function (r) { return nameOf(data.sites, 'key', r.site_key) + ' \\u00b7 ' + r.duration_mins + ' mins \\u00b7 ' + nameOf(data.schedules, 'key', r.schedule_key) + ' hours \\u00b7 /' + r.slug; },
    active: function (r) { return r.active; },
    blank: function () {
      var s = (data.sites || [])[0], sc = (data.schedules || [])[0];
      return { site_key: s ? s.key : '', schedule_key: sc ? sc.key : '', duration_mins: 30, buffer_before_mins: 0, buffer_after_mins: 15, min_notice_hours: 12, max_days_ahead: 30, slot_step_mins: 30, sort_order: 0, active: 1 };
    },
    fields: function () { return [
      { n: 'name', l: 'Name', hint: 'Shown to visitors, e.g. Intro call' },
      { n: 'slug', l: 'Slug', hint: 'Used in the API, e.g. intro' },
      { n: 'site_key', l: 'Site', t: 'select', o: siteOpts() },
      { n: 'schedule_key', l: 'Available hours', t: 'select', o: schedOpts() },
      { n: 'description', l: 'Description', t: 'textarea', wide: true },
      { n: 'duration_mins', l: 'Duration (mins)', t: 'number' },
      { n: 'slot_step_mins', l: 'Start times every (mins)', t: 'number', hint: 'e.g. 30 offers 9:00, 9:30, 10:00' },
      { n: 'buffer_before_mins', l: 'Buffer before (mins)', t: 'number' },
      { n: 'buffer_after_mins', l: 'Buffer after (mins)', t: 'number' },
      { n: 'min_notice_hours', l: 'Minimum notice (hours)', t: 'number' },
      { n: 'max_days_ahead', l: 'Bookable up to (days ahead)', t: 'number' },
      { n: 'daily_limit', l: 'Max per day', t: 'number', hint: 'Leave blank for no limit' },
      { n: 'sort_order', l: 'Sort order', t: 'number' },
      { n: 'invite_subject', l: 'Invite subject', wide: true, hint: 'Optional. Default: {meeting} with {name}' },
      { n: 'email_message', l: 'Email message', t: 'textarea', wide: true, hint: 'Optional. Shown in the confirmation email and the calendar invite. Leave a blank line between paragraphs.' },
      { n: '__vars', t: 'note', wide: true, text: 'Variables for the subject and message: {name} {email} {meeting} {duration} {when} {host} {site}' },
      { n: 'active', l: 'Active', t: 'check' }
    ]; }
  },
  sites: {
    title: 'Sites', table: 'sites', pk: 'key',
    intro: 'Each website that uses the booking API.',
    list: function () { return data.sites; },
    label: function (r) { return r.name; },
    sub: function (r) { return r.key + ' \\u00b7 ' + (r.allowed_origins || 'no domains yet'); },
    active: function (r) { return r.active; },
    blank: function () { return { active: 1 }; },
    fields: function () { return [
      { n: 'key', l: 'Site key', hint: 'Short ID the website sends, e.g. jasonparsons', lock: true },
      { n: 'name', l: 'Site name', hint: 'e.g. CaptiveFlow' },
      { n: 'host_name', l: 'Meeting is with', hint: 'e.g. Jason Parsons' },
      { n: 'allowed_origins', l: 'Allowed domains', t: 'textarea', wide: true, hint: 'Comma separated, no trailing slash. e.g. https://example.com,https://www.example.com,https://*.lovable.app' },
      { n: 'sender_email', l: 'Confirmation email from', hint: 'Blank to skip the confirmation email' },
      { n: 'sender_name', l: 'Sender name' },
      { n: 'logo_url', l: 'Logo URL', wide: true, hint: 'Optional. https link to a PNG or JPG, shown at the top of confirmation emails. About 200px wide works well.' },
      { n: 'manage_url', l: 'Manage booking page', wide: true, hint: 'Page on the site that handles ?token= for reschedule and cancel' },
      { n: 'active', l: 'Active', t: 'check' }
    ]; }
  },
  schedules: {
    title: 'Hours', table: 'schedules', pk: 'key',
    intro: 'Sets of available hours. Anything in your Outlook calendar is blocked automatically on top of these.',
    list: function () { return data.schedules; },
    label: function (r) { return r.name; },
    sub: function (r) {
      var hrs = (data.hours || []).filter(function (x) { return x.schedule_key === r.key; });
      return hrs.length ? hrs.map(function (x) { return DAYS[x.day] + ' ' + x.start_time + ' to ' + x.end_time; }).join(', ') : 'No hours set yet';
    },
    blank: function () { return { timezone: 'Europe/London' }; },
    fields: function () { return [
      { n: 'name', l: 'Name', hint: 'e.g. Consulting hours' },
      { n: 'key', l: 'Key', hint: 'e.g. consulting', lock: true },
      { n: 'timezone', l: 'Time zone', hint: 'e.g. Europe/London' }
    ]; },
    extra: function (r) { return r.key ? hoursEditor(r.key) : h('p', { class: 'hint' }, 'Save first, then add hours.'); }
  },
  blocked_dates: {
    title: 'Time off', table: 'blocked_dates', pk: 'id',
    intro: 'Dates with no bookings. Or just put it in your Outlook calendar as busy or out of office.',
    list: function () { return data.blocked_dates; },
    label: function (r) { return r.start_date === r.end_date ? r.start_date : r.start_date + ' to ' + r.end_date; },
    sub: function (r) { return (r.note || '') + (r.note ? ' \\u00b7 ' : '') + (r.schedule_key ? nameOf(data.schedules, 'key', r.schedule_key) : 'All hours'); },
    blank: function () { return { schedule_key: '' }; },
    fields: function () { return [
      { n: 'start_date', l: 'From', t: 'date' },
      { n: 'end_date', l: 'To', t: 'date' },
      { n: 'schedule_key', l: 'Applies to', t: 'select', o: schedOpts('All hours') },
      { n: 'note', l: 'Note' }
    ]; }
  },
  questions: {
    title: 'Questions', table: 'questions', pk: 'id',
    intro: 'Extra fields on the booking form, per meeting type. Name and email are always asked.',
    list: function () { return data.questions; },
    label: function (r) { return r.label; },
    sub: function (r) { return nameOf(data.meeting_types, 'id', r.meeting_type_id) + ' \\u00b7 ' + r.type + (r.required ? ' \\u00b7 required' : ''); },
    blank: function () { var t = (data.meeting_types || [])[0]; return { meeting_type_id: t ? t.id : '', type: 'text', required: 0, sort_order: 0 }; },
    fields: function () { return [
      { n: 'meeting_type_id', l: 'Meeting type', t: 'select', o: typeOpts() },
      { n: 'label', l: 'Question', hint: 'e.g. Company name' },
      { n: 'field_key', l: 'Field key', hint: 'e.g. company' },
      { n: 'type', l: 'Type', t: 'select', o: [['text', 'Short text'], ['textarea', 'Long text'], ['select', 'Dropdown']] },
      { n: 'options', l: 'Dropdown options', wide: true, hint: 'Only for dropdowns. Separate with |, e.g. 1|2 to 5|6+' },
      { n: 'sort_order', l: 'Sort order', t: 'number' },
      { n: 'required', l: 'Required', t: 'check' }
    ]; }
  }
};

function field(f, row) {
  var v = row[f.n];
  var locked = f.lock && row.__existing;
  var input;
  if (f.t === 'note') {
    return h('p', { class: 'hint wide', style: 'grid-column: 1 / -1; margin: 0' }, f.text);
  }
  if (f.t === 'check') {
    return h('label', { class: 'check' }, h('input', { type: 'checkbox', name: f.n, checked: v === 1 || v === true }), f.l);
  } else if (f.t === 'select') {
    input = h('select', { name: f.n }, f.o.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    input.value = v == null ? '' : v;
  } else if (f.t === 'textarea') {
    input = h('textarea', { name: f.n, value: v });
  } else {
    input = h('input', { name: f.n, type: f.t || 'text', value: v, disabled: locked });
  }
  return h('label', { class: f.wide ? 'wide' : '' }, f.l, input, f.hint ? h('span', { class: 'hint' }, f.hint) : null);
}

function editor(def, row) {
  var fields = def.fields();
  var form = h('form', {
    onsubmit: function (e) {
      e.preventDefault();
      var out = {};
      if (row[def.pk] != null && row.__existing) out[def.pk] = row[def.pk];
      fields.forEach(function (f) {
        if (f.t === 'note') return;
        var el = form.elements[f.n];
        out[f.n] = f.t === 'check' ? (el.checked ? 1 : 0) : el.value;
      });
      api(def.table, 'POST', out).then(function () { toast('Saved'); editing = null; return load(); })
        .catch(function (e) { toast(e.message, true); });
    }
  },
    fields.map(function (f) { return field(f, row); }),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
      h('button', { class: 'btn', type: 'button', onclick: function () { editing = null; render(); } }, 'Close'),
      row.__existing ? h('button', { class: 'btn danger', type: 'button', onclick: function () {
        if (!confirm('Delete this? It cannot be undone.')) return;
        api(def.table + '/' + encodeURIComponent(row[def.pk]), 'DELETE').then(function () { toast('Deleted'); editing = null; return load(); })
          .catch(function (e) { toast(e.message, true); });
      } }, 'Delete') : null
    )
  );
  return [form, def.extra && row.__existing ? def.extra(row) : null];
}

function hoursEditor(key) {
  var rows = (data.hours || []).filter(function (x) { return x.schedule_key === key; })
    .map(function (x) { return { day: x.day, start_time: x.start_time, end_time: x.end_time }; });
  var box = h('div', { class: 'hours' });
  function draw() {
    box.innerHTML = '';
    add(box, h('h3', {}, 'Weekly hours'));
    add(box, h('p', { class: 'hint' }, 'Add two rows on the same day for a lunch break.'));
    rows.forEach(function (r, i) {
      var day = h('select', { onchange: function (e) { r.day = Number(e.target.value); } },
        DAYS.slice(1).map(function (d, j) { return h('option', { value: j + 1 }, d); }));
      day.value = r.day;
      add(box, h('div', { class: 'hrow' }, day,
        h('input', { type: 'time', value: r.start_time, onchange: function (e) { r.start_time = e.target.value; } }),
        'to',
        h('input', { type: 'time', value: r.end_time, onchange: function (e) { r.end_time = e.target.value; } }),
        h('button', { class: 'link', type: 'button', onclick: function () { rows.splice(i, 1); draw(); } }, 'Remove')
      ));
    });
    add(box, h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: function () {
        var last = rows[rows.length - 1];
        rows.push({ day: last ? Math.min(last.day + 1, 7) : 1, start_time: last ? last.start_time : '09:00', end_time: last ? last.end_time : '17:00' });
        draw();
      } }, 'Add hours'),
      h('button', { class: 'btn primary', type: 'button', onclick: function () {
        api('hours/' + encodeURIComponent(key), 'PUT', { hours: rows }).then(function () { toast('Hours saved'); return load(); })
          .catch(function (e) { toast(e.message, true); });
      } }, 'Save hours')
    ));
  }
  draw();
  return box;
}

function renderList(def) {
  var list = def.list() || [];
  var main = h('div', {});
  add(main, h('div', { class: 'bar' }, h('p', {}, def.intro),
    h('button', { class: 'btn primary', onclick: function () { editing = { tab: tab, row: def.blank() }; render(); } }, 'Add')));
  if (editing && editing.tab === tab && !editing.row.__existing) {
    add(main, h('div', { class: 'card' }, h('div', { class: 't' }, 'New'), editor(def, editing.row)));
  }
  if (!list.length && !editing) add(main, h('p', { class: 'empty' }, 'Nothing here yet.'));
  list.forEach(function (r) {
    var open = editing && editing.tab === tab && editing.row.__existing && String(editing.row[def.pk]) === String(r[def.pk]);
    var off = def.active && !def.active(r);
    add(main, h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {}, h('div', { class: 't' }, def.label(r)), h('div', { class: 's' }, def.sub(r))),
        h('div', { class: 'row' },
          off ? h('span', { class: 'pill off' }, 'Off') : null,
          h('button', { class: 'link', onclick: function () {
            editing = open ? null : { tab: tab, row: Object.assign({ __existing: true }, r) }; render();
          } }, open ? 'Close' : 'Edit'))),
      open ? editor(def, editing.row) : null));
  });
  return main;
}

function renderBookings() {
  var list = data.bookings || [];
  var now = Date.now();
  var main = h('div', {});
  add(main, h('div', { class: 'bar' }, h('p', {}, 'Bookings from the last 30 days and everything coming up.')));
  if (!list.length) add(main, h('p', { class: 'empty' }, 'No bookings yet.'));
  var fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  list.forEach(function (b) {
    var answers = [];
    try { answers = JSON.parse(b.answers || '[]').filter(function (a) { return a.value; }); } catch (e) {}
    var upcoming = b.start_utc > now && b.status === 'confirmed';
    add(main, h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('div', {},
          h('div', { class: 't' }, fmt.format(new Date(b.start_utc)) + ' \\u00b7 ' + (b.meeting || 'Meeting')),
          h('div', { class: 's' }, b.name + ' \\u00b7 ' + b.email + ' \\u00b7 ' + nameOf(data.sites, 'key', b.site_key)),
          answers.map(function (a) { return h('div', { class: 's' }, a.label + ': ' + a.value); })),
        h('div', { class: 'row' },
          h('span', { class: 'pill ' + (b.status === 'confirmed' ? 'good' : 'off') }, b.status),
          upcoming ? h('button', { class: 'link', onclick: function () {
            if (!confirm('Cancel this meeting? ' + b.name + ' will get a cancellation from Outlook.')) return;
            api('bookings/' + encodeURIComponent(b.id) + '/cancel', 'POST', {}).then(function () { toast('Cancelled'); return load(); })
              .catch(function (e) { toast(e.message, true); });
          } }, 'Cancel') : null))));
  });
  return main;
}

var TABS = [['meeting_types', 'Meeting types'], ['sites', 'Sites'], ['schedules', 'Hours'], ['blocked_dates', 'Time off'], ['questions', 'Questions'], ['bookings', 'Bookings']];

function render() {
  var nav = document.getElementById('tabs');
  nav.innerHTML = '';
  TABS.forEach(function (t) {
    add(nav, h('button', { class: t[0] === tab ? 'on' : '', onclick: function () { tab = t[0]; editing = null; render(); } }, t[1]));
  });
  var main = document.getElementById('main');
  main.innerHTML = '';
  add(main, tab === 'bookings' ? renderBookings() : renderList(DEF[tab]));
}

load();
</script>
</body>
</html>`;
