import sys, re
f=sys.argv[1]; a=int(sys.argv[2]); b=int(sys.argv[3]); w=int(sys.argv[4]) if len(sys.argv)>4 else 230
L=open(f,encoding='utf-8',errors='replace').read().split('\n')
inblock=False
for i,l in enumerate(L[:b], start=1):
    s=l.strip()
    # track block comments that start a line
    if inblock:
        if '*/' in s: inblock=False
        continue
    if s.startswith('/*') and '*/' not in s: inblock=True; continue
    if s.startswith('/*') and s.endswith('*/'): continue
    if not s or s.startswith('//') or s.startswith('*'): continue
    if i < a: continue
    code=re.sub(r'\s*/\*.*?\*/\s*$', '', l.rstrip())
    print('%5d %s' % (i, code[:w]))
