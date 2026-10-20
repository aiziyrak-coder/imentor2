import json,sys
r=json.load(open(sys.argv[1]))
only=int(sys.argv[2]) if len(sys.argv)>2 else None
for k,x in enumerate(r['report']):
  if only is not None and k!=only: continue
  if 'deck' not in x: print('ERR',x); continue
  d=x['deck']; print('='*30, x['topic'][:70], '|', d['presentation_title'], len(d['slides']), f"{x['seconds']}s")
  for i,s in enumerate(d['slides']):
    b=s['body']; print(f"\n[{i+1}] {s['slide_type']}: {s['title']} / {s.get('subtitle') or ''}")
    for q in b.get('bullets') or []: print('  •',q)
    for q in b.get('stats') or []: print('  stat',q['number'],'—',q['label'])
    for c in b.get('columns') or []: print('  col',c['heading'],'::',' | '.join(c['points']))
    if b.get('comparison_headers'): print('  hdr',b['comparison_headers'])
    for rr in b.get('comparison_rows') or []: print('  row',rr['criteria'],'::',rr['left'],'||',rr['right'])
    for p in b.get('process_steps') or []: print('  step',p['step_number'],p['label'],'::',p['description'])
    if b.get('quote_text'): print('  quote',b['quote_text'],'—',b.get('quote_author'))
    if s.get('speaker_notes'): print('  NOTES:',s['speaker_notes'])
