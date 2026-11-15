# Shared ink-on-paper keying for every painted asset (characters, FX, props).
import numpy as np, os
from scipy import ndimage as ndi

def disk(r):
    y,x=np.ogrid[-r:r+1,-r:r+1]; return x*x+y*y<=r*r

def key_array(im, report=None, name=""):
    """Key ink-on-paper to RGBA.

    The ink mask is closed and its holes filled, but enclosed holes that are
    paper (gaps between legs, arm and body, weapon and hand, hair strands) are
    keyed out again: a hole counts as paper when its mean darkness is close to
    the paper tone (large holes) or almost pure white (small ones). Light painted
    areas (white robes, tengu feathers, teeth, eye glints) read as a light grey
    wash or are tiny, so they stay opaque. Paper slivers bridged by the closing
    get alpha from their own darkness instead of being forced opaque, and the
    cut edges are eroded and feathered so no halo is left behind.
    """
    im=np.asarray(im).astype(np.float32)[..., :3]
    mn=im.min(axis=2); d=255-mn
    ink=d>24
    lab,n=ndi.label(ink); sizes=ndi.sum(ink,lab,range(1,n+1))
    keep=np.zeros(n+1,bool); keep[1:]=sizes>=8; ink=keep[lab]
    closed=ndi.binary_closing(ink,structure=disk(4))
    filled=ndi.binary_fill_holes(closed)
    holes=filled&~closed
    hl,hn=ndi.label(holes)
    paper_hole=np.zeros(hn+1,bool)
    if hn:
        idx=np.arange(1,hn+1)
        area=ndi.sum(holes,hl,idx); md=ndi.mean(d,hl,idx)
        paper_hole[1:]=((area>=150)&(md<6.0))|((area>=25)&(md<3.5))
    gap=paper_hole[hl]
    # grow the paper gaps through the closing seam into the bridged slivers
    gap=ndi.binary_dilation(gap,structure=disk(3))&~ink
    fg=filled&~gap
    # everything stays opaque except paper slivers right next to a keyed gap
    solid=fg&(ink|~ndi.binary_dilation(gap,structure=disk(6)))
    # bare paper bridged by the closing between strands (hair, frayed robes,
    # splatter) is not paint either, unless it sits inside a protected light area
    kept=ndi.binary_dilation(holes&~gap,structure=disk(3))
    solid&=ink|kept|(d>=5)
    inner=ndi.binary_erosion(fg,iterations=2)&solid
    a0=np.clip(d/255.0,0,1)
    a_edge=np.clip(a0*1.6,0,1)
    alpha=np.where(inner,1.0,np.where(fg,a_edge,0.0))
    # erode + feather the alpha along keyed gaps so no paper fringe remains
    near_gap=ndi.binary_dilation(gap,structure=disk(3))
    er=ndi.grey_erosion(alpha,size=(3,3))
    alpha=np.where(near_gap,np.minimum(alpha,er*0.5+alpha*0.5),alpha)
    alpha=np.where(near_gap|~inner,ndi.gaussian_filter(alpha,0.7),alpha)
    if report is not None: report.append((name,int(paper_hole.sum()),int(gap.sum())))
    # un-blend edge colours from the white paper so there is no halo
    safe=np.maximum(a0,0.04)[...,None]
    unbl=np.clip((im-255*(1-a0[...,None]))/safe,0,255)
    col=np.where((inner)[...,None],im,unbl)
    col=col*np.array([241,235,222],np.float32)/255.0
    rgba=np.dstack([col,np.clip(alpha,0,1)*255]).astype(np.uint8)
    return rgba



def drop_paper(rgba, src, band=None, strength=1.0):
    """Remove near-paper pixels that are not part of a densely painted body.
    band: (y0, y1) rows to ramp the effect in (None = whole image)."""
    rgba = rgba.astype(np.float32); src = np.asarray(src).astype(np.float32)[..., :3]
    dd = 255 - src.min(axis=2)
    paper = np.clip((16 - dd) / 9, 0, 1) * strength
    # large paper areas fully enclosed by the painting (a banner's cloth, plaster)
    # are painted white, not background: leave those alone
    pm = dd < 16
    lab, n = ndi.label(pm)
    if n:
        outside = ndi.binary_dilation(rgba[..., 3] < 8, iterations=2)
        touch = np.zeros(n + 1, bool); touch[np.unique(lab[outside & pm])] = True
        size = ndi.sum(pm, lab, range(1, n + 1)); big = np.zeros(n + 1, bool); big[1:] = size > 1500
        keep = big & ~touch; keep[0] = False
        prot = ndi.binary_closing(ndi.binary_dilation(keep[lab], iterations=8), iterations=4)
        paper = paper * (1 - prot)
    else:
        prot = np.zeros(dd.shape, bool)
    if band is not None:
        y0, y1 = band; ys = np.arange(src.shape[0], dtype=np.float32)
        paper *= np.clip((ys - y0) / max(1, y1 - y0), 0, 1)[:, None]
    dens = ndi.uniform_filter((dd > 46).astype(np.float32), 13)
    solid = np.clip((dens - 0.32) / 0.22, 0, 1)
    solid = np.maximum(solid, ndi.grey_erosion(solid, size=(5, 5)))
    k = 1 - paper * (1 - solid)
    # pale-but-not-paper strokes in loose areas (willow fronds, grass tufts) become
    # a translucent grey wash instead of opaque light card
    wash = np.clip((42 - dd) / 26, 0, 1) * (1 - solid) * (1 - paper) * (1 - prot) * strength
    if band is not None: wash *= np.clip((np.arange(src.shape[0], dtype=np.float32) - band[0]) / max(1, band[1] - band[0]), 0, 1)[:, None]
    k = k * (1 - 0.5 * wash)
    a = rgba[..., 3] / 255 * k
    a = ndi.gaussian_filter(a, 0.6) * (a > 0.02)
    lo = (a < 0.9)[..., None] & (k < 0.99)[..., None]
    sa = np.maximum(a, 0.05)[..., None]
    un = np.clip((src - 236 * (1 - sa)) / sa, 0, 255)
    rgba[..., :3] = np.where(lo, np.minimum(rgba[..., :3], un), rgba[..., :3])
    rgba[..., :3] *= (1 - 0.3 * paper * (1 - 0.6 * solid) - 0.22 * wash)[..., None]
    rgba[..., 3] = a * 255
    return rgba.clip(0, 255).astype(np.uint8)
