#!/usr/bin/env python3
"""Tags every trackable block in index.html with data-b="<section>.<n>" and writes
track-manifest.json (sections, blocks, click events) that the stats dashboard reads.
Safe to re-run: existing data-b attributes are stripped and regenerated in DOM order."""
import re, json, html, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
p = root / 'index.html'
s = p.read_text()
s = re.sub(r' data-b="[^"]*"', '', s)

SECTIONS = [('hero','Hero'),('summary','Summary'),('task1','Task 1 · Accounts Today'),('task2','Task 2 · your Journey'),
            ('process','How I worked'),('next','What’s next'),('contact','Contact')]
text = lambda frag: re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',frag))).strip()

# find section spans
marks = []
for sid,_ in SECTIONS:
    pass
if 'id="hero"' not in s: s = s.replace('<header class="hero">','<header class="hero" id="hero">',1)
# recompute after possible insert
marks = []
for sid,_ in SECTIONS:
    m = re.search(r'<(?:header|section)[^>]*id="%s"[^>]*>' % sid, s)
    marks.append(m.start())
marks.append(s.index('<footer>'))

PAT = [
 (r'<div class="meta">', 'meta', lambda f: 'Role · scope · output · workflow'),
 (r'<div class="card"[^>]*>', 'card', None),
 (r'<div class="big-idea">', 'idea', None),
 (r'<div class="eq">', 'eq', lambda f: 'Priority equation'),
 (r'<div class="stat">', 'stat', None),
 (r'<div class="frame">', 'frame', None),
 (r'<div class="iter">', 'iter', lambda f: 'Mood chart: 4 versions'),
 (r'<div class="about">', 'about', lambda f: 'About me card'),
 (r'<tr>(?=<td>)', 'row', None),
 (r'<li>', 'li', None),
 (r'<p class="kicker"[^>]*>', 'kicker', None),
]
# collect insertion points
pts = []
for pat, kind, lab in PAT:
    for m in re.finditer(pat, s):
        if m.start() < marks[0] or m.start() > marks[-1]: continue
        # snippet until a reasonable close for labelling
        snip = s[m.end(): m.end()+700]
        if kind=='row': label = text(snip.split('</td>')[0])
        elif kind=='card':
            b = re.search(r'<b[^>]*>(.*?)</b>|<span class="k">(.*?)</span>|<div class="big">(.*?)</div>', snip, re.S)
            label = text(next((g for g in b.groups() if g), '')) if b else text(snip)[:40]
            if not label or label.isdigit(): label = text(re.sub(r'<div class="num">.*?</div>','',snip))[:40]
        elif kind=='li':
            b = re.search(r'<b>(.*?)</b>', snip); label = text(b.group(1)) if b else text(snip)[:40]
        elif kind=='kicker': label = text(snip.split('</p>')[0])
        elif kind=='frame': label = 'Prototype · ' + text(snip.split('&nbsp;')[1].split('<a')[0]).replace(' · live prototype','') if '&nbsp;' in snip else 'Prototype'
        elif kind=='stat': label = text(snip.split('</div>')[0]) + ' stat'
        elif kind=='idea': label = 'Big idea: ' + text(snip.split('</div>')[0])[:48]
        else: label = lab(snip)
        pts.append((m.start(), m.end(), kind, label.strip()[:56]))
pts.sort()
out, blocks, last, counts = [], [], 0, {}
for st, en, kind, label in pts:
    si = max(i for i in range(len(SECTIONS)) if marks[i] <= st)
    sid = SECTIONS[si][0]
    n = counts[sid] = counts.get(sid, 0) + 1
    bid = f'{sid}.{n}'
    tag = s[st:en]
    tag = tag[:-1] + f' data-b="{bid}">' if not tag.endswith('/>') else tag
    out.append(s[last:st]); out.append(tag); last = en
    blocks.append({'id': bid, 'section': sid, 'kind': kind, 'label': label})
out.append(s[last:])
s = ''.join(out)
p.write_text(s)

labels = json.loads((root/'scripts'/'event-labels.json').read_text())
EVENTS = [{'code': k, 'label': v} for k, v in labels.items()]
manifest = {'sections': [{'id': i, 'label': l} for i, l in SECTIONS], 'blocks': blocks, 'events': EVENTS}
(root / 'track-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
print(len(blocks), 'blocks;', len(EVENTS), 'events')
