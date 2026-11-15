# Keys the hand-painted sumi-e source images (ink on white paper) to transparency,
# un-blending edge colours so there are no halos, crops them, records anchors
# (feet, sash, beads, head) and packs the webp atlases + atlas.json in assets/art/.
# Usage: python3 tools/build_atlas.py <dir with a_*.jpg, e<k>_*.jpg, fx_*.jpg>
import numpy as np, json, glob, os
from PIL import Image
from scipy import ndimage as ndi

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SRC=sys.argv[1] if len(sys.argv) > 1 else 'art-src'
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'art')
os.makedirs(OUT, exist_ok=True)

def disk(r):
    y,x=np.ogrid[-r:r+1,-r:r+1]; return x*x+y*y<=r*r

from keying import key_array
from keying import drop_paper
def key(path, report=None):
    src = Image.open(path).convert('RGB')
    rgba = key_array(src, report, os.path.basename(path))
    # second pass: paper flecks left in the ground splash under the feet. Only the
    # bottom of each figure is touched so painted white robes/feathers stay intact.
    ys = np.where(rgba[..., 3].max(axis=1) > 20)[0]
    if len(ys) and not os.path.basename(path).startswith('fx_'):
        y0, y1 = ys.min(), ys.max(); h = y1 - y0
        b = os.path.basename(path)
        if b.startswith('a_') or b.startswith('d_') or b.startswith('s_') or b.split('_')[0] in ('e0', 'e1', 'e2', 'e3', 'e4', 'e7', 'e8', 'e11'):
            # figures with no painted-white cloth/feathers (the Asura, ashigaru, ninja,
            # kappa, ronin, samurai, oni, oni warlord, orochi): paper pockets trapped between hair
            # strands, sash tails and motion swirls go everywhere (dense face/teeth stay)
            rgba = drop_paper(rgba, src)
        else:
            rgba = drop_paper(rgba, src, band=(y1 - 0.16 * h, y1 - 0.08 * h))
    if os.path.basename(path).startswith('s_'):
        # the Sorcerer's painted energy can run off the canvas: fade it out over the
        # last 70 px so a burst never ends in a hard straight cut
        hh, ww = rgba.shape[:2]; yy, xx = np.mgrid[0:hh, 0:ww]
        edge = np.minimum(np.minimum(xx, ww - 1 - xx), np.minimum(yy, hh - 1 - yy)).astype(np.float32)
        rgba = rgba.copy(); rgba[..., 3] = (rgba[..., 3] * np.clip(edge / 70.0, 0, 1)).astype(np.uint8)
    return Image.fromarray(rgba,'RGBA')

def crop(img,pad=4):
    a=np.asarray(img)[...,3]
    ys,xs=np.where(a>10)
    x0,x1,y0,y1=max(0,xs.min()-pad),min(a.shape[1],xs.max()+pad+1),max(0,ys.min()-pad),min(a.shape[0],ys.max()+pad+1)
    return img.crop((x0,y0,x1,y1)),(x0,y0)

def red_mask(img):
    a=np.asarray(img).astype(np.int32); r,g,b,al=a[...,0],a[...,1],a[...,2],a[...,3]
    return (al>128)&(r>95)&(r>g*1.6)&(r>b*1.5)

def blue_mask(img):
    a=np.asarray(img).astype(np.int32); r,g,b,al=a[...,0],a[...,1],a[...,2],a[...,3]
    return (al>128)&(b>110)&(b>r*1.6)&(b>g*1.25)

def purple_mask(img):
    a=np.asarray(img).astype(np.int32); r,g,b,al=a[...,0],a[...,1],a[...,2],a[...,3]
    return (al>128)&(b>90)&(b>g*1.45)&(r>g*1.15)

def baseline(img):
    a=np.asarray(img)[...,3]>128
    rows=np.where(a.sum(axis=1)>3)[0]
    return int(rows.max())

frames={}
def add(name,img,ax,ay,extra=None):
    frames[name]={'img':img,'ax':ax,'ay':ay,**(extra or {})}

# ---------------- Asura poses: uniform scale, anchor at sash x / feet baseline
S_A=0.40
for p in sorted(glob.glob(SRC+'/a_*.jpg')):
    name=os.path.basename(p)[2:-4]
    k=key(p); k=k.resize((round(k.width*S_A),round(k.height*S_A)),Image.LANCZOS)
    c,_=crop(k)
    rm=red_mask(c); ys,xs=np.where(rm)
    # split red into sash (lower, larger) and beads (upper) by y gap
    order=np.sort(ys); gaps=np.diff(order); cut=order[np.argmax(gaps)] if len(gaps) else order.mean()
    lo=ys>cut; hi=~lo
    if lo.sum()<hi.sum()*0.3: lo=ys>np.median(ys); hi=~lo
    sash=(float(xs[lo].mean()),float(ys[lo].mean())); beads=(float(xs[hi].mean()),float(ys[hi].mean()))
    by=baseline(c)
    add('A_'+name,c,sash[0],by,{'sash':sash,'beads':beads,'head':(beads[0]+4,beads[1]-(sash[1]-beads[1])*0.35)})

# ---------------- Daeva poses: same pipeline, blue accents (sash below, beads above)
for p in sorted(glob.glob(SRC+'/d_*.jpg')):
    name=os.path.basename(p)[2:-4]
    k=key(p); k=k.resize((round(k.width*S_A*0.97),round(k.height*S_A*0.97)),Image.LANCZOS)
    c,_=crop(k)
    bm=blue_mask(c); al=np.asarray(c)[...,3].astype(np.float32)/255
    by=baseline(c); rows=np.where(al.max(axis=1)>0.5)[0]; top=rows.min(); hh=by-top
    # torso column: alpha-weighted median x of the dense waist band (sash tails,
    # hair and kicking legs pull a plain centroid sideways)
    band=al[int(top+hh*0.40):int(top+hh*0.58)]*(al[int(top+hh*0.40):int(top+hh*0.58)]>0.8)
    colw=band.sum(axis=0); cs=np.cumsum(colw); tx=float(np.searchsorted(cs,cs[-1]/2))
    ys,xs=np.where(bm)
    near=np.abs(xs-tx)<c.width*0.14
    lo=(ys>top+hh*0.38)&(ys<top+hh*0.66)&near
    hi=(ys>top+hh*0.12)&(ys<=top+hh*0.38)&near
    sy=float(np.median(ys[lo])) if lo.sum()>30 else top+hh*0.5
    ny=float(np.median(ys[hi])) if hi.sum()>20 else top+hh*0.3
    nx=float(np.median(xs[hi])) if hi.sum()>20 else tx
    sash=(tx,sy); beads=(nx,ny)
    add('D_'+name,c,sash[0],by,{'sash':sash,'beads':beads,'head':(beads[0]+4,beads[1]-(sash[1]-beads[1])*0.35)})

# ---------------- Sorcerer poses: same pipeline, purple accents (sash below, beads above).
# He is painted taller and the energy bursts widen the canvas, so the scale comes
# from the idle figure's height (matched to the Asura idle) rather than the image.
s_files=sorted(glob.glob(SRC+'/s_*.jpg'))
if s_files:
    a_idle=frames.get('A_idle')
    ref_h=(baseline(a_idle['img'])-np.where(np.asarray(a_idle['img'])[...,3].max(axis=1)>128)[0].min()) if a_idle else None
    ki=key(SRC+'/s_idle.jpg'); ci,_=crop(ki); ali=np.asarray(ci)[...,3]
    idle_h=baseline(ci)-np.where(ali.max(axis=1)>128)[0].min()
    S_S=(ref_h*1.04/idle_h) if ref_h else S_A
    for p in s_files:
        name=os.path.basename(p)[2:-4]
        k=key(p); k=k.resize((round(k.width*S_S),round(k.height*S_S)),Image.LANCZOS)
        c,_=crop(k)
        pm=purple_mask(c); al=np.asarray(c)[...,3].astype(np.float32)/255
        by=baseline(c); rows=np.where(al.max(axis=1)>0.5)[0]; top=rows.min(); hh=by-top
        band=al[int(top+hh*0.40):int(top+hh*0.58)]*(al[int(top+hh*0.40):int(top+hh*0.58)]>0.8)
        colw=band.sum(axis=0); cs=np.cumsum(colw); tx=float(np.searchsorted(cs,cs[-1]/2))
        ys,xs=np.where(pm)
        near=np.abs(xs-tx)<c.width*0.14
        lo=(ys>top+hh*0.38)&(ys<top+hh*0.62)&near
        hi=(ys>top+hh*0.12)&(ys<=top+hh*0.38)&near
        sy=float(np.median(ys[lo])) if lo.sum()>30 else top+hh*0.5
        ny=float(np.median(ys[hi])) if hi.sum()>20 else top+hh*0.3
        nx=float(np.median(xs[hi])) if hi.sum()>20 else tx
        sash=(tx,sy); beads=(nx,ny)
        add('S_'+name,c,sash[0],by,{'sash':sash,'beads':beads,'head':(beads[0]+4,beads[1]-(sash[1]-beads[1])*0.35)})

# ---------------- enemies & bosses: normalised height
H={0:236,1:220,2:196,3:236,4:240,5:240,6:236,7:250,8:400,9:400,10:400,11:400,12:400}
for p in glob.glob(SRC+'/e*_*.jpg'):
    base=os.path.basename(p); kind=int(base[1:base.index('_')])
    k=key(p); c,_=crop(k)
    s=H[kind]/c.height; c=c.resize((max(1,round(c.width*s)),H[kind]),Image.LANCZOS)
    a=np.asarray(c)[...,3].astype(np.float32)
    ax=float((a.sum(axis=0)*np.arange(a.shape[1])).sum()/a.sum())
    # anchor x on the feet: weighted centre of the lowest 18% of rows
    lowr=a[int(a.shape[0]*0.82):]
    if lowr.sum()>0: ax=float((lowr.sum(axis=0)*np.arange(a.shape[1])).sum()/lowr.sum())
    add('E%d'%kind,c,ax,baseline(c))

# ---------------- FX stamps (alpha only; recoloured at runtime)
for nm,size in [('arc',360),('splat',256),('splatred',256)]:
    k=key(SRC+'/fx_%s.jpg'%nm); c,_=crop(k,2)
    s=size/max(c.size); c=c.resize((round(c.width*s),round(c.height*s)),Image.LANCZOS)
    arr=np.asarray(c).copy()
    if nm=='splatred':
        arr[...,0]=179; arr[...,1]=32; arr[...,2]=42   # seal red
        a=arr[...,3].astype(np.float32); arr[...,3]=np.clip(a*1.0,0,255).astype(np.uint8)
    else:
        arr[...,0]=20; arr[...,1]=18; arr[...,2]=16
    c=Image.fromarray(arr,'RGBA')
    add('FX_'+nm,c,c.width/2,c.height/2)

# ---------------- shelf pack into atlases
def pack(names,file,maxw=2048):
    items=sorted(names,key=lambda n:-frames[n]['img'].height)
    x=y=sh=0; pos={}
    for n in items:
        im=frames[n]['img']
        if x+im.width>maxw: x=0; y+=sh+2; sh=0
        pos[n]=(x,y); x+=im.width+2; sh=max(sh,im.height)
    W=maxw; Hh=y+sh
    atlas=Image.new('RGBA',(W,Hh),(0,0,0,0))
    meta={}
    for n,(px,py) in pos.items():
        f=frames[n]; atlas.paste(f['img'],(px,py))
        m={'x':px,'y':py,'w':f['img'].width,'h':f['img'].height,'ax':round(f['ax'],1),'ay':round(f['ay'],1)}
        for k2 in ('sash','beads','head'):
            if k2 in f: m[k2]=[round(v,1) for v in f[k2]]
        meta[n]=m
    atlas.save(OUT+'/'+file,'WEBP',quality=86,method=6,alpha_quality=90)
    return meta,(W,Hh)

ma,sa=pack([n for n in frames if n.startswith('A_')],'asura.webp')
me,se=pack([n for n in frames if n.startswith('E')],'foes.webp')
mf,sf=pack([n for n in frames if n.startswith('FX_')],'fx.webp',1024)
md,sd=pack([n for n in frames if n.startswith('D_')],'daeva.webp')
ms_,ss_=pack([n for n in frames if n.startswith('S_')],'sorcerer.webp') if s_files else ({},None)
meta={'asura':{'file':'asura.webp','size':sa,'frames':ma},'daeva':{'file':'daeva.webp','size':sd,'frames':md},'foes':{'file':'foes.webp','size':se,'frames':me},'fx':{'file':'fx.webp','size':sf,'frames':mf}}
if s_files: meta['sorcerer']={'file':'sorcerer.webp','size':ss_,'frames':ms_}
json.dump(meta,open(OUT+'/atlas.json','w'),indent=1)
for f in ('asura.webp','daeva.webp','foes.webp','fx.webp')+(('sorcerer.webp',) if s_files else ()): print(f,os.path.getsize(OUT+'/'+f)//1024,'KB', Image.open(OUT+'/'+f).size)
# previews on dark + paper backgrounds to check for halos
for f in ('asura.webp','daeva.webp','foes.webp')+(('sorcerer.webp',) if s_files else ()):
    a=Image.open(OUT+'/'+f)
    for bg,nm in [((40,40,60,255),'dark'),((236,230,216,255),'paper')]:
        b=Image.new('RGBA',a.size,bg); b.alpha_composite(a); b.convert('RGB').save(os.path.join(SRC,'preview-%s-%s.jpg'%(f[:-5],nm)),quality=85)
