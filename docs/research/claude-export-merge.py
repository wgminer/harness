"""Merge a Claude.ai conversations.json export into a Harness app-state folder.
usage: merge.py <export conversations.json> <app-state dir> <backup dir> [--write]"""
import json,sys,os,re,collections,datetime,time,secrets,shutil
exp=json.load(open(sys.argv[1])); app=sys.argv[2]; bak=sys.argv[3]; WRITE='--write' in sys.argv
PLACEHOLDER=re.compile(r'\n?```\s*\nThis block is not supported on your current device yet\.\s*\n```\n?')
def text(m):
    # text blocks only: flat text on a message without them is leaked thinking
    blocks=m.get('content')
    if isinstance(blocks,list) and blocks:
        t='\n'.join(b['text'] for b in blocks if b.get('type')=='text' and b.get('text'))
    else:
        t=m.get('text') or ''
    return PLACEHOLDER.sub('\n',t).strip()
def ts(s): return int(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
def msgs(c):
    out=[]
    for m in c.get('chat_messages',[]):
        role={'human':'user','assistant':'assistant'}.get(m.get('sender'))
        t=text(m)
        if not role or not t: continue
        row={'content':t,'role':role,'timestamp':ts(m['created_at'])}
        if role=='assistant': row['model']='Claude'
        out.append(row)
    return out
def dump(path,obj):
    tmp=path+'.tmp-import'
    with open(tmp,'w') as f: json.dump(obj,f,indent=2,sort_keys=True,ensure_ascii=False)
    os.replace(tmp,path)
ipath=os.path.join(app,'conversations.json'); idx=json.load(open(ipath))
by_created=collections.defaultdict(list); have=set()
for cid,v in idx.items():
    by_created[v.get('createdAt')].append(cid)
    if v.get('claudeId'): have.add(v['claudeId'])
stat=collections.Counter(); differs=[]; writes={}; newidx={}
base=int(time.time()*1000)
for n,c in enumerate(sorted(exp,key=lambda c:c['created_at'])):
    em=msgs(c); created=ts(c['created_at']); cands=by_created.get(created,[])
    if cands:
        cid=cands[0]; meta=idx[cid]
        try: am=json.load(open(os.path.join(app,f'messages_{cid}.json')))
        except Exception: am=[]
        a=[(m.get('role'),m.get('content')) for m in am]; e=[(m['role'],m['content']) for m in em]
        if a==e: stat['already_present_identical']+=1
        elif len(e)>len(a) and e[:len(a)]==a: stat['refreshed_grew']+=1; writes[cid]=em
        else: stat['already_present_differs_left_alone']+=1; differs.append((cid,c['name'],len(a),len(e)))
        if meta.get('claudeId')!=c['uuid']:
            stat['id_backfilled']+=1; newidx[cid]={**meta,'claudeId':c['uuid'],'isFromClaude':True}
            if em and not meta.get('hasMessages'): newidx[cid]['hasMessages']=True
            if any(m['role']=='assistant' for m in em) and cid in writes: newidx[cid]['hasAssistantReply']=True
        continue
    if not em: stat['skipped_no_text']+=1; continue
    cid='conv_%d_%s'%(base+n,secrets.token_hex(4))
    meta={'claudeId':c['uuid'],'createdAt':created,'hasMessages':True,'isFromClaude':True,'sessionKind':'chat'}
    if (c.get('name') or '').strip(): meta['title']=c['name'].strip(); meta['titleSource']='imported'
    else: meta['title']=None; stat['new_untitled']+=1
    if any(m['role']=='assistant' for m in em): meta['hasAssistantReply']=True
    newidx[cid]=meta; writes[cid]=em; stat['new']+=1; stat['new_messages']+=len(em)
print(dict(stat)); print('differs',differs)
print('index',len(idx),'->',len({**idx,**newidx}))
if WRITE:
    os.makedirs(bak,exist_ok=True); shutil.copy2(ipath,os.path.join(bak,'conversations.json'))
    for cid in writes:
        p=os.path.join(app,f'messages_{cid}.json')
        if os.path.exists(p): shutil.copy2(p,bak)
    for cid,em in writes.items(): dump(os.path.join(app,f'messages_{cid}.json'),em)
    idx.update(newidx); dump(ipath,idx); print('written; backup in',bak)
